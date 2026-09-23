//! Operating-system adapter.
//!
//! Dry-run results never touch the operating system. Real actions go through
//! [`PowerController`]. The production controller calls the non-force
//! `system_shutdown` sleep, shutdown, and reboot functions and nothing else.
//! On macOS that crate uses a fixed System Events AppleScript. This module does
//! not construct commands, paths, or scripts from browser input.

use thiserror::Error;

/// Shortest real countdown this host will schedule.
pub const MIN_COUNTDOWN_SECONDS: u64 = 10;

/// Longest real countdown this host will schedule.
pub const MAX_COUNTDOWN_SECONDS: u64 = 120;

/// Allowlisted power actions. There is no variant for an arbitrary command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerAction {
    Sleep,
    Shutdown,
    Reboot,
}

impl PowerAction {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "sleep" => Some(Self::Sleep),
            "shutdown" => Some(Self::Shutdown),
            "reboot" => Some(Self::Reboot),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sleep => "sleep",
            Self::Shutdown => "shutdown",
            Self::Reboot => "reboot",
        }
    }
}

/// Result of a simulated power action. `executed` is always false.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SimulatedAction {
    pub executed: bool,
    pub dry_run: bool,
    pub action: PowerAction,
    pub message: &'static str,
}

/// Simulate a power action without touching the operating system.
pub fn simulate(action: PowerAction) -> SimulatedAction {
    SimulatedAction {
        executed: false,
        dry_run: true,
        action,
        message: match action {
            PowerAction::Sleep => "Would put this computer to sleep",
            PowerAction::Shutdown => "Would shut down this computer",
            PowerAction::Reboot => "Would restart this computer",
        },
    }
}

/// Failure from a real power call. The display text is fixed and carries no OS detail.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum PowerError {
    #[error("sleep failed")]
    SleepFailed,
    #[error("shutdown failed")]
    ShutdownFailed,
    #[error("reboot failed")]
    RebootFailed,
}

impl PowerError {
    pub fn for_action(action: PowerAction) -> Self {
        match action {
            PowerAction::Sleep => Self::SleepFailed,
            PowerAction::Shutdown => Self::ShutdownFailed,
            PowerAction::Reboot => Self::RebootFailed,
        }
    }
}

pub fn executing_message(action: PowerAction) -> &'static str {
    match action {
        PowerAction::Sleep => "Putting this computer to sleep",
        PowerAction::Shutdown => "Shutting down this computer",
        PowerAction::Reboot => "Restarting this computer",
    }
}

pub fn executed_message(action: PowerAction) -> &'static str {
    match action {
        PowerAction::Sleep => "Put this computer to sleep",
        PowerAction::Shutdown => "Shut down this computer",
        PowerAction::Reboot => "Restarted this computer",
    }
}

pub fn failed_message(action: PowerAction) -> &'static str {
    match action {
        PowerAction::Sleep => "The computer did not sleep.",
        PowerAction::Shutdown => "The computer did not shut down.",
        PowerAction::Reboot => "The computer did not restart.",
    }
}

/// Boundary used by the session so tests can supply a fake controller.
pub trait PowerController {
    fn execute(&mut self, action: PowerAction) -> Result<(), PowerError>;
}

/// Production controller. Calls one non-force API and takes no browser input.
pub struct SystemPowerController;

impl PowerController for SystemPowerController {
    fn execute(&mut self, action: PowerAction) -> Result<(), PowerError> {
        let result = match action {
            PowerAction::Sleep => system_shutdown::sleep(),
            PowerAction::Shutdown => system_shutdown::shutdown(),
            PowerAction::Reboot => system_shutdown::reboot(),
        };
        result.map_err(|_| PowerError::for_action(action))
    }
}

/// Outcome of an explicit System Events permission request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionOutcome {
    Granted,
    Denied,
    Unavailable,
}

/// Boundary for the macOS permission dialog so tests never open it.
pub trait PermissionRequester {
    fn request_permission(&mut self) -> PermissionOutcome;
}

/// Production permission request. Granted only when the platform call succeeds.
pub struct SystemPermissionRequester;

impl PermissionRequester for SystemPermissionRequester {
    fn request_permission(&mut self) -> PermissionOutcome {
        request_system_permission()
    }
}

pub fn request_system_permission() -> PermissionOutcome {
    #[cfg(target_os = "macos")]
    {
        match system_shutdown::request_permission_dialog() {
            Ok(()) => PermissionOutcome::Granted,
            Err(_) => PermissionOutcome::Denied,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        PermissionOutcome::Unavailable
    }
}

pub fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

/// Real execution allowlist. Non-macOS builds stay dry-run only.
pub fn real_action_names() -> &'static [&'static str] {
    if cfg!(target_os = "macos") {
        &["sleep", "shutdown", "reboot"]
    } else {
        &[]
    }
}

pub fn is_real_action(action: PowerAction) -> bool {
    real_action_names().contains(&action.as_str())
}

/// Test double. Ordinary `cargo test` uses this instead of [`SystemPowerController`].
#[derive(Debug, Clone)]
pub struct FakePowerController {
    calls: std::sync::Arc<std::sync::Mutex<FakePowerState>>,
}

#[derive(Debug)]
struct FakePowerState {
    actions: Vec<PowerAction>,
    fail: bool,
}

impl FakePowerController {
    pub fn succeeding() -> Self {
        Self::new(false)
    }

    pub fn failing() -> Self {
        Self::new(true)
    }

    fn new(fail: bool) -> Self {
        Self {
            calls: std::sync::Arc::new(std::sync::Mutex::new(FakePowerState {
                actions: Vec::new(),
                fail,
            })),
        }
    }

    pub fn calls(&self) -> u32 {
        self.actions().len() as u32
    }

    pub fn actions(&self) -> Vec<PowerAction> {
        self.calls.lock().expect("fake power lock").actions.clone()
    }
}

impl PowerController for FakePowerController {
    fn execute(&mut self, action: PowerAction) -> Result<(), PowerError> {
        let mut state = self.calls.lock().expect("fake power lock");
        state.actions.push(action);
        if state.fail {
            Err(PowerError::for_action(action))
        } else {
            Ok(())
        }
    }
}

/// Test double for the permission dialog.
#[derive(Debug, Clone, Copy)]
pub struct FakePermissionRequester {
    pub outcome: PermissionOutcome,
}

impl PermissionRequester for FakePermissionRequester {
    fn request_permission(&mut self) -> PermissionOutcome {
        self.outcome
    }
}

#[cfg(test)]
mod tests {
    use super::{simulate, FakePowerController, PowerAction, PowerController};

    #[test]
    fn fake_controller_records_each_action_once() {
        let mut controller = FakePowerController::succeeding();
        controller.execute(PowerAction::Sleep).unwrap();
        controller.execute(PowerAction::Shutdown).unwrap();
        controller.execute(PowerAction::Reboot).unwrap();
        assert_eq!(
            controller.actions(),
            vec![
                PowerAction::Sleep,
                PowerAction::Shutdown,
                PowerAction::Reboot
            ]
        );
    }

    #[test]
    fn every_dry_run_action_is_simulated() {
        for action in [
            PowerAction::Sleep,
            PowerAction::Shutdown,
            PowerAction::Reboot,
        ] {
            let result = simulate(action);
            assert!(!result.executed);
            assert!(result.dry_run);
            assert_eq!(result.action, action);
            assert!(!result.message.is_empty());
        }
    }

    /// Opt-in only. `cargo test` does not run ignored tests, and each test
    /// refuses to call the operating system unless its own variable is `1`.
    #[test]
    #[ignore = "puts this Mac to sleep; set ALLOW_REAL_SLEEP_TEST=1 and pass --ignored"]
    fn manual_real_sleep() {
        assert_eq!(
            std::env::var("ALLOW_REAL_SLEEP_TEST").ok().as_deref(),
            Some("1"),
            "refusing to sleep without ALLOW_REAL_SLEEP_TEST=1"
        );
        system_shutdown::sleep().expect("sleep failed");
    }

    #[test]
    #[ignore = "shuts this Mac down; set ALLOW_REAL_SHUTDOWN_TEST=1 and pass --ignored"]
    fn manual_real_shutdown() {
        assert_eq!(
            std::env::var("ALLOW_REAL_SHUTDOWN_TEST").ok().as_deref(),
            Some("1"),
            "refusing to shut down without ALLOW_REAL_SHUTDOWN_TEST=1"
        );
        system_shutdown::shutdown().expect("shutdown failed");
    }

    #[test]
    #[ignore = "restarts this Mac; set ALLOW_REAL_REBOOT_TEST=1 and pass --ignored"]
    fn manual_real_reboot() {
        assert_eq!(
            std::env::var("ALLOW_REAL_REBOOT_TEST").ok().as_deref(),
            Some("1"),
            "refusing to restart without ALLOW_REAL_REBOOT_TEST=1"
        );
        system_shutdown::reboot().expect("reboot failed");
    }

    #[test]
    fn fake_controller_counts_one_failure_without_retrying_itself() {
        let mut controller = FakePowerController::failing();
        assert_eq!(
            controller.execute(PowerAction::Shutdown),
            Err(super::PowerError::ShutdownFailed)
        );
        assert_eq!(controller.actions(), vec![PowerAction::Shutdown]);
    }

    #[test]
    fn production_adapter_uses_only_non_force_power_apis() {
        let source = include_str!("os_adapter.rs");
        assert!(source.contains("system_shutdown::sleep"));
        assert!(source.contains(&["system_shutdown::", "shutdown"].concat()));
        assert!(source.contains(&["system_shutdown::", "reboot"].concat()));
        assert!(source.contains("request_permission_dialog"));
        assert!(!source.contains(&["force_", "shutdown"].concat()));
        assert!(!source.contains(&["force_", "reboot"].concat()));
    }
}
