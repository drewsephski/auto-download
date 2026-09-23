//! Download Automations native host library.
//!
//! The browser can ask only for typed, allowlisted operations. This crate does not
//! construct shell commands, scripts, or executable arguments. On macOS, the audited
//! `system_shutdown` dependency invokes fixed System Events AppleScript operations.

pub mod host_io;
pub mod install;
pub mod os_adapter;
pub mod protocol;
#[cfg(test)]
mod safety;
pub mod session;

/// Native messaging host name. Keep this identical to `NATIVE_HOST_NAME` in the extension.
pub const HOST_NAME: &str = "dev.downloadautomations.host";

/// Description written into the browser native-host manifest.
pub const HOST_DESCRIPTION: &str = "Download Automations native messaging host";

/// Protocol version spoken by this host. Responses always use this version.
pub const PROTOCOL_VERSION: u32 = 2;

/// How the binary was started. Chrome passes the extension origin as an argument;
/// that must never be treated as a command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvocationMode {
    /// Read native-messaging requests until the browser disconnects.
    NativeHost,
    /// Developer install, verify, or uninstall command.
    Cli,
}

/// Classify process arguments. Anything that is not an explicit developer subcommand
/// stays in native-host mode and the arguments are ignored.
pub fn invocation_mode(args: &[String]) -> InvocationMode {
    match args.first().map(String::as_str) {
        Some(
            "install" | "verify" | "uninstall" | "help" | "--help" | "-h" | "-V" | "--version",
        ) => InvocationMode::Cli,
        _ => InvocationMode::NativeHost,
    }
}

#[cfg(test)]
mod tests {
    use super::{invocation_mode, InvocationMode, HOST_NAME};

    #[test]
    fn host_name_is_the_development_constant() {
        assert_eq!(HOST_NAME, "dev.downloadautomations.host");
    }

    #[test]
    fn chrome_origin_argument_does_not_enter_cli_mode() {
        let args = vec!["chrome-extension://abcdefghijklmnopabcdefghijklmnop/".to_string()];
        assert_eq!(invocation_mode(&args), InvocationMode::NativeHost);
    }

    #[test]
    fn unrecognized_arguments_are_not_commands() {
        for argument in ["shutdown", "sleep", "--command", "rm", "-rf", ""] {
            let args = vec![argument.to_string()];
            assert_eq!(invocation_mode(&args), InvocationMode::NativeHost);
        }
        assert_eq!(invocation_mode(&[]), InvocationMode::NativeHost);
    }

    #[test]
    fn explicit_subcommands_enter_cli_mode() {
        for argument in ["install", "verify", "uninstall", "--help"] {
            let args = vec![argument.to_string()];
            assert_eq!(invocation_mode(&args), InvocationMode::Cli);
        }
    }
}
