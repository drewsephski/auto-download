# Native messaging protocol

Host name: `dev.downloadautomations.host`

Protocol version: `2`

Chrome frames every message as a native-endian `u32` byte length followed by that many UTF-8 JSON bytes. The `native_messaging` crate implements that framing. The host enforces an additional 16 KiB application limit. The crate also enforces Chrome's 1 MiB host-to-browser limit and a 64 MiB browser-to-host cap.

Responses always use `"protocolVersion": 2`, including errors. A request whose numeric version is not `2` gets `unsupported_protocol_version`. A version 1 client is not treated as a dry-run client. A missing or non-integer version is `malformed_request`.

`requestId` and `actionId` are 1–80 characters from `A-Z`, `a-z`, `0-9`, `_`, and `-`. The response copies `requestId` when the id is valid.

Unknown JSON fields are rejected. The browser cannot add a command, shell string, executable path, script, or argument list.

One-shot messages (`runtime.sendNativeMessage`) are `ping`, `get_capabilities`, `request_permission`, and dry-run `execute_action`. A real sleep uses a long-lived port (`runtime.connectNative`) and the messages `schedule_action` and `cancel_action`. The host process exits when that port closes. It does not persist the countdown.

## `ping`

Request:

```json
{
  "protocolVersion": 2,
  "requestId": "req-1",
  "type": "ping"
}
```

Success:

```json
{
  "protocolVersion": 2,
  "requestId": "req-1",
  "ok": true,
  "result": { "pong": true }
}
```

## `get_capabilities`

Request:

```json
{
  "protocolVersion": 2,
  "requestId": "req-2",
  "type": "get_capabilities"
}
```

Success on macOS:

```json
{
  "protocolVersion": 2,
  "requestId": "req-2",
  "ok": true,
  "result": {
    "platform": "macos",
    "dryRunActions": ["sleep", "shutdown", "reboot"],
    "realActions": ["sleep"],
    "countdown": {
      "required": true,
      "minimumSeconds": 10
    }
  }
}
```

Capabilities describe the host. They are not the security check. The request handler rejects real shut down, real restart, and any real sleep whose countdown is outside 10–120 seconds.

## `request_permission`

Sent only from the popup's **Allow macOS control** button. A finished download does not send it.

```json
{
  "protocolVersion": 2,
  "requestId": "req-3",
  "type": "request_permission"
}
```

On macOS the host calls `system_shutdown::request_permission_dialog()`. That runs one fixed System Events request to stop the current screen saver. Success:

```json
{
  "protocolVersion": 2,
  "requestId": "req-3",
  "ok": true,
  "result": { "permission": "granted" }
}
```

Failure is `permission_denied` or, off macOS, `permission_unavailable`. The extension does not store granted unless this success shape comes back. Error text from the operating system is not returned.

## `execute_action`

Dry-run only. `executionMode` must be `"dry_run"`. `"real"` returns `real_action_not_enabled` and runs nothing.

```json
{
  "protocolVersion": 2,
  "requestId": "req-4",
  "type": "execute_action",
  "action": "sleep",
  "executionMode": "dry_run",
  "context": {
    "downloadId": 123,
    "filename": "example.zip"
  }
}
```

`action` is `sleep`, `shutdown`, or `reboot`. `context.downloadId` is an integer from `0` through `Number.MAX_SAFE_INTEGER`. `context.filename` is a single path segment, 1–255 characters, without `/`, `\`, or control characters. The host validates the name and does not open it.

Success:

```json
{
  "protocolVersion": 2,
  "requestId": "req-4",
  "ok": true,
  "result": {
    "executed": false,
    "executionMode": "dry_run",
    "action": "sleep",
    "message": "Would put this computer to sleep"
  }
}
```

The other fixed messages are:

- `shutdown`: `Would shut down this computer`
- `reboot`: `Would restart this computer`

`executed` is always `false`. The extension rejects a dry-run response that claims the action ran.

## `schedule_action`

Real sleep on an open native port. The host allows one pending sleep per session. A second schedule while one is pending returns `coalesced` and does not start another timer.

```json
{
  "protocolVersion": 2,
  "requestId": "req-5",
  "type": "schedule_action",
  "actionId": "act-1",
  "action": "sleep",
  "executionMode": "real",
  "countdownSeconds": 30,
  "context": {
    "downloadId": 123,
    "filename": "example.zip"
  }
}
```

`countdownSeconds` is an integer from 10 through 120. This extension always sends 30. Real `shutdown` and real `reboot` return `real_action_not_enabled`.

Scheduled:

```json
{
  "protocolVersion": 2,
  "requestId": "req-5",
  "ok": true,
  "result": {
    "status": "scheduled",
    "actionId": "act-1",
    "action": "sleep",
    "executionMode": "real",
    "countdownSeconds": 30
  }
}
```

When the deadline passes and the port is still writable, the host sends `executing`, calls `system_shutdown::sleep()` once, then sends `executed` or `failed`. `failed` is not retried. If stdin closes first, the pending sleep is dropped and the process exits without calling sleep.

## `cancel_action`

```json
{
  "protocolVersion": 2,
  "requestId": "req-6",
  "type": "cancel_action",
  "actionId": "act-1"
}
```

Success uses `"status": "cancelled"`. A cancel for an id that is not pending returns `unknown_action_id` and leaves a different pending sleep alone.

## Errors

```json
{
  "protocolVersion": 2,
  "requestId": "req-5",
  "ok": false,
  "error": {
    "code": "real_action_not_enabled",
    "message": "Real execution is only enabled for sleep."
  }
}
```

| Code | When |
| --- | --- |
| `malformed_request` | JSON, types, required fields, filename, download id, or unknown fields are invalid |
| `payload_too_large` | The raw JSON exceeds 16 KiB, or the frame exceeds the crate limit |
| `unsupported_protocol_version` | `protocolVersion` is an integer other than `2` |
| `unknown_message_type` | `type` is not one of the six messages above |
| `unknown_action` | `action` is not `sleep`, `shutdown`, or `reboot` |
| `real_action_not_enabled` | Real execution was requested for anything other than scheduled sleep |
| `invalid_countdown` | The countdown is missing, not an integer, or outside 10–120 seconds |
| `invalid_action_id` | `actionId` is missing or not a token |
| `unknown_action_id` | Cancel did not match the pending sleep |
| `permission_denied` | System Events did not allow the permission request |
| `permission_unavailable` | This operating system cannot show that permission request |

Error messages are fixed sentences. The host does not return stack traces, local paths, or the rejected payload.

## Version policy

Version `2` is the only accepted request version. Version `1` is rejected. The settings document has its own `version: 2` and is not this protocol version.

## Process arguments

Chrome starts the host with the extension origin as an argument (`chrome-extension://<id>/`). The host ignores all arguments unless the first one is the developer subcommand `install`, `verify`, or `uninstall`. The origin is not an allowlist and not a command. The manifest `allowed_origins` entry is the browser's allowlist.
