import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { keepDryRun, prepareRealSleep, type RealSleepDecision } from "../../lib/arming";
import { CANCEL_PENDING_MESSAGE } from "../../lib/constants";
import { checkConnection, type ConnectionStatus } from "../../lib/connection";
import type { DownloadCompletedEvent } from "../../lib/download-event";
import { sendNativeRequest } from "../../lib/native-client";
import { notificationsGranted } from "../../lib/notification-permission";
import { normalizePermission, type PermissionRecord } from "../../lib/permission";
import { normalizePending, type PendingAction } from "../../lib/pending";
import { parseHostResponse, permissionRequest } from "../../lib/protocol";
import { normalizeDownloadHistory, normalizeExecutionHistory, type ExecutionRecord } from "../../lib/records";
import {
  defaultRule,
  defaultSettings,
  normalizeSettings,
  withRuleAction,
  withRuleEnabled,
  type PowerAction,
  type Settings,
} from "../../lib/settings";
import {
  downloadHistoryItem,
  executionHistoryItem,
  pendingActionItem,
  permissionItem,
  settingsItem,
} from "../../lib/storage-items";

export type ConnectionView = { phase: "checking" } | { phase: "ready"; status: ConnectionStatus };

export function usePopupModel() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [downloads, setDownloads] = useState<DownloadCompletedEvent[]>([]);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [permission, setPermission] = useState<PermissionRecord>({ state: "unchecked" });
  const [notificationsAvailable, setNotificationsAvailable] = useState(false);
  const [connection, setConnection] = useState<ConnectionView>({ phase: "checking" });
  const [saving, setSaving] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [confirmingReal, setConfirmingReal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const extensionId = browser.runtime.id;

  const refreshConnection = useCallback(async () => {
    setConnection({ phase: "checking" });
    const [status, notificationsAllowed] = await Promise.all([
      checkConnection(
        (request) => sendNativeRequest(request),
        () => crypto.randomUUID(),
      ),
      notificationsGranted(),
    ]);
    setConnection({ phase: "ready", status });
    setNotificationsAvailable(notificationsAllowed);
    if (status.state !== "connected") {
      setSetupOpen(true);
    }
  }, []);

  useEffect(() => {
    const stopSettings = settingsItem.watch((value) => {
      setSettings(normalizeSettings(value));
    });
    const stopDownloads = downloadHistoryItem.watch((value) => {
      setDownloads(normalizeDownloadHistory(value));
    });
    const stopExecutions = executionHistoryItem.watch((value) => {
      setExecutions(normalizeExecutionHistory(value));
    });
    const stopPending = pendingActionItem.watch((value) => {
      setPending(normalizePending(value));
    });
    const stopPermission = permissionItem.watch((value) => {
      setPermission(normalizePermission(value));
    });

    void (async () => {
      const [storedSettings, storedDownloads, storedExecutions, storedPending, storedPermission] = await Promise.all([
        settingsItem.getValue(),
        downloadHistoryItem.getValue(),
        executionHistoryItem.getValue(),
        pendingActionItem.getValue(),
        permissionItem.getValue(),
      ]);
      setSettings(normalizeSettings(storedSettings));
      setDownloads(normalizeDownloadHistory(storedDownloads));
      setExecutions(normalizeExecutionHistory(storedExecutions));
      setPending(normalizePending(storedPending));
      setPermission(normalizePermission(storedPermission));
      await refreshConnection();
    })();

    return () => {
      stopSettings();
      stopDownloads();
      stopExecutions();
      stopPending();
      stopPermission();
    };
  }, [refreshConnection]);

  async function handleEnabledChange(enabled: boolean) {
    await saveSettings((current) => withRuleEnabled(current, enabled));
  }

  async function handleActionChange(action: PowerAction) {
    setConfirmingReal(false);
    await saveSettings((current) => withRuleAction(current, action));
  }

  async function handleModeChange(mode: "dry_run" | "real") {
    if (mode === "dry_run") {
      setConfirmingReal(false);
      await saveSettings((current) => keepDryRun(current));
      return;
    }
    if (defaultRule(settings).executionMode === "real" && defaultRule(settings).action === "sleep") {
      return;
    }
    const decision = decideReal(false);
    if (!decision.ok && decision.reason === "confirmation_required") {
      setConfirmingReal(true);
      setNotice(null);
      return;
    }
    setConfirmingReal(false);
    if (!decision.ok) {
      setNotice(decision.message);
    }
  }

  async function handleConfirmRealSleep() {
    const decision = decideReal(true);
    if (!decision.ok) {
      setNotice(decision.message);
      return;
    }
    await saveSettings(() => decision.settings);
    setConfirmingReal(false);
  }

  function handleKeepDryRun() {
    setConfirmingReal(false);
    setNotice(null);
  }

  async function handleRequestPermission() {
    setPermissionBusy(true);
    try {
      const requestId = crypto.randomUUID();
      const payload = await sendNativeRequest(permissionRequest(requestId));
      const parsed = parseHostResponse(requestId, "request_permission", payload);
      if (parsed.ok && parsed.type === "request_permission") {
        await permissionItem.setValue({ state: "granted" });
        setNotice(null);
        return;
      }
      await permissionItem.setValue({ state: parsed.ok ? "error" : parsed.code === "permission_denied" ? "denied" : "error" });
      setNotice(parsed.ok ? "macOS permission could not be confirmed." : parsed.message);
    } catch {
      await permissionItem.setValue({ state: "error" });
      setNotice("macOS permission could not be requested.");
    } finally {
      setPermissionBusy(false);
    }
  }

  async function handleCancelSleep() {
    try {
      await browser.runtime.sendMessage({ type: CANCEL_PENDING_MESSAGE });
      setNotice(null);
    } catch {
      setNotice("Could not cancel the pending sleep. Closing this browser also cancels it.");
    }
  }

  async function saveSettings(update: (current: Settings) => Settings) {
    setSaving(true);
    try {
      const current = normalizeSettings(await settingsItem.getValue());
      await settingsItem.setValue(update(current));
      setNotice(null);
    } catch {
      setNotice("Could not save that change. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleToggleSetup() {
    setSetupOpen((open) => !open);
  }

  function decideReal(confirmed: boolean): RealSleepDecision {
    const current = normalizeSettings(settings);
    const rule = defaultRule(current);
    return prepareRealSleep(current, rule, {
      permissionGranted: permission.state === "granted",
      notificationsGranted: notificationsAvailable,
      realSleepSupported: connection.phase === "ready" && connection.status.realSleepSupported,
      confirmed,
    });
  }

  return {
    settings,
    rule: defaultRule(settings),
    latestDownload: downloads[0],
    latestExecution: executions[0],
    pending,
    permission,
    notificationsAvailable,
    connection,
    saving,
    permissionBusy,
    confirmingReal,
    notice,
    setupOpen,
    extensionId,
    refreshConnection,
    handleEnabledChange,
    handleActionChange,
    handleModeChange,
    handleConfirmRealSleep,
    handleKeepDryRun,
    handleRequestPermission,
    handleCancelSleep,
    handleToggleSetup,
  };
}
