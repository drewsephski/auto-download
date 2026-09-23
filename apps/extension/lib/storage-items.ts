import { storage } from "wxt/utils/storage";
import { defaultSettings, type Settings } from "./settings";
import type { DownloadCompletedEvent } from "./download-event";
import type { ExecutionRecord } from "./records";

export const settingsItem = storage.defineItem<Settings>("local:settings", {
  fallback: defaultSettings,
  version: 1,
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
