//! Operating-system adapter.
//!
//! This slice only describes what a future power action would do. It must not call
//! sleep, shutdown, or reboot APIs.

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

/// Result of a simulated power action. `executed` is always false in this slice.
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

#[cfg(test)]
mod tests {
    use super::{simulate, PowerAction};

    #[test]
    fn every_action_is_simulated() {
        for action in [PowerAction::Sleep, PowerAction::Shutdown, PowerAction::Reboot] {
            let result = simulate(action);
            assert!(!result.executed);
            assert!(result.dry_run);
            assert_eq!(result.action, action);
            assert!(!result.message.is_empty());
        }
    }
}
