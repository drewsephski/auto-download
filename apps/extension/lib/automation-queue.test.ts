import { describe, expect, test } from "vitest";
import {
  clearDeferredOnBrowserStartup,
  flushDeferredIfIdle,
  handleDownloadStartedDuringCountdown,
  processCompletedDownload,
  type AutomationDeps,
} from "./automation";
import type { DeferredTrigger } from "./deferred-trigger";
import type { DownloadCompletedEvent, DownloadItemSnapshot } from "./download-event";
import { createPendingAction, type PendingAction } from "./pending";
import type { ExecutionRecord } from "./records";
import { createDefaultSettings, withRuleEnabled, type Settings } from "./settings";

describe("download queue automation", () => {
  test("defers when waitForAllDownloads is enabled and another download is active", async () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    settings.rules[0] = {
      ...settings.rules[0]!,
      waitForAllDownloads: true,
    };
    const harness = createHarness({ settings, activeDownloads: true });
    await processCompletedDownload(harness.deps, 3);
    expect(harness.sent).toHaveLength(0);
    expect(harness.deferred).not.toBeNull();
    expect(harness.deferred?.ruleId).toBe("after-download");
  });

  test("flushes a deferred trigger once the queue is idle and revision still matches", async () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    const harness = createHarness({
      settings,
      deferred: {
        version: 1,
        ruleId: "after-download",
        ruleRevision: settings.rules[0]!.revision,
        representativeDownload: sampleEvent(),
        matchedDownloadCount: 1,
        deferredAt: 1,
      },
    });
    await flushDeferredIfIdle(harness.deps);
    expect(harness.sent).toHaveLength(1);
    expect(harness.deferred).toBeNull();
  });

  test("discards stale deferred triggers after a rule revision change", async () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    const harness = createHarness({
      settings,
      deferred: {
        version: 1,
        ruleId: "after-download",
        ruleRevision: settings.rules[0]!.revision - 1,
        representativeDownload: sampleEvent(),
        matchedDownloadCount: 1,
        deferredAt: 1,
      },
    });
    await flushDeferredIfIdle(harness.deps);
    expect(harness.sent).toHaveLength(0);
    expect(harness.deferred).toBeNull();
  });

  test("cancels a scheduled idle-required action when a new download starts and re-defers", async () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    const harness = createHarness({ settings });
    const pending = createPendingAction({
      actionId: "act-1",
      requestId: "req-1",
      action: "shutdown",
      downloadId: 3,
      filename: "a.zip",
      scheduledAt: 1,
      countdownSeconds: 30,
      ruleId: "after-download",
      ruleRevision: settings.rules[0]!.revision,
      requiresIdleDownloads: true,
    });
    harness.setPendingState(pending);
    await handleDownloadStartedDuringCountdown(harness.deps);
    expect(harness.cancelled).toHaveLength(1);
    expect(harness.pending?.status).toBe("cancelled");
    expect(harness.deferred?.ruleId).toBe("after-download");
  });

  test("does not cancel a scheduled action without waitForAllDownloads when a new download starts", async () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    const harness = createHarness({ settings });
    const pending = createPendingAction({
      actionId: "act-1",
      requestId: "req-1",
      action: "shutdown",
      downloadId: 3,
      filename: "a.zip",
      scheduledAt: 1,
      countdownSeconds: 30,
      requiresIdleDownloads: false,
    });
    harness.setPendingState(pending);
    await handleDownloadStartedDuringCountdown(harness.deps);
    expect(harness.cancelled).toHaveLength(0);
    expect(harness.deferred).toBeNull();
  });

  test("clears deferred triggers on browser startup without executing", async () => {
    const harness = createHarness({ settings: createDefaultSettings() });
    harness.setDeferredState({
      version: 1,
      ruleId: "after-download",
      ruleRevision: 1,
      representativeDownload: sampleEvent(),
      matchedDownloadCount: 1,
      deferredAt: 1,
    });
    await clearDeferredOnBrowserStartup(harness.deps);
    expect(harness.deferred).toBeNull();
    expect(harness.sent).toHaveLength(0);
  });
});

function sampleEvent(): DownloadCompletedEvent {
  return {
    downloadId: 3,
    filename: "example.zip",
    extension: "zip",
    mime: "application/zip",
    sizeBytes: 10,
    sourceHost: null,
    completedAt: 1,
  };
}

function createHarness(options: {
  settings: Settings;
  state?: string;
  activeDownloads?: boolean;
  deferred?: DeferredTrigger | null;
}) {
  const sent: unknown[] = [];
  const cancelled: unknown[] = [];
  const downloads: DownloadCompletedEvent[] = [];
  const executions: ExecutionRecord[] = [];
  let handled: number[] = [];
  let pending: PendingAction | null = null;
  let deferred = options.deferred ?? null;
  const activeDownloads = options.activeDownloads ?? false;
  const settings = options.settings;

  const deps: AutomationDeps = {
    async getDownload(id): Promise<DownloadItemSnapshot | null> {
      return {
        id,
        state: options.state ?? "complete",
        filename: "/Users/example/Downloads/example.zip",
        fileSize: 128,
        mime: "application/zip",
        endTime: "2026-09-23T15:00:00.000Z",
      };
    },
    async getSettings() {
      return settings;
    },
    async getHandledIds() {
      return handled;
    },
    async setHandledIds(ids) {
      handled = ids;
    },
    async getDownloadHistory() {
      return downloads;
    },
    async setDownloadHistory(records) {
      downloads.splice(0, downloads.length, ...records);
    },
    async getExecutionHistory() {
      return executions;
    },
    async setExecutionHistory(records) {
      executions.splice(0, executions.length, ...records);
    },
    async getPending() {
      return pending;
    },
    async setPending(next) {
      pending = next;
    },
    async getDeferred() {
      return deferred;
    },
    async setDeferred(next) {
      deferred = next;
    },
    async hasActiveDownloads() {
      return activeDownloads;
    },
    async permissionGranted() {
      return false;
    },
    async notificationsGranted() {
      return false;
    },
    async realActions() {
      return ["sleep", "shutdown", "reboot"];
    },
    hasLiveSession() {
      return false;
    },
    async send(request) {
      sent.push(request);
      return {
        protocolVersion: 2,
        requestId: request.requestId,
        ok: true,
        result: {
          executed: false,
          executionMode: "dry_run",
          action: "sleep",
          message: "Would put this computer to sleep",
        },
      };
    },
    async schedule(request) {
      sent.push(request);
      return {};
    },
    async cancel(request) {
      cancelled.push(request);
      return {};
    },
    async showNotification() {
      return true;
    },
    async clearNotification() {},
    now: () => 1,
    newRequestId: () => "req-1",
    newActionId: () => "act-1",
    lock: async (_name, task) => await task(),
  };

  return {
    deps,
    sent,
    cancelled,
    executions,
    get deferred() {
      return deferred;
    },
    get pending() {
      return pending;
    },
    setPendingState(next: PendingAction) {
      pending = next;
    },
    setDeferredState(next: DeferredTrigger) {
      deferred = next;
    },
  };
}
