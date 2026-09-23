# Download Automations

Download Automations is a Manifest V3 Chrome extension that can react when a browser download finishes. A completed download can ask a local Rust host to simulate sleep, shut down, or restart. Real execution is limited to sleep, and only after a 30-second countdown that the user can cancel.

Chrome talks to the host only through [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging). There is no local HTTP server, daemon, or scheduled job.

## Layout

- `apps/extension` — WXT, React, Tailwind CSS v4
- `crates/native-host` — Rust native messaging host
- `docs` — architecture, protocol, and macOS setup

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm check
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

`pnpm check` runs the TypeScript typecheck, lint, unit tests, production extension build, and Playwright popup test.

Native host registration, from the repository root:

```bash
cargo run -p native-host -- install --browser chrome --extension-id <CHROME_EXTENSION_ID>
cargo run -p native-host -- verify --browser chrome
cargo run -p native-host -- uninstall --browser chrome
```

The exact macOS sequence is in [docs/local-development.md](docs/local-development.md).

## Safety boundary

Download Automations does not accept or construct arbitrary shell commands, scripts, paths, or executable arguments. The host accepts `ping`, `get_capabilities`, `request_permission`, `execute_action`, `schedule_action`, and `cancel_action`. Dry-run actions are `sleep`, `shutdown`, and `reboot`. The only real action is `sleep`, and it runs only while Chrome keeps the native messaging port open through a countdown of at least 10 seconds. This extension always requests 30 seconds.

On macOS, the audited `system_shutdown` dependency invokes fixed System Events AppleScript operations. Closing Chrome, disconnecting the port, or pressing Cancel discards a pending sleep. The host does not retry a failed sleep.

Permissions are `storage`, `downloads`, `nativeMessaging`, and `notifications`. There are no host permissions and no content scripts.
