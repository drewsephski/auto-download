//! User-scoped native host registration.
//!
//! Platform paths come from the `native_messaging` crate. Adding another browser
//! is a new [`BrowserKind`] variant; the manifest directory layout stays in the crate.

use crate::{HOST_DESCRIPTION, HOST_NAME};
use native_messaging::{install, manifest_path, remove, verify_installed, Scope};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Browsers this CLI can register. The crate already knows Windows and Linux paths.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserKind {
    Chrome,
}

impl BrowserKind {
    pub fn parse(value: &str) -> Result<Self, InstallError> {
        match value {
            "chrome" => Ok(Self::Chrome),
            other => Err(InstallError::UnsupportedBrowser(other.to_string())),
        }
    }

    pub fn manifest_key(self) -> &'static str {
        match self {
            Self::Chrome => "chrome",
        }
    }
}

#[derive(Debug, Error)]
pub enum InstallError {
    #[error("extension id must be 32 characters, using only a-p")]
    InvalidExtensionId,
    #[error("browser `{0}` is not supported")]
    UnsupportedBrowser(String),
    #[error("native host binary was not found at {}", .path.display())]
    BinaryMissing { path: PathBuf },
    #[error("native host is not installed\nExpected manifest: {}", .manifest_path.display())]
    NotInstalled { manifest_path: PathBuf },
    #[error(
        "the host manifest exists, but the executable is missing\nManifest: {}\nMissing binary: {}",
        .manifest_path.display(),
        .binary_path.display()
    )]
    ExecutableMissing {
        manifest_path: PathBuf,
        binary_path: PathBuf,
    },
    #[error(
        "the host is installed for a different extension\nManifest: {}\nMissing origin: {origin}",
        .manifest_path.display()
    )]
    OriginNotAllowed {
        manifest_path: PathBuf,
        origin: String,
    },
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallReport {
    pub manifest_path: PathBuf,
    pub binary_path: PathBuf,
    pub origin: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyReport {
    NotInstalled { manifest_path: PathBuf },
    ExecutableMissing {
        manifest_path: PathBuf,
        binary_path: PathBuf,
    },
    OriginNotAllowed {
        manifest_path: PathBuf,
        origin: String,
    },
    Installed {
        manifest_path: PathBuf,
        binary_path: PathBuf,
        origins: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UninstallReport {
    pub manifest_path: PathBuf,
    pub removed: bool,
}

pub fn extension_origin(extension_id: &str) -> Result<String, InstallError> {
    validate_extension_id(extension_id)?;
    Ok(format!("chrome-extension://{extension_id}/"))
}

pub fn validate_extension_id(extension_id: &str) -> Result<(), InstallError> {
    if extension_id.len() == 32 && extension_id.bytes().all(|byte| (b'a'..=b'p').contains(&byte)) {
        Ok(())
    } else {
        Err(InstallError::InvalidExtensionId)
    }
}

pub fn resolve_binary(explicit: Option<&Path>) -> Result<PathBuf, InstallError> {
    let path = match explicit {
        Some(path) => path.to_path_buf(),
        None => std::env::current_exe()?,
    };
    let absolute = fs::canonicalize(&path).map_err(|_| InstallError::BinaryMissing {
        path: path.clone(),
    })?;
    if !absolute.is_file() {
        return Err(InstallError::BinaryMissing { path: absolute });
    }
    Ok(absolute)
}

pub fn install_host(
    browser: BrowserKind,
    extension_id: &str,
    binary_path: &Path,
) -> Result<InstallReport, InstallError> {
    let origin = extension_origin(extension_id)?;
    let key = browser.manifest_key();
    install(
        HOST_NAME,
        HOST_DESCRIPTION,
        binary_path,
        &[origin.clone()],
        &[],
        &[key],
        Scope::User,
    )?;
    let manifest = manifest_path(key, Scope::User, HOST_NAME)?;
    Ok(InstallReport {
        manifest_path: manifest,
        binary_path: binary_path.to_path_buf(),
        origin,
    })
}

pub fn verify_host(
    browser: BrowserKind,
    extension_id: Option<&str>,
) -> Result<VerifyReport, InstallError> {
    let key = browser.manifest_key();
    let manifest = manifest_path(key, Scope::User, HOST_NAME)?;
    let installed = verify_installed(HOST_NAME, Some(&[key]), Scope::User)?;
    if !installed {
        return Ok(VerifyReport::NotInstalled {
            manifest_path: manifest,
        });
    }

    let contents = fs::read_to_string(&manifest)?;
    let value: serde_json::Value = serde_json::from_str(&contents).map_err(|error| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("host manifest is not valid JSON: {error}"),
        )
    })?;
    let binary_path = value
        .get("path")
        .and_then(|path| path.as_str())
        .map(PathBuf::from)
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "host manifest is missing the binary path",
            )
        })?;
    if !binary_path.is_file() {
        return Ok(VerifyReport::ExecutableMissing {
            manifest_path: manifest,
            binary_path,
        });
    }

    let origins = value
        .get("allowed_origins")
        .and_then(|origins| origins.as_array())
        .map(|origins| {
            origins
                .iter()
                .filter_map(|origin| origin.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if let Some(extension_id) = extension_id {
        let origin = extension_origin(extension_id)?;
        if !origins.iter().any(|allowed| allowed == &origin) {
            return Ok(VerifyReport::OriginNotAllowed {
                manifest_path: manifest,
                origin,
            });
        }
    }

    Ok(VerifyReport::Installed {
        manifest_path: manifest,
        binary_path,
        origins,
    })
}

pub fn uninstall_host(browser: BrowserKind) -> Result<UninstallReport, InstallError> {
    let key = browser.manifest_key();
    let manifest = manifest_path(key, Scope::User, HOST_NAME)?;
    if !manifest.exists() {
        return Ok(UninstallReport {
            manifest_path: manifest,
            removed: false,
        });
    }
    remove(HOST_NAME, &[key], Scope::User)?;
    Ok(UninstallReport {
        manifest_path: manifest,
        removed: true,
    })
}

#[cfg(test)]
mod tests {
    use super::{extension_origin, validate_extension_id, BrowserKind};

    #[test]
    fn accepts_a_chrome_extension_id() {
        let id = "abcdefghijklmnopabcdefghijklmnop";
        assert!(validate_extension_id(id).is_ok());
        assert_eq!(
            extension_origin(id).unwrap(),
            "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
        );
    }

    #[test]
    fn rejects_ids_outside_the_chrome_alphabet() {
        assert!(validate_extension_id("abcdefabcdefabcdefabcdefabcdefab").is_err());
        assert!(validate_extension_id("short").is_err());
        assert!(validate_extension_id("ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP").is_err());
    }

    #[test]
    fn only_chrome_is_registered_in_this_slice() {
        assert_eq!(BrowserKind::parse("chrome").unwrap(), BrowserKind::Chrome);
        assert!(BrowserKind::parse("firefox").is_err());
        assert_eq!(BrowserKind::Chrome.manifest_key(), "chrome");
    }
}
