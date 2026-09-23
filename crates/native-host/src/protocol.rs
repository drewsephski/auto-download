//! Versioned JSON protocol shared with the extension.
//!
//! Every request is validated here. Unknown fields are rejected so a caller cannot
//! smuggle a command, path, or argument alongside an allowlisted message.

use crate::os_adapter::{simulate, PowerAction};
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
    "dryRun",
    "context",
];
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

/// Validate one JSON request and return a response that is safe to send to the browser.
pub fn handle_request(raw: &str) -> HostResponse {
    if raw.len() > MAX_REQUEST_BYTES {
        return failure("", "payload_too_large", "The request is too large.");
    }

    let value: Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(_) => {
            return failure(
                "",
                "malformed_request",
                "The request was not valid JSON.",
            )
        }
    };

    let Some(object) = value.as_object() else {
        return failure("", "malformed_request", "The request must be a JSON object.");
    };

    let request_id = match request_id_from(object) {
        Ok(request_id) => request_id,
        Err(response) => return response,
    };

    match protocol_version_from(object) {
        VersionParse::Missing | VersionParse::Invalid => {
            return failure(
                &request_id,
                "malformed_request",
                "The request protocol version is missing or invalid.",
            );
        }
        VersionParse::Number(version) if version != u64::from(PROTOCOL_VERSION) => {
            return failure(
                &request_id,
                "unsupported_protocol_version",
                "This host only accepts protocol version 1.",
            );
        }
        VersionParse::Number(_) => {}
    }

    let Some(message_type) = object.get("type").and_then(Value::as_str) else {
        return failure(
            &request_id,
            "malformed_request",
            "The request type is missing or invalid.",
        );
    };

    match message_type {
        "ping" => handle_ping(&request_id, object),
        "get_capabilities" => handle_capabilities(&request_id, object),
        "execute_action" => handle_execute(&request_id, object),
        _ => failure(
            &request_id,
            "unknown_message_type",
            "The request type is not supported.",
        ),
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
            "dryRunOnly": true,
            "actions": ["sleep", "shutdown", "reboot"],
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

    let Some(action_value) = object.get("action") else {
        return failure(
            request_id,
            "malformed_request",
            "The action request is missing an action.",
        );
    };
    let Some(action_name) = action_value.as_str() else {
        return failure(
            request_id,
            "malformed_request",
            "The action must be a string.",
        );
    };
    let Some(action) = PowerAction::parse(action_name) else {
        return failure(
            request_id,
            "unknown_action",
            "The action is not supported.",
        );
    };

    match object.get("dryRun") {
        Some(Value::Bool(true)) => {}
        Some(_) => {
            return failure(
                request_id,
                "dry_run_required",
                "This host only accepts dry-run requests.",
            );
        }
        None => {
            return failure(
                request_id,
                "malformed_request",
                "The action request is missing dryRun.",
            );
        }
    }

    let Some(context) = object.get("context").and_then(Value::as_object) else {
        return failure(
            request_id,
            "malformed_request",
            "The action request is missing context.",
        );
    };
    if !only_keys(context, CONTEXT_FIELDS) {
        return failure(
            request_id,
            "malformed_request",
            "The action context contains unsupported fields.",
        );
    }
    if parse_download_id(context.get("downloadId")).is_none() {
        return failure(
            request_id,
            "malformed_request",
            "The download id is missing or invalid.",
        );
    }
    if !valid_filename(context.get("filename")) {
        return failure(
            request_id,
            "malformed_request",
            "The filename is missing or invalid.",
        );
    }

    let simulated = simulate(action);
    success(
        request_id,
        serde_json::json!({
            "executed": simulated.executed,
            "dryRun": simulated.dry_run,
            "action": simulated.action.as_str(),
            "message": simulated.message,
        }),
    )
}

fn success(request_id: &str, result: Value) -> HostResponse {
    HostResponse {
        protocol_version: PROTOCOL_VERSION,
        request_id: request_id.to_string(),
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn failure(request_id: &str, code: &'static str, message: &'static str) -> HostResponse {
    HostResponse {
        protocol_version: PROTOCOL_VERSION,
        request_id: request_id.to_string(),
        ok: false,
        result: None,
        error: Some(ErrorBody { code, message }),
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
        Some(Value::String(request_id)) if valid_request_id(request_id) => Ok(request_id.clone()),
        Some(_) | None => Err(failure(
            "",
            "malformed_request",
            "The request id is missing or invalid.",
        )),
    }
}

fn valid_request_id(request_id: &str) -> bool {
    let length = request_id.len();
    (1..=MAX_REQUEST_ID_LEN).contains(&length)
        && request_id
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

fn valid_filename(value: Option<&Value>) -> bool {
    let filename = value?.as_str()?;
    let length = filename.chars().count();
    if !(1..=MAX_FILENAME_LEN).contains(&length) {
        return false;
    }
    if filename == "." || filename == ".." {
        return false;
    }
    filename.chars().all(|character| {
        character != '/'
            && character != '\\'
            && character != '\0'
            && !character.is_control()
    })
}

fn only_keys(object: &Map<String, Value>, allowed: &[&str]) -> bool {
    object.keys().all(|key| allowed.contains(&key.as_str()))
}

#[cfg(test)]
mod tests {
    use super::{handle_request, MAX_REQUEST_BYTES};
    use native_messaging::host::{decode_message, encode_message, MAX_FROM_BROWSER};
    use serde_json::json;
    use std::io::Cursor;

    fn request(value: serde_json::Value) -> String {
        serde_json::to_string(&value).unwrap()
    }

    fn execute(action: &str, dry_run: serde_json::Value) -> serde_json::Value {
        json!({
            "protocolVersion": 1,
            "requestId": "req-1",
            "type": "execute_action",
            "action": action,
            "dryRun": dry_run,
            "context": { "downloadId": 42, "filename": "example.zip" }
        })
    }

    #[test]
    fn ping_succeeds() {
        let response = handle_request(&request(json!({
            "protocolVersion": 1,
            "requestId": "req-1",
            "type": "ping"
        })));
        assert!(response.ok);
        assert_eq!(response.result.unwrap()["pong"], true);
        assert!(response.error.is_none());
    }

    #[test]
    fn capabilities_are_dry_run_only() {
        let response = handle_request(&request(json!({
            "protocolVersion": 1,
            "requestId": "req-1",
            "type": "get_capabilities"
        })));
        let result = response.result.unwrap();
        assert_eq!(result["dryRunOnly"], true);
        assert_eq!(result["actions"], json!(["sleep", "shutdown", "reboot"]));
    }

    #[test]
    fn dry_run_actions_are_not_executed() {
        for (action, message) in [
            ("sleep", "Would put this computer to sleep"),
            ("shutdown", "Would shut down this computer"),
            ("reboot", "Would restart this computer"),
        ] {
            let response = handle_request(&request(execute(action, json!(true))));
            let result = response.result.expect(action);
            assert_eq!(result["executed"], false);
            assert_eq!(result["dryRun"], true);
            assert_eq!(result["action"], action);
            assert_eq!(result["message"], message);
        }
    }

    #[test]
    fn malformed_json_is_rejected_without_echoing_the_input() {
        let response = handle_request("{");
        let error = response.error.unwrap();
        assert_eq!(error.code, "malformed_request");
        assert!(!error.message.contains("{"));
        assert!(response.result.is_none());
    }

    #[test]
    fn unsupported_protocol_version_is_rejected() {
        let response = handle_request(&request(json!({
            "protocolVersion": 2,
            "requestId": "req-1",
            "type": "ping"
        })));
        assert_eq!(
            response.error.unwrap().code,
            "unsupported_protocol_version"
        );
    }

    #[test]
    fn unknown_message_type_is_rejected() {
        let response = handle_request(&request(json!({
            "protocolVersion": 1,
            "requestId": "req-1",
            "type": "run_shell"
        })));
        assert_eq!(response.error.unwrap().code, "unknown_message_type");
    }

    #[test]
    fn unknown_action_is_rejected() {
        let response = handle_request(&request(execute("hibernate", json!(true))));
        assert_eq!(response.error.unwrap().code, "unknown_action");
    }

    #[test]
    fn real_execution_flag_is_rejected() {
        let response = handle_request(&request(execute("sleep", json!(false))));
        assert_eq!(response.error.unwrap().code, "dry_run_required");
        assert!(response.result.is_none());
    }

    #[test]
    fn string_dry_run_flag_is_rejected() {
        let response = handle_request(&request(execute("sleep", json!("true"))));
        assert_eq!(response.error.unwrap().code, "dry_run_required");
    }

    #[test]
    fn command_field_is_rejected() {
        let mut payload = execute("sleep", json!(true));
        payload
            .as_object_mut()
            .unwrap()
            .insert("command".to_string(), json!("shutdown -h now"));
        let response = handle_request(&request(payload));
        let error = response.error.unwrap();
        assert_eq!(error.code, "malformed_request");
        assert!(!error.message.contains("shutdown"));
    }

    #[test]
    fn filename_is_not_turned_into_a_command() {
        let mut payload = execute("sleep", json!(true));
        payload["context"]["filename"] = json!("$(rm -rf home)");
        let response = handle_request(&request(payload));
        let result = response.result.unwrap();
        assert_eq!(result["executed"], false);
        assert_eq!(result["message"], "Would put this computer to sleep");
    }

    #[test]
    fn path_like_filename_is_rejected() {
        let mut payload = execute("sleep", json!(true));
        payload["context"]["filename"] = json!("/tmp/example.zip");
        let response = handle_request(&request(payload));
        assert_eq!(response.error.unwrap().code, "malformed_request");
    }

    #[test]
    fn oversized_payload_is_rejected() {
        let raw = "x".repeat(MAX_REQUEST_BYTES + 1);
        let response = handle_request(&raw);
        assert_eq!(response.error.unwrap().code, "payload_too_large");
    }

    #[test]
    fn response_round_trips_through_native_messaging_framing() {
        let response = handle_request(&request(json!({
            "protocolVersion": 1,
            "requestId": "req-1",
            "type": "ping"
        })));
        let frame = encode_message(&response).unwrap();
        let mut cursor = Cursor::new(frame);
        let raw = decode_message(&mut cursor, MAX_FROM_BROWSER).unwrap();
        let decoded: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(decoded["ok"], true);
        assert_eq!(decoded["result"]["pong"], true);
        assert_eq!(cursor.position() as usize, cursor.get_ref().len());
    }
}
