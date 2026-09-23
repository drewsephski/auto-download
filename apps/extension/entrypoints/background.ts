import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { processCompletedDownload, type AutomationDeps } from "../lib/automation";
import { downloadChangeOutcome, type DownloadItemSnapshot } from "../lib/download-event";
import { sendNativeRequest } from "../lib/native-client";
import { normalizeDownloadHistory, normalizeExecutionHistory } from "../lib/records";
import { normalizeSettings } from "../lib/settings";
import {
  downloadHistoryItem,
  executionHistoryItem,
  handledDownloadsItem,
  settingsItem,
} from "../lib/storage-items";

export default defineBackground(() => {
  const downloads = browser.downloads;
  if (!downloads) {
    return;
  }

  downloads.onCreated.addListener((item) => {
    if (downloadChangeOutcome(item.state) !== "complete") {
      return;
    }
    void settle(item.id);
  });

  downloads.onChanged.addListener((delta) => {
    if (downloadChangeOutcome(delta.state?.current) !== "complete") {
      return;
    }
    void settle(delta.id);
  });
});

function settle(downloadId: number): Promise<void> {
  return processCompletedDownload(createDeps(), downloadId).catch((error: unknown) => {
    console.error("Download Automations could not record a completed download", error);
  });
}

function createDeps(): AutomationDeps {
  return {
    async getDownload(id) {
      const downloads = browser.downloads;
      if (!downloads) {
        return null;
      }
      const items = await downloads.search({ id });
      const item = items[0];
      if (!item) {
        return null;
      }
      return snapshotFromItem(item);
    },
    async getSettings() {
      return normalizeSettings(await settingsItem.getValue());
    },
    async getHandledIds() {
      const ids = await handledDownloadsItem.getValue();
      return ids.filter((id) => Number.isInteger(id));
    },
    async setHandledIds(ids) {
      await handledDownloadsItem.setValue(ids);
    },
    async getDownloadHistory() {
      return normalizeDownloadHistory(await downloadHistoryItem.getValue());
    },
    async setDownloadHistory(records) {
      await downloadHistoryItem.setValue(records);
    },
    async getExecutionHistory() {
      return normalizeExecutionHistory(await executionHistoryItem.getValue());
    },
    async setExecutionHistory(records) {
      await executionHistoryItem.setValue(records);
    },
    send(request) {
      return sendNativeRequest(request);
    },
    now() {
      return Date.now();
    },
    newRequestId() {
      return crypto.randomUUID();
    },
    lock(name, task) {
      const locks = globalThis.navigator?.locks;
      if (!locks) {
        return task();
      }
      return locks.request(name, task);
    },
  };
}

function snapshotFromItem(item: {
  id: number;
  state?: string;
  filename: string;
  fileSize: number;
  mime: string;
  endTime?: string;
}): DownloadItemSnapshot {
  return {
    id: item.id,
    state: item.state ?? "in_progress",
    filename: item.filename,
    fileSize: item.fileSize,
    mime: item.mime,
    endTime: item.endTime,
  };
}
