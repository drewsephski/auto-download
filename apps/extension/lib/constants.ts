/** Native messaging host name. Keep this identical to `HOST_NAME` in the Rust host. */
export const NATIVE_HOST_NAME = "dev.downloadautomations.host";

export const PROTOCOL_VERSION = 2;

export const HISTORY_LIMIT = 20;

/** Recent download ids already handled. Larger than visible history so a replayed completion does not run twice. */
export const HANDLED_DOWNLOAD_LIMIT = 200;

export const DEFAULT_RULE_ID = "after-download";

/** Fixed countdown for this slice. The host rejects anything below 10 seconds. */
export const COUNTDOWN_SECONDS = 30;

export const EXTENSION_PERMISSIONS = ["storage", "downloads", "nativeMessaging", "notifications"] as const;

export const CANCEL_PENDING_MESSAGE = "cancel-pending-sleep";

export const NOTIFICATION_TITLE = "Download finished";

export const NOTIFICATION_MESSAGE = "This Mac will sleep in 30 seconds.";

export const DRY_RUN_MESSAGES = {
  sleep: "Would put this computer to sleep",
  shutdown: "Would shut down this computer",
  reboot: "Would restart this computer",
} as const;
