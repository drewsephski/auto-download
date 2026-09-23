import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { checkConnection, type ConnectionStatus } from "../../lib/connection";
import type { DownloadCompletedEvent } from "../../lib/download-event";
import { sendNativeRequest } from "../../lib/native-client";
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
  settingsItem,
} from "../../lib/storage-items";

export type ConnectionView = { phase: "checking" } | { phase: "ready"; status: ConnectionStatus };

export function usePopupModel() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [downloads, setDownloads] = useState<DownloadCompletedEvent[]>([]);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [connection, setConnection] = useState<ConnectionView>({ phase: "checking" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const extensionId = browser.runtime.id;

  const refreshConnection = useCallback(async () => {
    setConnection({ phase: "checking" });
    const status = await checkConnection(
      (request) => sendNativeRequest(request),
      () => crypto.randomUUID(),
    );
    setConnection({ phase: "ready", status });
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

    void (async () => {
      const [storedSettings, storedDownloads, storedExecutions] = await Promise.all([
        settingsItem.getValue(),
        downloadHistoryItem.getValue(),
        executionHistoryItem.getValue(),
      ]);
      setSettings(normalizeSettings(storedSettings));
      setDownloads(normalizeDownloadHistory(storedDownloads));
      setExecutions(normalizeExecutionHistory(storedExecutions));
      await refreshConnection();
    })();

    return () => {
      stopSettings();
      stopDownloads();
      stopExecutions();
    };
  }, [refreshConnection]);

  async function handleEnabledChange(enabled: boolean) {
    await saveSettings((current) => withRuleEnabled(current, enabled));
  }

  async function handleActionChange(action: PowerAction) {
    await saveSettings((current) => withRuleAction(current, action));
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

  return {
    settings,
    rule: defaultRule(settings),
    latestDownload: downloads[0],
    latestExecution: executions[0],
    connection,
    saving,
    notice,
    setupOpen,
    extensionId,
    refreshConnection,
    handleEnabledChange,
    handleActionChange,
    handleToggleSetup,
  };
}
