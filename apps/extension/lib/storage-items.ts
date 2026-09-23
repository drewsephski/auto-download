import { storage } from "wxt/utils/storage";
import type { DownloadCompletedEvent } from "./download-event";
import { defaultPermission, type PermissionRecord } from "./permission";
import type { PendingAction } from "./pending";
import type { ExecutionRecord } from "./records";
import { defaultSettings, normalizeSettings, type Settings } from "./settings";

export const settingsItem = storage.defineItem<Settings>("local:settings", {
  fallback: defaultSettings,
  version: 2,
  migrations: {
    2: (oldValue: unknown): Settings => normalizeSettings(oldValue),
  },
});

export const downloadHistoryItem = storage.defineItem<DownloadCompletedEvent[]>("local:downloadHistory", {
  fallback: [],
  version: 1,
});

export const executionHistoryItem = storage.defineItem<ExecutionRecord[]>("local:executionHistory", {
  fallback: [],
  version: 1,
});

export const handledDownloadsItem = storage.defineItem<number[]>("local:handledDownloadIds", {
  fallback: [],
  version: 1,
});

export const pendingActionItem = storage.defineItem<PendingAction | null>("local:pendingAction", {
  fallback: null,
  version: 1,
});

export const permissionItem = storage.defineItem<PermissionRecord>("local:permission", {
  fallback: defaultPermission,
  version: 1,
});
