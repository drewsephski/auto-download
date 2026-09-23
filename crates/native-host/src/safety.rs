//! Guards against accidentally adding shell execution or stdout logging
//! on the native-messaging path.

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
    fn sources_do_not_spawn_processes() {
        let sources = [
            ("lib.rs", include_str!("lib.rs")),
            ("protocol.rs", include_str!("protocol.rs")),
            ("os_adapter.rs", include_str!("os_adapter.rs")),
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
            ("host_io.rs", include_str!("host_io.rs")),
            ("install.rs", include_str!("install.rs")),
            ("safety.rs", include_str!("safety.rs")),
        ];
        let stdout_macro = stdout_macro();
        for (name, source) in sources {
            assert!(
                !source.contains(&stdout_macro),
                "{name} writes to stdout"
            );
        }
    }
}
