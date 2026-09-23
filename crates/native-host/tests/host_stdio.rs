//! The binary speaks Chrome's native-messaging frame format and keeps stdout clean.

use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

fn frame(payload: &[u8]) -> Vec<u8> {
    let mut framed = (payload.len() as u32).to_ne_bytes().to_vec();
    framed.extend_from_slice(payload);
    framed
}

fn decode_single_frame(bytes: &[u8]) -> Value {
    assert!(bytes.len() >= 4, "stdout did not contain a frame");
    let length = u32::from_ne_bytes(bytes[0..4].try_into().unwrap()) as usize;
    assert_eq!(
        bytes.len(),
        4 + length,
        "stdout contained bytes outside the native-messaging frame"
    );
    serde_json::from_slice(&bytes[4..]).unwrap()
}

fn exchange(payload: Value) -> (Value, String) {
    let bin = env!("CARGO_BIN_EXE_native_host");
    let mut child = Command::new(bin)
        .arg("chrome-extension://abcdefghijklmnopabcdefghijklmnop/")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let stdin = child.stdin.as_mut().unwrap();
        stdin.write_all(&frame(&serde_json::to_vec(&payload).unwrap())).unwrap();
    }
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "host exited with an error");
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        !stderr.to_ascii_lowercase().contains("panic"),
        "stderr contained a panic: {stderr}"
    );
    (decode_single_frame(&output.stdout), stderr)
}

#[test]
fn ping_over_stdio_returns_one_framed_response() {
    let (response, stderr) = exchange(json!({
        "protocolVersion": 1,
        "requestId": "stdio-ping",
        "type": "ping"
    }));
    assert_eq!(response["ok"], true);
    assert_eq!(response["requestId"], "stdio-ping");
    assert_eq!(response["result"]["pong"], true);
    assert!(!stderr.contains("stdio-ping"));
}

#[test]
fn dry_run_false_returns_a_structured_error_frame() {
    let (response, _) = exchange(json!({
        "protocolVersion": 1,
        "requestId": "stdio-real",
        "type": "execute_action",
        "action": "shutdown",
        "dryRun": false,
        "context": { "downloadId": 7, "filename": "notes.txt" }
    }));
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "dry_run_required");
    assert!(response.get("result").is_none());
}
