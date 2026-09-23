# Download Automations

Download Automations is a Manifest V3 Chrome extension that can react when a browser download finishes. This repository is the first vertical slice: a completed download can ask a local Rust host to **simulate** sleep, shut down, or restart. The host does not perform those actions.

Chrome talks to the host only through [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging). There is no local HTTP server.

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
cargo fmt --check
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

The extension cannot send a shell command, script, or executable path. The host accepts three message types (`ping`, `get_capabilities`, `execute_action`) and three actions (`sleep`, `shutdown`, `reboot`). `execute_action` is rejected unless `dryRun` is `true`. Real power APIs are not called.

Permissions are `storage`, `downloads`, and `nativeMessaging`. There are no host permissions and no content scripts.
# auto-download
