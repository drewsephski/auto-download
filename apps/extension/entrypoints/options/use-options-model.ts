import { useCallback, useEffect, useState } from "react";
import {
  conditionsToFormInput,
  formatMatchFailure,
  validateConditionsForm,
  type ConditionsFormInput,
} from "../../lib/conditions-input";
import { matchesDownload } from "../../lib/rule-conditions";
import { formatFileSize } from "../../lib/format";
import type { DownloadCompletedEvent } from "../../lib/download-event";
import { normalizeDownloadHistory } from "../../lib/records";
import {
  defaultRule,
  defaultSettings,
  normalizeSettings,
  withDefaultRuleConditions,
  type Settings,
} from "../../lib/settings";
import { downloadHistoryItem, settingsItem } from "../../lib/storage-items";

export function useOptionsModel() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [form, setForm] = useState<ConditionsFormInput>(conditionsToFormInput(defaultRule(defaultSettings).conditions, false));
  const [latestDownload, setLatestDownload] = useState<DownloadCompletedEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const stopSettings = settingsItem.watch((value) => {
      const normalized = normalizeSettings(value);
      setSettings(normalized);
      const rule = defaultRule(normalized);
      setForm(conditionsToFormInput(rule.conditions, rule.waitForAllDownloads));
    });
    const stopDownloads = downloadHistoryItem.watch((value) => {
      const records = normalizeDownloadHistory(value);
      setLatestDownload(records[0] ?? null);
    });
    void (async () => {
      const [storedSettings, storedDownloads] = await Promise.all([
        settingsItem.getValue(),
        downloadHistoryItem.getValue(),
      ]);
      const normalized = normalizeSettings(storedSettings);
      setSettings(normalized);
      const rule = defaultRule(normalized);
      setForm(conditionsToFormInput(rule.conditions, rule.waitForAllDownloads));
      setLatestDownload(normalizeDownloadHistory(storedDownloads)[0] ?? null);
    })();
    return () => {
      stopSettings();
      stopDownloads();
    };
  }, []);

  const preview = useCallback(() => {
    const validated = validateConditionsForm(form);
    if (Object.keys(validated.errors).length > 0 || !latestDownload) {
      return null;
    }
    const match = matchesDownload(latestDownload, validated.conditions);
    if (match.matched) {
      return { matched: true as const, text: "Matches this rule" };
    }
    return {
      matched: false as const,
      text: `Doesn't match: ${formatMatchFailure(match.reason)}`,
    };
  }, [form, latestDownload]);

  async function handleSave() {
    const validated = validateConditionsForm(form);
    if (Object.keys(validated.errors).length > 0) {
      setErrors(validated.errors as Record<string, string>);
      setSavedMessage(null);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const current = normalizeSettings(await settingsItem.getValue());
      const next = withDefaultRuleConditions(current, {
        conditions: validated.conditions,
        waitForAllDownloads: validated.waitForAllDownloads,
      });
      await settingsItem.setValue(next);
      setSavedMessage("Conditions saved.");
      setTimeout(() => {
        setSavedMessage(null);
      }, 2500);
    } catch {
      setSavedMessage(null);
      setErrors({ form: "Could not save conditions. Try again." });
    } finally {
      setSaving(false);
    }
  }

  function updateField<K extends keyof ConditionsFormInput>(key: K, value: ConditionsFormInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSavedMessage(null);
  }

  return {
    settings,
    form,
    latestDownload,
    saving,
    savedMessage,
    errors,
    preview: preview(),
    updateField,
    handleSave,
    formatFileSize,
  };
}
