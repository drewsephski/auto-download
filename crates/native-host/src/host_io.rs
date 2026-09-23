//! Native messaging session.
//!
//! Chrome may send one message (`runtime.sendNativeMessage`) or several
//! (`runtime.connectNative`). Stdout is reserved for framed responses. The process
//! exits when browser input ends, and any pending sleep is discarded with it.

use crate::os_adapter::{SystemPermissionRequester, SystemPowerController};
use crate::protocol::{failure, HostResponse, MAX_REQUEST_BYTES};
use crate::session::HostSession;
use native_messaging::host::{encode_message, spawn_reader, NmError, MAX_FROM_BROWSER};
use std::io::{self, Write};
use thiserror::Error;
use tokio::time::Instant;

#[derive(Debug, Error)]
pub enum HostIoError {
    #[error("failed to start the host runtime")]
    Runtime(#[source] io::Error),
    #[error("failed to encode the native messaging response")]
    Encode(#[source] NmError),
    #[error("failed to write the native messaging response")]
    Write(#[source] io::Error),
}

/// Read requests until the browser disconnects.
///
/// Process arguments are intentionally unused. Chrome passes the extension origin
/// on the command line, and this host does not interpret that string.
pub fn run() -> Result<(), HostIoError> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(HostIoError::Runtime)?;
    runtime.block_on(run_session())
}

async fn run_session() -> Result<(), HostIoError> {
    let mut incoming = spawn_reader(MAX_FROM_BROWSER);
    let mut session = HostSession::new(SystemPowerController, SystemPermissionRequester);

    loop {
        let deadline = session.deadline();
        tokio::select! {
            biased;
            message = incoming.recv() => {
                match message {
                    None | Some(Err(NmError::Disconnected)) => {
                        session.on_disconnect();
                        eprintln!("download-automations-host: browser disconnected");
                        break;
                    }
                    Some(Err(NmError::IncomingTooLarge { .. })) => {
                        session.on_disconnect();
                        eprintln!("download-automations-host: rejected an oversized frame");
                        let response = failure("", "payload_too_large", "The request is too large.");
                        let _ = write_response(&response).await;
                        break;
                    }
                    Some(Err(_)) => {
                        session.on_disconnect();
                        eprintln!("download-automations-host: could not read a request");
                        let response = failure("", "malformed_request", "The request was not valid JSON.");
                        let _ = write_response(&response).await;
                        break;
                    }
                    Some(Ok(raw)) => {
                        if raw.len() > MAX_REQUEST_BYTES {
                            let response = failure("", "payload_too_large", "The request is too large.");
                            if write_response(&response).await.is_err() {
                                session.on_disconnect();
                                break;
                            }
                            continue;
                        }
                        let response = session.handle_message(&raw);
                        log_response(&response);
                        if write_response(&response).await.is_err() {
                            session.on_disconnect();
                            eprintln!("download-automations-host: browser disconnected before the response was read");
                            break;
                        }
                    }
                }
            }
            _ = wait_until(deadline), if deadline.is_some() => {
                let Some(prepared) = session.begin_execution() else {
                    if !session.is_connected() {
                        break;
                    }
                    continue;
                };
                let notice = HostSession::<SystemPowerController, SystemPermissionRequester>::executing_notice(&prepared);
                if write_response(&notice).await.is_err() {
                    session.abort_execution(prepared);
                    session.on_disconnect();
                    eprintln!("download-automations-host: connection lost before sleep");
                    break;
                }
                let finished = session.commit_execution(prepared);
                log_response(&finished);
                if write_response(&finished).await.is_err() {
                    session.on_disconnect();
                    break;
                }
            }
        }
    }

    Ok(())
}

async fn wait_until(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending::<()>().await,
    }
}

async fn write_response(response: &HostResponse) -> Result<(), HostIoError> {
    let frame = encode_message(response).map_err(HostIoError::Encode)?;
    let write = tokio::task::spawn_blocking(move || {
        let mut stdout = io::stdout();
        stdout.write_all(&frame)?;
        stdout.flush()?;
        Ok::<(), io::Error>(())
    });
    match write.await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(HostIoError::Write(error)),
        Err(_) => Err(HostIoError::Write(io::Error::other(
            "the response writer stopped",
        ))),
    }
}

fn log_response(response: &HostResponse) {
    if response.ok {
        eprintln!("download-automations-host: request accepted");
        return;
    }
    if let Some(error) = &response.error {
        eprintln!(
            "download-automations-host: request rejected ({})",
            error.code
        );
    }
}
