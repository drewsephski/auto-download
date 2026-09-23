# Native messaging protocol

Host name: `dev.downloadautomations.host`

Protocol version: `1`

Chrome frames every message as a native-endian `u32` byte length followed by that many UTF-8 JSON bytes. The `native_messaging` crate implements that framing. The host enforces an additional 16 KiB application limit. The crate also enforces Chrome's 1 MiB host-to-browser limit and a 64 MiB browser-to-host cap.

Responses always use `"protocolVersion": 1`, including errors. A request whose numeric version is not `1` gets `unsupported_protocol_version`. A missing or non-integer version is `malformed_request`.

`requestId` is 1–80 characters from `A-Z`, `a-z`, `0-9`, `_`, and `-`. The response copies it when the id is valid.

Unknown JSON fields are rejected. The browser cannot add a command, shell string, executable path, script, or argument list.

## `ping`

Request:

```json
{
  "protocolVersion": 1,
  "requestId": "req-1",
  "type": "ping"
}
```

Success:

```json
{
  "protocolVersion": 1,
  "requestId": "req-1",
  "ok": true,
  "result": { "pong": true }
}
```

## `get_capabilities`

Request:

```json
{
  "protocolVersion": 1,
  "requestId": "req-2",
  "type": "get_capabilities"
}
```

Success:

```json
{
  "protocolVersion": 1,
  "requestId": "req-2",
  "ok": true,
  "result": {
    "dryRunOnly": true,
    "actions": ["sleep", "shutdown", "reboot"]
  }
}
```

`dryRunOnly` is always `true` in this slice. The extension treats any other capabilities result as an error.

## `execute_action`

Request:

```json
{
  "protocolVersion": 1,
  "requestId": "req-3",
  "type": "execute_action",
  "action": "sleep",
  "dryRun": true,
  "context": {
    "downloadId": 123,
    "filename": "example.zip"
  }
}
```

`action` is `sleep`, `shutdown`, or `reboot`. `dryRun` must be the boolean `true`. `false`, a string, or a missing flag does not run anything. A present non-true value returns `dry_run_required`. A missing flag returns `malformed_request`.

`context.downloadId` is an integer from `0` through `Number.MAX_SAFE_INTEGER`. `context.filename` is a single path segment, 1–255 characters, without `/`, `\`, or control characters. The host validates the name and does not open it.

Success:

```json
{
  "protocolVersion": 1,
  "requestId": "req-3",
  "ok": true,
  "result": {
    "executed": false,
    "dryRun": true,
    "action": "sleep",
    "message": "Would put this computer to sleep"
  }
}
```

The other fixed messages are:

- `shutdown`: `Would shut down this computer`
- `reboot`: `Would restart this computer`

`executed` is always `false`. The extension rejects a response that claims the action ran.

## Errors

```json
{
  "protocolVersion": 1,
  "requestId": "req-3",
  "ok": false,
  "error": {
    "code": "dry_run_required",
    "message": "This host only accepts dry-run requests."
  }
}
```

| Code | When |
| --- | --- |
| `malformed_request` | JSON, types, required fields, filename, download id, or unknown fields are invalid |
| `payload_too_large` | The raw JSON exceeds 16 KiB, or the frame exceeds the crate limit |
| `unsupported_protocol_version` | `protocolVersion` is an integer other than `1` |
| `unknown_message_type` | `type` is not `ping`, `get_capabilities`, or `execute_action` |
| `unknown_action` | `action` is not `sleep`, `shutdown`, or `reboot` |
| `dry_run_required` | `dryRun` is present and is not `true` |

Error messages are fixed sentences. The host does not return stack traces, local paths, or the rejected payload. The extension also replaces known error codes with its own copy before showing them.

## Version policy

Version `1` is the only accepted request version. Adding a field or a message type requires a new protocol version, or a compatible optional field that old hosts can ignore. This host does not ignore unknown fields, so compatible additions still need a version bump until that policy changes. The settings document has its own `version: 1` and is not this protocol version.

## Process arguments

Chrome starts the host with the extension origin as an argument (`chrome-extension://<id>/`). The host ignores all arguments unless the first one is the developer subcommand `install`, `verify`, or `uninstall`. The origin is not an allowlist and not a command. The manifest `allowed_origins` entry is the browser's allowlist.
