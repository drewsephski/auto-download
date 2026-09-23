//! The binary speaks Chrome's native-messaging frame format and keeps stdout clean.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

fn frame(payload: &[u8]) -> Vec<u8> {
    let mut framed = (payload.len() as u32).to_ne_bytes().to_vec();
    framed.extend_from_slice(payload);
    framed
}

fn decode_frames(bytes: &[u8]) -> Vec<Value> {
    let mut frames = Vec::new();
    let mut rest = bytes;
    while !rest.is_empty() {
        assert!(rest.len() >= 4, "stdout ended inside a frame header");
        let length = u32::from_ne_bytes(rest[0..4].try_into().unwrap()) as usize;
        assert!(rest.len() >= 4 + length, "stdout ended inside a frame body");
        frames.push(serde_json::from_slice(&rest[4..4 + length]).unwrap());
        rest = &rest[4 + length..];
    }
    frames
}

fn exchange(payload: Value) -> (Value, String) {
    let frames = exchange_all(payload, Duration::from_secs(3));
    assert_eq!(frames.0.len(), 1, "expected one stdout frame");
    (frames.0.into_iter().next().unwrap(), frames.1)
}

fn exchange_all(payload: Value, timeout: Duration) -> (Vec<Value>, String) {
    let bin = env!("CARGO_BIN_EXE_native-host");
    let mut child = Command::new(bin)
        .arg("chrome-extension://abcdefghijklmnopabcdefghijklmnop/")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    stdin
        .write_all(&frame(&serde_json::to_vec(&payload).unwrap()))
        .unwrap();
    drop(stdin);

    let stdout_thread = thread::spawn(move || {
        let mut buffer = Vec::new();
        stdout.read_to_end(&mut buffer).unwrap();
        buffer
    });
    let stderr_thread = thread::spawn(move || {
        let mut buffer = Vec::new();
        stderr.read_to_end(&mut buffer).unwrap();
        buffer
    });

    let started = Instant::now();
    loop {
        if child.try_wait().unwrap().is_some() {
            break;
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            panic!("host stayed alive after stdin closed");
        }
        thread::sleep(Duration::from_millis(20));
    }

    let stdout_bytes = stdout_thread.join().unwrap();
    let stderr_bytes = stderr_thread.join().unwrap();
    let stderr = String::from_utf8(stderr_bytes).unwrap();
    assert!(
        !stderr.to_ascii_lowercase().contains("panic"),
        "stderr contained a panic: {stderr}"
    );
    (decode_frames(&stdout_bytes), stderr)
}

#[test]
fn ping_over_stdio_returns_one_framed_response() {
    let (response, stderr) = exchange(json!({
        "protocolVersion": 2,
        "requestId": "stdio-ping",
        "type": "ping"
    }));
    assert_eq!(response["ok"], true);
    assert_eq!(response["protocolVersion"], 2);
    assert_eq!(response["requestId"], "stdio-ping");
    assert_eq!(response["result"]["pong"], true);
    assert!(!stderr.contains("stdio-ping"));
}

#[test]
fn version_1_is_rejected_on_stdio() {
    let (response, _) = exchange(json!({
        "protocolVersion": 1,
        "requestId": "stdio-v1",
        "type": "ping"
    }));
    assert_eq!(response["ok"], false);
    assert_eq!(response["protocolVersion"], 2);
    assert_eq!(response["error"]["code"], "unsupported_protocol_version");
}

#[test]
fn dry_run_shutdown_returns_a_simulation() {
    let (response, _) = exchange(json!({
        "protocolVersion": 2,
        "requestId": "stdio-dry",
        "type": "execute_action",
        "action": "shutdown",
        "executionMode": "dry_run",
        "context": { "downloadId": 7, "filename": "notes.txt" }
    }));
    assert_eq!(response["ok"], true);
    assert_eq!(response["result"]["executed"], false);
    assert_eq!(response["result"]["executionMode"], "dry_run");
    assert_eq!(
        response["result"]["message"],
        "Would shut down this computer"
    );
}

#[test]
fn real_shutdown_returns_a_structured_error_frame() {
    let (response, _) = exchange(json!({
        "protocolVersion": 2,
        "requestId": "stdio-real-shutdown",
        "type": "schedule_action",
        "actionId": "act-shutdown",
        "action": "shutdown",
        "executionMode": "real",
        "countdownSeconds": 30,
        "context": { "downloadId": 7, "filename": "notes.txt" }
    }));
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "real_action_not_enabled");
    assert!(response.get("result").is_none());
}

#[test]
fn closing_stdin_during_a_real_sleep_countdown_exits_without_executing() {
    let (frames, _) = exchange_all(
        json!({
            "protocolVersion": 2,
            "requestId": "stdio-cancel-by-disconnect",
            "type": "schedule_action",
            "actionId": "act-sleep",
            "action": "sleep",
            "executionMode": "real",
            "countdownSeconds": 30,
            "context": { "downloadId": 7, "filename": "notes.txt" }
        }),
        Duration::from_secs(3),
    );
    assert_eq!(
        frames.len(),
        1,
        "disconnect must not emit an execution frame"
    );
    assert_eq!(frames[0]["result"]["status"], "scheduled");
    assert!(frames
        .iter()
        .all(|frame| frame["result"]["status"] != "executed"));
    assert!(frames
        .iter()
        .all(|frame| frame["result"]["status"] != "executing"));
}
