//! Binary entry point.
//!
//! With no developer subcommand, this process is a Chrome native messaging host.
//! Install, verify, and uninstall are explicit subcommands and never run from a
//! browser-supplied argument.

use clap::{Parser, Subcommand};
use native_host::install::{
    install_host, resolve_binary, uninstall_host, verify_host, BrowserKind, InstallError,
    VerifyReport,
};
use native_host::{host_io, invocation_mode, InvocationMode};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Debug, Parser)]
#[command(
    name = "native-host",
    about = "Install and run the Download Automations native messaging host"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Install the current-user native messaging manifest. Does not require root.
    Install {
        /// Browser key. This slice supports `chrome`.
        #[arg(long)]
        browser: String,
        /// Chrome extension ID allowed to message the host.
        #[arg(long = "extension-id")]
        extension_id: String,
        /// Host binary to register. Defaults to this executable.
        #[arg(long)]
        binary: Option<PathBuf>,
    },
    /// Confirm the manifest, binary, and optional extension allowlist.
    Verify {
        /// Browser key. This slice supports `chrome`.
        #[arg(long)]
        browser: String,
        /// When set, require this extension ID in the manifest allowlist.
        #[arg(long = "extension-id")]
        extension_id: Option<String>,
    },
    /// Remove the current-user native messaging manifest.
    Uninstall {
        /// Browser key. This slice supports `chrome`.
        #[arg(long)]
        browser: String,
    },
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match invocation_mode(&args) {
        InvocationMode::NativeHost => match host_io::run() {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("download-automations-host: {error}");
                ExitCode::from(1)
            }
        },
        InvocationMode::Cli => match run_cli() {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("error: {error}");
                ExitCode::from(1)
            }
        },
    }
}

fn run_cli() -> Result<(), InstallError> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Install {
            browser,
            extension_id,
            binary,
        } => {
            let browser = BrowserKind::parse(&browser)?;
            let binary_path = resolve_binary(binary.as_deref())?;
            let report = install_host(browser, &extension_id, &binary_path)?;
            println!("Installed {}", native_host::HOST_NAME);
            println!("Manifest: {}", report.manifest_path.display());
            println!("Binary: {}", report.binary_path.display());
            println!("Allowed origin: {}", report.origin);
            Ok(())
        }
        Commands::Verify {
            browser,
            extension_id,
        } => {
            let browser = BrowserKind::parse(&browser)?;
            let report = verify_host(browser, extension_id.as_deref())?;
            match report {
                VerifyReport::Installed {
                    manifest_path,
                    binary_path,
                    origins,
                } => {
                    println!("Installed {}", native_host::HOST_NAME);
                    println!("Manifest: {}", manifest_path.display());
                    println!("Binary: {}", binary_path.display());
                    println!("Allowed origins: {}", origins.join(", "));
                    Ok(())
                }
                VerifyReport::NotInstalled { manifest_path } => {
                    Err(InstallError::NotInstalled { manifest_path })
                }
                VerifyReport::ExecutableMissing {
                    manifest_path,
                    binary_path,
                } => Err(InstallError::ExecutableMissing {
                    manifest_path,
                    binary_path,
                }),
                VerifyReport::OriginNotAllowed {
                    manifest_path,
                    origin,
                } => Err(InstallError::OriginNotAllowed {
                    manifest_path,
                    origin,
                }),
            }
        }
        Commands::Uninstall { browser } => {
            let browser = BrowserKind::parse(&browser)?;
            let report = uninstall_host(browser)?;
            if report.removed {
                println!("Removed {}", report.manifest_path.display());
            } else {
                println!(
                    "No manifest was installed at {}",
                    report.manifest_path.display()
                );
            }
            Ok(())
        }
    }
}
