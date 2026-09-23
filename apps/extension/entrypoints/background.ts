import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { NOTIFICATION_TITLE, notificationMessage } from "../lib/action-copy";
import { processCompletedDownload, type AutomationDeps } from "../lib/automation";
import { CANCEL_PENDING_MESSAGE } from "../lib/constants";
import { downloadChangeOutcome, type DownloadItemSnapshot } from "../lib/download-event";
import { describeCancelledPending, describeInterruptedPending, describeLifecycle } from "../lib/lifecycle";
import { LiveHostSession } from "../lib/live-host-session";
import { connectNativeHost, sendNativeRequest } from "../lib/native-client";
import { actionIdFromNotification, notificationIdForAction } from "../lib/notifications";
import { notificationsGranted } from "../lib/notification-permission";
import { normalizePermission } from "../lib/permission";
import {
  applyTerminalStatus,
  interruptStalePending,
  isActivePending,
  normalizePending,
} from "../lib/pending";
import { cancelActionRequest, capabilitiesRequest, isCancelAck, isScheduleAck, parseHostResponse } from "../lib/protocol";
import { normalizeDownloadHistory, normalizeExecutionHistory, upsertExecution } from "../lib/records";
import { normalizeSettings, type PowerAction } from "../lib/settings";
import {
  downloadHistoryItem,
  executionHistoryItem,
  handledDownloadsItem,
  pendingActionItem,
  permissionItem,
  settingsItem,
} from "../lib/storage-items";

let suppressDisconnect = false;

const session = new LiveHostSession({
  connect: connectNativeHost,
  onDisconnect: () => {
    if (suppressDisconnect) {
      return;
    }
    void markConnectionLost();
  },
  onEvent: (payload) => {
    void applyHostEvent(payload);
  },
});

export default defineBackground(() => {
  const notifications = browser.notifications;
  if (notifications?.onButtonClicked) {
    notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      if (buttonIndex !== 0) {
        return;
      }
      const actionId = actionIdFromNotification(notificationId);
      if (!actionId) {
        return;
      }
      void cancelPendingAction(actionId);
    });
  }

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isCancelMessage(message)) {
      return undefined;
    }
    void cancelPendingAction(message.actionId).then(
      () => {
        sendResponse({ ok: true });
      },
      () => {
        sendResponse({ ok: false });
      },
    );
    return true;
  });

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

  void interruptStalePendingOnStartup();
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
    async getPending() {
      return normalizePending(await pendingActionItem.getValue());
    },
    async setPending(pending) {
      await pendingActionItem.setValue(pending);
    },
    async permissionGranted() {
      const permission = normalizePermission(await permissionItem.getValue());
      return permission.state === "granted";
    },
    notificationsGranted,
    async realActions() {
      return readRealActions();
    },
    hasLiveSession() {
      return session.connected();
    },
    send(request) {
      return sendNativeRequest(request);
    },
    schedule(request) {
      return session.post(request, (payload) => isScheduleAck(request.requestId, payload));
    },
    cancel(request) {
      return session.post(request, (payload) => isCancelAck(request.requestId, payload));
    },
    async showNotification(action, actionId) {
      return showPowerNotification(action, actionId);
    },
    async clearNotification(actionId) {
      await clearPowerNotification(actionId);
    },
    now() {
      return Date.now();
    },
    newRequestId() {
      return crypto.randomUUID();
    },
    newActionId() {
      return crypto.randomUUID();
    },
    async lock<T>(name: string, task: () => Promise<T>): Promise<T> {
      const locks = globalThis.navigator?.locks;
      if (!locks) {
        return task();
      }
      let value!: T;
      await locks.request(name, async () => {
        value = await task();
      });
      return value;
    },
  };
}

async function interruptStalePendingOnStartup(): Promise<void> {
  const pending = normalizePending(await pendingActionItem.getValue());
  const next = interruptStalePending(pending, false);
  if (!next.changed || !next.pending) {
    return;
  }
  await pendingActionItem.setValue(next.pending);
  await rememberExecution(describeInterruptedPending(next.pending));
  await clearPowerNotification(next.pending.actionId);
}

async function markConnectionLost(): Promise<void> {
  const pending = normalizePending(await pendingActionItem.getValue());
  const next = interruptStalePending(pending, false);
  if (!next.changed || !next.pending) {
    return;
  }
  await pendingActionItem.setValue(next.pending);
  await rememberExecution(describeInterruptedPending(next.pending));
  await clearPowerNotification(next.pending.actionId);
}

async function readRealActions(): Promise<PowerAction[]> {
  const requestId = crypto.randomUUID();
  try {
    const payload = await sendNativeRequest(capabilitiesRequest(requestId));
    const parsed = parseHostResponse(requestId, "get_capabilities", payload);
    if (!parsed.ok || parsed.type !== "get_capabilities") {
      return [];
    }
    return parsed.realActions;
  } catch {
    return [];
  }
}

async function applyHostEvent(payload: unknown): Promise<void> {
  const pending = normalizePending(await pendingActionItem.getValue());
  if (!pending || !isActivePending(pending)) {
    return;
  }
  const parsed = parseHostResponse(pending.requestId, "action_event", payload);
  if (!parsed.ok || parsed.type !== "action_event" || parsed.actionId !== pending.actionId) {
    return;
  }
  const update = describeLifecycle(pending, parsed.status, parsed.message);
  await pendingActionItem.setValue(update.pending);
  await rememberExecution(update.record);
  if (parsed.status === "executing") {
    return;
  }
  await clearPowerNotification(pending.actionId);
  suppressDisconnect = true;
  session.close();
  suppressDisconnect = false;
}

async function cancelPendingAction(actionId?: string): Promise<void> {
  const pending = normalizePending(await pendingActionItem.getValue());
  if (!pending || !isActivePending(pending)) {
    return;
  }
  if (actionId && pending.actionId !== actionId) {
    return;
  }

  suppressDisconnect = true;
  try {
    if (session.connected()) {
      const request = cancelActionRequest({
        requestId: crypto.randomUUID(),
        actionId: pending.actionId,
      });
      try {
        await session.post(request, (payload) => isCancelAck(request.requestId, payload));
      } catch {
        // A lost connection already discarded the host-side action.
      }
    }
    const cancelled = applyTerminalStatus(pending, "cancelled");
    await pendingActionItem.setValue(cancelled);
    await rememberExecution(describeCancelledPending(cancelled));
    await clearPowerNotification(pending.actionId);
    session.close();
  } finally {
    suppressDisconnect = false;
  }
}

async function showPowerNotification(action: PowerAction, actionId: string): Promise<boolean> {
  const notifications = browser.notifications;
  if (!notifications || !(await notificationsGranted())) {
    return false;
  }
  try {
    await notifications.create(notificationIdForAction(actionId), {
      type: "basic",
      iconUrl: browser.runtime.getURL("/icon-128.png"),
      title: NOTIFICATION_TITLE,
      message: notificationMessage(action),
      requireInteraction: true,
      buttons: [{ title: "Cancel" }],
    });
    return true;
  } catch {
    return false;
  }
}

async function clearPowerNotification(actionId: string): Promise<void> {
  const notifications = browser.notifications;
  if (!notifications) {
    return;
  }
  try {
    await notifications.clear(notificationIdForAction(actionId));
  } catch {
    // Clearing a missing notification is not a reason to retry the action.
  }
}

async function rememberExecution(record: ReturnType<typeof describeCancelledPending>): Promise<void> {
  const history = normalizeExecutionHistory(await executionHistoryItem.getValue());
  await executionHistoryItem.setValue(upsertExecution(history, record));
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

function isCancelMessage(message: unknown): message is { type: typeof CANCEL_PENDING_MESSAGE; actionId?: string } {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return false;
  }
  if (message.type !== CANCEL_PENDING_MESSAGE) {
    return false;
  }
  if (!("actionId" in message) || message.actionId === undefined) {
    return true;
  }
  return typeof message.actionId === "string";
}
