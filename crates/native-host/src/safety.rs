//! Guards against accidentally adding shell execution or stdout logging
//! on the native-messaging path.
//!
//! Download Automations does not accept or construct arbitrary shell commands or
//! executable arguments. These tests cover this crate's sources. On macOS, the
//! audited `system_shutdown` dependency invokes fixed System Events AppleScript
//! operations from its own crate.

#[cfg(test)]
mod tests {
    fn command_constructor() -> String {
        ["Command", "::new"].concat()
    }

    fn process_command() -> String {
        ["std", "::process::", "Command"].concat()
    }

    fn stdout_macro() -> String {
        ["print", "ln!"].concat()
    }

    #[test]
    fn sources_do_not_construct_process_commands() {
        let sources = [
            ("lib.rs", include_str!("lib.rs")),
            ("protocol.rs", include_str!("protocol.rs")),
            ("os_adapter.rs", include_str!("os_adapter.rs")),
            ("session.rs", include_str!("session.rs")),
            ("host_io.rs", include_str!("host_io.rs")),
            ("install.rs", include_str!("install.rs")),
            ("main.rs", include_str!("main.rs")),
            ("safety.rs", include_str!("safety.rs")),
        ];
        for (name, source) in sources {
            assert!(
                !source.contains(&command_constructor()),
                "{name} constructs a process"
            );
            assert!(
                !source.contains(&process_command()),
                "{name} references process commands"
            );
        }
    }

    #[test]
    fn native_messaging_path_does_not_write_stdout() {
        let sources = [
            ("lib.rs", include_str!("lib.rs")),
            ("protocol.rs", include_str!("protocol.rs")),
            ("os_adapter.rs", include_str!("os_adapter.rs")),
            ("session.rs", include_str!("session.rs")),
            ("host_io.rs", include_str!("host_io.rs")),
            ("install.rs", include_str!("install.rs")),
            ("safety.rs", include_str!("safety.rs")),
        ];
        for (name, source) in sources {
            assert!(
                !contains_stdout_macro(source),
                "{name} writes human-readable logs to stdout"
            );
        }
    }

    fn contains_stdout_macro(source: &str) -> bool {
        let needle = stdout_macro();
        let mut rest = source;
        while let Some(index) = rest.find(&needle) {
            let preceded_by_e = index > 0 && rest.as_bytes()[index - 1] == b'e';
            if !preceded_by_e {
                return true;
            }
            rest = &rest[index + needle.len()..];
        }
        false
    }
}
