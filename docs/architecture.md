# Architecture

A completed Chrome download is handled entirely on the machine. Nothing is uploaded, and the downloaded file is never opened or inspected.

```text
Chrome download event
  -> MV3 service worker
  -> decision engine
  -> Native Messaging
  -> Rust host
  -> OS adapter (dry-run only)
  -> structured response
  -> extension history
  -> popup
```

## Chrome download event

The service worker registers `downloads.onCreated` and `downloads.onChanged` synchronously while the background module evaluates. Manifest V3 can suspend the worker; Chrome starts it again for those events only if the listeners were registered on the initial turn. WXT calls the background `main` function synchronously, and that function registers both listeners before any `await`.

`onChanged` is the completion signal. `onCreated` is also observed because a download can already be `complete` when it is created. A state of `interrupted` is ignored. The worker then calls `downloads.search` for that id and keeps only a display name, size, MIME type, and completion time. The full filesystem path is reduced to a file name before it is stored or sent.

## Decision engine

Settings live in `chrome.storage.local` through WXT storage, not in service-worker memory. The stored document is version `1` and contains a list of rules so later automations can be added without replacing the engine. This slice ships one rule, `after-download`.

For each enabled rule whose `dryRun` flag is exactly `true`, the engine builds one `execute_action` request. Disabled rules produce no request. A completion is claimed in storage before the host is contacted, under a Web Locks lock for that download id, so a repeated `onChanged` event or a restarted worker does not send the action twice. The claim window keeps the latest 200 download ids. Visible download and execution history each keep the latest 20 records.

If the worker stops after the claim is written and before the result is stored, that completion is not retried. That favors at most one execution, which matters once real power actions exist.

## Native Messaging

The extension uses one-shot `runtime.sendNativeMessage`. Chrome starts a new host process for that call, writes one framed JSON message to stdin, and treats the host's first framed stdout message as the response. Ports and in-memory host connections are not used.

The host name is `dev.downloadautomations.host` in both `apps/extension/lib/constants.ts` and `crates/native-host/src/lib.rs`.

Stdout is reserved for the framed response. Diagnostics go to stderr. A browser disconnect is a normal exit.

## Rust host

The `native_messaging` crate (0.3) supplies the 4-byte native-endian length prefix, the 1 MiB host-to-browser cap, and user-level manifest install, verify, and remove. This project adds the versioned JSON protocol and the dry-run policy on top. Requests are validated again in Rust. Unknown versions, message types, actions, fields, and any `dryRun` value other than `true` are rejected. A hostile filename is either rejected or ignored; it is never passed to a process.

## OS adapter

`crates/native-host/src/os_adapter.rs` is the only place that knows what sleep, shut down, and restart would mean. `simulate` returns `executed: false` and a fixed sentence. It does not call operating-system power APIs. A later slice can add a real adapter beside that function; this slice has no path that reaches one.

## Registration

Developer install is explicit:

```bash
cargo run -p native-host -- install --browser chrome --extension-id <CHROME_EXTENSION_ID>
```

The command resolves this binary's absolute path and asks the `native_messaging` crate to write a current-user Chrome manifest. That crate already knows the macOS, Linux, and Windows locations for its browser keys. This CLI currently accepts only `chrome`, so adding another browser is a new `BrowserKind` variant rather than a new path implementation. Installation does not need root.

There is no published extension ID yet. The allowlist is the unpacked or store ID passed to `install`. After a stable production ID exists, run `install` again with that ID. The development host name can change at the same time, but both constants have to move together. Do not put a private extension key in this repository to pin an ID.

## Popup

The popup reads the same storage items the worker writes. It pings the host and then asks for capabilities. The connection is shown as Connected only when the host reports `dryRunOnly: true`. A missing host is Not installed, with the local install command and this extension's ID. Other failures are Error.
