//! Versioned JSON protocol shared with the extension.
//!
//! Every request is validated here. Unknown fields are rejected so a caller cannot
//! smuggle a command, path, script, or argument alongside an allowlisted message.
//! Real execution is limited to the host allowlist. One-shot requests cannot run it.

use crate::os_adapter::{
    is_real_action, platform_name, real_action_names, simulate, PowerAction, MAX_COUNTDOWN_SECONDS,
    MIN_COUNTDOWN_SECONDS,
};
use crate::PROTOCOL_VERSION;
use serde::Serialize;
use serde_json::{Map, Number, Value};

/// Application payload cap. The native-messaging crate also enforces the browser frame limit.
pub const MAX_REQUEST_BYTES: usize = 16 * 1024;

const MAX_REQUEST_ID_LEN: usize = 80;
const MAX_FILENAME_LEN: usize = 255;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

const COMMON_FIELDS: &[&str] = &["protocolVersion", "requestId", "type"];
const EXECUTE_FIELDS: &[&str] = &[
    "protocolVersion",
    "requestId",
    "type",
    "action",
    "executionMode",
    "context",
];
const SCHEDULE_FIELDS: &[&str] = &[
    "protocolVersion",
    "requestId",
    "type",
    "actionId",
    "action",
    "executionMode",
    "countdownSeconds",
    "context",
];
const CANCEL_FIELDS: &[&str] = &["protocolVersion", "requestId", "type", "actionId"];
const CONTEXT_FIELDS: &[&str] = &["downloadId", "filename"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HostResponse {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u32,
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ErrorBody {
    pub code: &'static str,
    pub message: &'static str,
}

/// A validated request that needs session state. Stateless requests are already responses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Intake {
    Respond(HostResponse),
    RequestPermission {
        request_id: String,
    },
    Schedule(ScheduledAction),
    Cancel {
        request_id: String,
        action_id: String,
    },
}

/// A real power request that has already passed validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledAction {
    pub request_id: String,
    pub action_id: String,
    pub action: PowerAction,
    pub countdown_seconds: u64,
    pub download_id: i64,
    pub filename: String,
}

/// Validate one JSON request. Scheduling and cancellation are returned for the session.
pub fn interpret(raw: &str) -> Intake {
    if raw.len() > MAX_REQUEST_BYTES {
        return Intake::Respond(failure(
            "",
            "payload_too_large",
            "The request is too large.",
        ));
    }

    let value: Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(_) => {
            return Intake::Respond(failure(
                "",
                "malformed_request",
                "The request was not valid JSON.",
            ));
        }
    };

    let Some(object) = value.as_object() else {
        return Intake::Respond(failure(
            "",
            "malformed_request",
            "The request must be a JSON object.",
        ));
    };

    let request_id = match request_id_from(object) {
        Ok(request_id) => request_id,
        Err(response) => return Intake::Respond(response),
    };

    match protocol_version_from(object) {
        VersionParse::Missing | VersionParse::Invalid => {
            return Intake::Respond(failure(
                &request_id,
                "malformed_request",
                "The request protocol version is missing or invalid.",
            ));
        }
        VersionParse::Number(version) if version != u64::from(PROTOCOL_VERSION) => {
            return Intake::Respond(failure(
                &request_id,
                "unsupported_protocol_version",
                "This host only accepts protocol version 2.",
            ));
        }
        VersionParse::Number(_) => {}
    }

    let Some(message_type) = object.get("type").and_then(Value::as_str) else {
        return Intake::Respond(failure(
            &request_id,
            "malformed_request",
            "The request type is missing or invalid.",
        ));
    };

    match message_type {
        "ping" => Intake::Respond(handle_ping(&request_id, object)),
        "get_capabilities" => Intake::Respond(handle_capabilities(&request_id, object)),
        "execute_action" => Intake::Respond(handle_execute(&request_id, object)),
        "request_permission" => handle_permission_intake(&request_id, object),
        "schedule_action" => handle_schedule_intake(&request_id, object),
        "cancel_action" => handle_cancel_intake(&request_id, object),
        _ => Intake::Respond(failure(
            &request_id,
            "unknown_message_type",
            "The request type is not supported.",
        )),
    }
}

fn handle_ping(request_id: &str, object: &Map<String, Value>) -> HostResponse {
    if !only_keys(object, COMMON_FIELDS) {
        return failure(
            request_id,
            "malformed_request",
            "The ping request contains unsupported fields.",
        );
    }
    success(request_id, serde_json::json!({ "pong": true }))
}

fn handle_capabilities(request_id: &str, object: &Map<String, Value>) -> HostResponse {
    if !only_keys(object, COMMON_FIELDS) {
        return failure(
            request_id,
            "malformed_request",
            "The capabilities request contains unsupported fields.",
        );
    }
    success(
        request_id,
        serde_json::json!({
            "platform": platform_name(),
            "dryRunActions": ["sleep", "shutdown", "reboot"],
            "realActions": real_action_names(),
            "countdown": {
                "required": true,
                "minimumSeconds": MIN_COUNTDOWN_SECONDS,
            },
        }),
    )
}

fn handle_execute(request_id: &str, object: &Map<String, Value>) -> HostResponse {
    if !only_keys(object, EXECUTE_FIELDS) {
        return failure(
            request_id,
            "malformed_request",
            "The action request contains unsupported fields.",
        );
    }

    let Some(action) = parse_action(object) else {
        return match object.get("action") {
            Some(Value::String(name)) if PowerAction::parse(name).is_none() => {
                failure(request_id, "unknown_action", "The action is not supported.")
            }
            _ => failure(
                request_id,
                "malformed_request",
                "The action request is missing an action.",
            ),
        };
    };

    match object.get("executionMode").and_then(Value::as_str) {
        Some("dry_run") => {}
        Some("real") => {
            return failure(
                request_id,
                "real_action_not_enabled",
                "Real actions must be scheduled on a live connection.",
            );
        }
        Some(_) => {
            return failure(
                request_id,
                "malformed_request",
                "The execution mode is not supported.",
            );
        }
        None => {
            return failure(
                request_id,
                "malformed_request",
                "The action request is missing executionMode.",
            );
        }
    }

    if let Err(response) = parse_context(request_id, object) {
        return response;
    }

    let simulated = simulate(action);
    success(
        request_id,
        serde_json::json!({
            "executed": simulated.executed,
            "executionMode": "dry_run",
            "action": simulated.action.as_str(),
            "message": simulated.message,
        }),
    )
}

fn handle_permission_intake(request_id: &str, object: &Map<String, Value>) -> Intake {
    if !only_keys(object, COMMON_FIELDS) {
        return Intake::Respond(failure(
            request_id,
            "malformed_request",
            "The permission request contains unsupported fields.",
        ));
    }
    Intake::RequestPermission {
        request_id: request_id.to_string(),
    }
}

fn handle_schedule_intake(request_id: &str, object: &Map<String, Value>) -> Intake {
    if !only_keys(object, SCHEDULE_FIELDS) {
        return Intake::Respond(failure(
            request_id,
            "malformed_request",
            "The schedule request contains unsupported fields.",
        ));
    }

    let Some(action_name) = object.get("action").and_then(Value::as_str) else {
        return Intake::Respond(failure(
            request_id,
            "malformed_request",
            "The schedule request is missing an action.",
        ));
    };
    let Some(action) = PowerAction::parse(action_name) else {
        return Intake::Respond(failure(
            request_id,
            "unknown_action",
            "The action is not supported.",
        ));
    };

    let execution_mode = object.get("executionMode").and_then(Value::as_str);
    if execution_mode != Some("real") {
        return Intake::Respond(failure(
            request_id,
            "malformed_request",
            "A scheduled action must use real execution mode.",
        ));
    }
    if !is_real_action(action) {
        return Intake::Respond(failure(
            request_id,
            "real_action_not_enabled",
            "Real execution is not enabled for this action.",
        ));
    }

    let Some(countdown_seconds) = object
        .get("countdownSeconds")
        .and_then(Value::as_u64)
        .filter(|seconds| (MIN_COUNTDOWN_SECONDS..=MAX_COUNTDOWN_SECONDS).contains(seconds))
    else {
        return Intake::Respond(failure(
            request_id,
            "invalid_countdown",
            "The countdown must be a whole number of seconds inside the allowed range.",
        ));
    };

    let Some(action_id) = object.get("actionId").and_then(Value::as_str) else {
        return Intake::Respond(failure(
            request_id,
            "invalid_action_id",
            "The action id is missing or invalid.",
        ));
    };
    if !valid_token(action_id) {
        return Intake::Respond(failure(
            request_id,
            "invalid_action_id",
            "The action id is missing or invalid.",
        ));
    }

    let context = match parse_context(request_id, object) {
        Ok(context) => context,
        Err(response) => return Intake::Respond(response),
    };

    Intake::Schedule(ScheduledAction {
        request_id: request_id.to_string(),
        action_id: action_id.to_string(),
        action,
        countdown_seconds,
        download_id: context.0,
        filename: context.1,
    })
}

fn handle_cancel_intake(request_id: &str, object: &Map<String, Value>) -> Intake {
    if !only_keys(object, CANCEL_FIELDS) {
        return Intake::Respond(failure(
            request_id,
            "malformed_request",
            "The cancel request contains unsupported fields.",
        ));
    }
    let Some(action_id) = object.get("actionId").and_then(Value::as_str) else {
        return Intake::Respond(failure(
            request_id,
            "invalid_action_id",
            "The action id is missing or invalid.",
        ));
    };
    if !valid_token(action_id) {
        return Intake::Respond(failure(
            request_id,
            "invalid_action_id",
            "The action id is missing or invalid.",
        ));
    }
    Intake::Cancel {
        request_id: request_id.to_string(),
        action_id: action_id.to_string(),
    }
}

fn parse_action(object: &Map<String, Value>) -> Option<PowerAction> {
    let name = object.get("action")?.as_str()?;
    PowerAction::parse(name)
}

fn parse_context(
    request_id: &str,
    object: &Map<String, Value>,
) -> Result<(i64, String), HostResponse> {
    let Some(context) = object.get("context").and_then(Value::as_object) else {
        return Err(failure(
            request_id,
            "malformed_request",
            "The action request is missing context.",
        ));
    };
    if !only_keys(context, CONTEXT_FIELDS) {
        return Err(failure(
            request_id,
            "malformed_request",
            "The action context contains unsupported fields.",
        ));
    }
    let Some(download_id) = parse_download_id(context.get("downloadId")) else {
        return Err(failure(
            request_id,
            "malformed_request",
            "The download id is missing or invalid.",
        ));
    };
    let Some(filename) = filename_from(context.get("filename")) else {
        return Err(failure(
            request_id,
            "malformed_request",
            "The filename is missing or invalid.",
        ));
    };
    Ok((download_id, filename))
}

pub fn success(request_id: &str, result: Value) -> HostResponse {
    HostResponse {
        protocol_version: PROTOCOL_VERSION,
        request_id: request_id.to_string(),
        ok: true,
        result: Some(result),
        error: None,
    }
}

pub fn failure(request_id: &str, code: &'static str, message: &'static str) -> HostResponse {
    HostResponse {
        protocol_version: PROTOCOL_VERSION,
        request_id: request_id.to_string(),
        ok: false,
        result: None,
        error: Some(ErrorBody { code, message }),
    }
}

pub fn permission_response(
    request_id: &str,
    outcome: crate::os_adapter::PermissionOutcome,
) -> HostResponse {
    use crate::os_adapter::PermissionOutcome;
    match outcome {
        PermissionOutcome::Granted => {
            success(request_id, serde_json::json!({ "permission": "granted" }))
        }
        PermissionOutcome::Denied => failure(
            request_id,
            "permission_denied",
            "macOS did not allow System Events control.",
        ),
        PermissionOutcome::Unavailable => failure(
            request_id,
            "permission_unavailable",
            "System Events permission cannot be requested on this system.",
        ),
    }
}

enum VersionParse {
    Missing,
    Invalid,
    Number(u64),
}

fn protocol_version_from(object: &Map<String, Value>) -> VersionParse {
    match object.get("protocolVersion") {
        None => VersionParse::Missing,
        Some(Value::Number(number)) => match integer_number(number) {
            Some(version) => VersionParse::Number(version),
            None => VersionParse::Invalid,
        },
        Some(_) => VersionParse::Invalid,
    }
}

fn integer_number(number: &Number) -> Option<u64> {
    if let Some(value) = number.as_u64() {
        return Some(value);
    }
    let value = number.as_f64()?;
    if value.fract() == 0.0 && (0.0..u64::MAX as f64).contains(&value) {
        return Some(value as u64);
    }
    None
}

fn request_id_from(object: &Map<String, Value>) -> Result<String, HostResponse> {
    match object.get("requestId") {
        Some(Value::String(request_id)) if valid_token(request_id) => Ok(request_id.clone()),
        Some(_) | None => Err(failure(
            "",
            "malformed_request",
            "The request id is missing or invalid.",
        )),
    }
}

fn valid_token(value: &str) -> bool {
    let length = value.len();
    (1..=MAX_REQUEST_ID_LEN).contains(&length)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn parse_download_id(value: Option<&Value>) -> Option<i64> {
    let number = value?.as_i64()?;
    if (0..=MAX_SAFE_INTEGER).contains(&number) {
        Some(number)
    } else {
        None
    }
}

fn filename_from(value: Option<&Value>) -> Option<String> {
    let Value::String(filename) = value? else {
        return None;
    };
    if valid_filename(filename) {
        Some(filename.clone())
    } else {
        None
    }
}

fn valid_filename(filename: &str) -> bool {
    let length = filename.chars().count();
    if !(1..=MAX_FILENAME_LEN).contains(&length) {
        return false;
    }
    if filename == "." || filename == ".." {
        return false;
    }
    filename.chars().all(|character| {
        character != '/' && character != '\\' && character != '\0' && !character.is_control()
    })
}

fn only_keys(object: &Map<String, Value>, allowed: &[&str]) -> bool {
    object.keys().all(|key| allowed.contains(&key.as_str()))
}

#[cfg(test)]
mod tests {
    use super::{interpret, Intake, MAX_REQUEST_BYTES};
    use crate::os_adapter::real_action_names;
    use native_messaging::host::{decode_message, encode_message, MAX_FROM_BROWSER};
    use serde_json::json;
    use std::io::Cursor;

    fn request(value: serde_json::Value) -> String {
        serde_json::to_string(&value).unwrap()
    }

    fn respond(raw: &str) -> crate::protocol::HostResponse {
        match interpret(raw) {
            Intake::Respond(response) => response,
            other => panic!("expected an immediate response, got {other:?}"),
        }
    }

    fn execute(action: &str, mode: &str) -> serde_json::Value {
        json!({
            "protocolVersion": 2,
            "requestId": "req-1",
            "type": "execute_action",
            "action": action,
            "executionMode": mode,
            "context": { "downloadId": 42, "filename": "example.zip" }
        })
    }

    fn schedule(action: &str, countdown: serde_json::Value) -> serde_json::Value {
        json!({
            "protocolVersion": 2,
            "requestId": "req-1",
            "type": "schedule_action",
            "actionId": "act-1",
            "action": action,
            "executionMode": "real",
            "countdownSeconds": countdown,
            "context": { "downloadId": 42, "filename": "example.zip" }
        })
    }

    #[test]
    fn ping_succeeds() {
        let response = respond(&request(json!({
            "protocolVersion": 2,
            "requestId": "req-1",
            "type": "ping"
        })));
        assert!(response.ok);
        assert_eq!(response.protocol_version, 2);
        assert_eq!(response.result.unwrap()["pong"], true);
    }

    #[test]
    fn capabilities_list_real_actions_separately_from_dry_run() {
        let response = respond(&request(json!({
            "protocolVersion": 2,
            "requestId": "req-1",
            "type": "get_capabilities"
        })));
        let result = response.result.unwrap();
        assert_eq!(
            result["dryRunActions"],
            json!(["sleep", "shutdown", "reboot"])
        );
        assert_eq!(result["realActions"], json!(real_action_names()));
        assert_eq!(result["countdown"]["required"], true);
        assert_eq!(result["countdown"]["minimumSeconds"], 10);
    }

    #[test]
    fn version_1_is_rejected() {
        let response = respond(&request(json!({
            "protocolVersion": 1,
            "requestId": "req-1",
            "type": "ping"
        })));
        assert_eq!(response.protocol_version, 2);
        assert_eq!(response.error.unwrap().code, "unsupported_protocol_version");
    }

    #[test]
    fn dry_run_actions_are_not_executed() {
        for (action, message) in [
            ("sleep", "Would put this computer to sleep"),
            ("shutdown", "Would shut down this computer"),
            ("reboot", "Would restart this computer"),
        ] {
            let response = respond(&request(execute(action, "dry_run")));
            let result = response.result.expect(action);
            assert_eq!(result["executed"], false);
            assert_eq!(result["executionMode"], "dry_run");
            assert_eq!(result["action"], action);
            assert_eq!(result["message"], message);
        }
    }

    #[test]
    fn one_shot_real_execution_is_rejected() {
        let response = respond(&request(execute("sleep", "real")));
        assert_eq!(response.error.unwrap().code, "real_action_not_enabled");
        assert!(response.result.is_none());
    }

    #[test]
    fn real_power_actions_follow_the_host_allowlist() {
        for action in ["sleep", "shutdown", "reboot"] {
            let intake = interpret(&request(schedule(action, json!(30))));
            if real_action_names().contains(&action) {
                match intake {
                    Intake::Schedule(scheduled) => {
                        assert_eq!(scheduled.action.as_str(), action);
                        assert_eq!(scheduled.action_id, "act-1");
                        assert_eq!(scheduled.countdown_seconds, 30);
                        assert_eq!(scheduled.download_id, 42);
                        assert_eq!(scheduled.filename, "example.zip");
                    }
                    other => panic!("expected schedule for {action}, got {other:?}"),
                }
            } else {
                match intake {
                    Intake::Respond(response) => {
                        assert_eq!(response.error.unwrap().code, "real_action_not_enabled");
                    }
                    other => panic!("expected rejection for {action}, got {other:?}"),
                }
            }
        }
    }

    #[test]
    fn unknown_schedule_action_is_rejected() {
        let response = respond(&request(schedule("hibernate", json!(30))));
        assert_eq!(response.error.unwrap().code, "unknown_action");
    }

    #[test]
    fn invalid_schedule_execution_mode_is_rejected() {
        let mut payload = schedule("sleep", json!(30));
        payload["executionMode"] = json!("dry_run");
        let response = respond(&request(payload));
        assert_eq!(response.error.unwrap().code, "malformed_request");
    }

    #[test]
    fn short_and_fractional_countdowns_are_rejected() {
        for countdown in [json!(9), json!(0), json!(121), json!(30.5), json!("30")] {
            let response = respond(&request(schedule("sleep", countdown)));
            assert_eq!(response.error.unwrap().code, "invalid_countdown");
        }
    }

    #[test]
    fn invalid_action_ids_are_rejected() {
        let long_id = "x".repeat(81);
        for action_id in ["", "has space", "../sleep", long_id.as_str()] {
            let mut payload = schedule("sleep", json!(30));
            payload["actionId"] = json!(action_id);
            let response = respond(&request(payload));
            assert_eq!(response.error.unwrap().code, "invalid_action_id");
        }
    }

    #[test]
    fn malformed_json_is_rejected_without_echoing_the_input() {
        let response = respond("{");
        let error = response.error.unwrap();
        assert_eq!(error.code, "malformed_request");
        assert!(!error.message.contains('{'));
    }

    #[test]
    fn unknown_message_type_is_rejected() {
        let response = respond(&request(json!({
            "protocolVersion": 2,
            "requestId": "req-1",
            "type": "run_shell"
        })));
        assert_eq!(response.error.unwrap().code, "unknown_message_type");
    }

    #[test]
    fn unknown_action_is_rejected() {
        let response = respond(&request(execute("hibernate", "dry_run")));
        assert_eq!(response.error.unwrap().code, "unknown_action");
    }

    #[test]
    fn command_path_script_and_argument_fields_are_rejected() {
        for (field, value) in [
            ("command", json!("shutdown -h now")),
            ("path", json!("/tmp/helper")),
            (
                "script",
                json!("tell application \"System Events\" to sleep"),
            ),
            ("args", json!(["-e", "sleep"])),
            ("executable", json!("osascript")),
        ] {
            let mut payload = schedule("sleep", json!(30));
            payload
                .as_object_mut()
                .unwrap()
                .insert(field.to_string(), value);
            let response = respond(&request(payload));
            let error = response.error.unwrap();
            assert_eq!(error.code, "malformed_request");
            assert!(!error.message.contains("shutdown"));
            assert!(!error.message.contains("osascript"));
        }
    }

    #[test]
    fn hostile_filename_is_metadata_only() {
        let mut payload = execute("sleep", "dry_run");
        payload["context"]["filename"] = json!("$(rm -rf home)");
        let response = respond(&request(payload));
        let result = response.result.unwrap();
        assert_eq!(result["executed"], false);
        assert_eq!(result["message"], "Would put this computer to sleep");
        assert!(result.get("filename").is_none());
    }

    #[test]
    fn path_like_filename_is_rejected() {
        let mut payload = execute("sleep", "dry_run");
        payload["context"]["filename"] = json!("/tmp/example.zip");
        let response = respond(&request(payload));
        assert_eq!(response.error.unwrap().code, "malformed_request");
    }

    #[test]
    fn oversized_payload_is_rejected() {
        let raw = "x".repeat(MAX_REQUEST_BYTES + 1);
        let response = respond(&raw);
        assert_eq!(response.error.unwrap().code, "payload_too_large");
    }

    #[test]
    fn response_round_trips_through_native_messaging_framing() {
        let response = respond(&request(json!({
            "protocolVersion": 2,
            "requestId": "req-1",
            "type": "ping"
        })));
        let frame = encode_message(&response).unwrap();
        let mut cursor = Cursor::new(frame);
        let raw = decode_message(&mut cursor, MAX_FROM_BROWSER).unwrap();
        let decoded: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(decoded["ok"], true);
        assert_eq!(decoded["protocolVersion"], 2);
        assert_eq!(decoded["result"]["pong"], true);
        assert_eq!(cursor.position() as usize, cursor.get_ref().len());
    }
}
