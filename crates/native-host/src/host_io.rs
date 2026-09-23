//! One-shot native messaging I/O.
//!
//! Chrome's `runtime.sendNativeMessage` starts a new process per request. Stdout is
//! reserved for a single framed response. Diagnostics go to stderr.

use crate::protocol::handle_request;
use native_messaging::host::NmError;
use native_messaging::{get_message, send_message};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HostIoError {
    #[error("failed to start the host runtime")]
    Runtime(#[source] std::io::Error),
    #[error("failed to read the native messaging request")]
    Read(#[source] NmError),
    #[error("failed to write the native messaging response")]
    Write(#[source] NmError),
}

/// Read one request, validate it, and write one response.
///
/// Process arguments are intentionally unused. Chrome passes the extension origin
/// on the command line, and this host does not interpret that string.
pub fn run() -> Result<(), HostIoError> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(HostIoError::Runtime)?;
    runtime.block_on(run_once())
}

async fn run_once() -> Result<(), HostIoError> {
    let raw = match get_message().await {
        Ok(raw) => raw,
        Err(NmError::Disconnected) => {
            eprintln!("download-automations-host: browser disconnected");
            return Ok(());
        }
        Err(NmError::IncomingTooLarge { .. }) => {
            eprintln!("download-automations-host: rejected an oversized frame");
            let response = handle_request(&"x".repeat(crate::protocol::MAX_REQUEST_BYTES + 1));
            return send_response(&response).await;
        }
        Err(_) => {
            eprintln!("download-automations-host: could not read a request");
            let response = handle_request("");
            return send_response(&response).await;
        }
    };

    let response = handle_request(&raw);
    if response.ok {
        eprintln!("download-automations-host: request accepted");
    } else if let Some(error) = &response.error {
        eprintln!(
            "download-automations-host: request rejected ({})",
            error.code
        );
    }
    send_response(&response).await
}

async fn send_response(response: &crate::protocol::HostResponse) -> Result<(), HostIoError> {
    match send_message(response).await {
        Ok(()) => Ok(()),
        Err(NmError::Disconnected) => {
            eprintln!("download-automations-host: browser disconnected before the response was read");
            Ok(())
        }
        Err(error) => Err(HostIoError::Write(error)),
    }
}
