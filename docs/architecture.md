# Architecture

A completed Chrome download is handled entirely on the machine. Nothing is uploaded, and the downloaded file is never opened or inspected.

```text
Chrome download event
  -> MV3 service worker
  -> decision engine
  -> Native Messaging
  -> Rust host
  -> dry-run response, or a countdown owned by the host
  -> optional system_shutdown::sleep()
  -> extension history and popup
```

Dry-run sleep, shut down, and restart use one-shot `runtime.sendNativeMessage`. Real sleep uses `runtime.connectNative` and stays on that port until it is cancelled, the countdown finishes, or the connection closes.

## Chrome download event

The service worker registers `downloads.onCreated`, `downloads.onChanged`, `notifications.onButtonClicked`, and `runtime.onMessage` synchronously while the background module evaluates. Manifest V3 can suspend the worker; Chrome starts it again for those events only if the listeners were registered on the initial turn.

`onChanged` is the completion signal. `onCreated` is also observed because a download can already be `complete` when it is created. A state of `interrupted` is ignored. The worker then calls `downloads.search` for that id and keeps only a display name, size, MIME type, and completion time. The full filesystem path is reduced to a file name before it is stored or sent.

## Decision engine

Settings live in `chrome.storage.local` through WXT storage. The stored document is version `2`. Version `1` documents migrate to version `2` with `executionMode: "dry_run"`. Migration never turns on real execution. This slice ships one rule, `after-download`.

For each enabled dry-run rule, the engine builds one `execute_action` request. For the default rule in real mode, it builds one `schedule_action` for sleep only when macOS permission has been granted and Chrome notifications are available. Real shut down and real restart are recorded as failures and are not sent. Disabled rules produce no request.

A completion is claimed in storage before the host is contacted, under a Web Locks lock for that download id, so a repeated `onChanged` event or a restarted worker does not send the action twice. The claim means the download was processed. It does not mean a power action ran. If scheduling fails, the failure is recorded and is not replayed. The claim window keeps the latest 200 download ids. Visible download and execution history each keep the latest 20 records.

A second completed download while a sleep is already pending is recorded, then coalesced. It does not start another countdown. The computer only needs to sleep once.

## Real sleep lifecycle

Real sleep is at most once per scheduled action:

```text
scheduled -> executing -> executed
scheduled -> cancelled
scheduled -> connection_lost
scheduled -> executing -> failed
```

The Rust process owns the deadline. The extension does not use `chrome.alarms` for that countdown. Pending storage is informational. On startup, a pending action with no live native port is marked `connection_lost` and is not reconstructed.

A live power action exists only while Chrome maintains an active Native Messaging session. If Chrome or the connection disappears before the deadline, the action is cancelled. There is no detached process, LaunchAgent, cron job, daemon, or recovery execution after Chrome restarts.

Before `system_shutdown::sleep()`, the host checks that the pending action is still the same sleep, that the countdown has elapsed, and that it can still write to the browser. A failed sleep is recorded and not retried. Automated tests use a fake power controller. `cargo test` does not call the real sleep function.

## Native Messaging

Short requests use one-shot `runtime.sendNativeMessage`: ping, capabilities, dry-run actions, and the explicit macOS permission request. Real sleep uses `runtime.connectNative` so the same process can accept `schedule_action` and `cancel_action` for the life of the countdown.

The host name is `dev.downloadautomations.host` in both `apps/extension/lib/constants.ts` and `crates/native-host/src/lib.rs`.

Stdout is reserved for framed responses. Diagnostics go to stderr. A browser disconnect is a normal exit and discards any pending sleep.

## Rust host

The `native_messaging` crate (0.3) supplies the 4-byte native-endian length prefix, the 1 MiB host-to-browser cap, and user-level manifest install, verify, and remove. This project adds protocol version 2 and the execution policy on top. Requests are validated again in Rust. Unknown versions, message types, actions, and fields are rejected. A hostile filename is metadata only. It is never passed to a process.

Download Automations does not accept or construct arbitrary shell commands or executable arguments. On macOS, the audited `system_shutdown` dependency invokes fixed System Events AppleScript operations. The production adapter calls `system_shutdown::sleep()` and `system_shutdown::request_permission_dialog()` only. It does not call force shutdown or force reboot.

## macOS permission

Real sleep needs Automation access to System Events. The popup button **Allow macOS control** sends `request_permission`. That calls `request_permission_dialog()`, which asks System Events to stop the current screen saver. The extension stores `granted` only when that call succeeds. A download completion never opens the permission dialog. Dry-run mode does not require it. Real mode cannot be armed until permission is granted and notifications are available.

## Registration

Developer install is explicit:

```bash
cargo run -p native-host -- install --browser chrome --extension-id <CHROME_EXTENSION_ID>
```

The command resolves this binary's absolute path and asks the `native_messaging` crate to write a current-user Chrome manifest. Installation does not need root.

There is no published extension ID yet. The allowlist is the unpacked or store ID passed to `install`. After a stable production ID exists, run `install` again with that ID. The development host name can change at the same time, but both constants have to move together. Do not put a private extension key in this repository to pin an ID.

## Popup

The popup reads the same storage items the worker writes. It pings the host and then asks for capabilities. The connection is shown as Connected when protocol version 2 answers. A missing host is Not installed. A version 1 host is an error asking for an update. The banner says **DRY RUN** or **LIVE — SLEEP ENABLED**. Real mode requires a confirmation that names the 30-second cancel window and explains that closing Chrome cancels the pending sleep.
