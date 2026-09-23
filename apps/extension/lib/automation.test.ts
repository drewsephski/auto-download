import { describe, expect, test } from "vitest";
import { processCompletedDownload, type AutomationDeps } from "./automation";
import type { DownloadCompletedEvent, DownloadItemSnapshot } from "./download-event";
import type { PendingAction } from "./pending";
import type { CancelActionRequest, OneShotRequest, ScheduleActionRequest } from "./protocol";
import type { ExecutionRecord } from "./records";
import { createDefaultSettings, withRuleEnabled, type Settings } from "./settings";

describe("completed download automation", () => {
  test("runs one dry-run for an enabled download and ignores a duplicate event", async () => {
    const harness = createHarness({ settings: withRuleEnabled(createDefaultSettings(), true) });
    await processCompletedDownload(harness.deps, 3);
    await processCompletedDownload(harness.deps, 3);
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toMatchObject({ type: "execute_action", action: "sleep", executionMode: "dry_run" });
    expect(harness.scheduled).toHaveLength(0);
    expect(harness.downloads).toHaveLength(1);
    expect(harness.executions).toEqual([
      expect.objectContaining({
        ok: true,
        executed: false,
        executionMode: "dry_run",
        status: "simulated",
        message: "Would put this computer to sleep",
      }),
    ]);
  });

  test("records the download and skips the host when automation is disabled", async () => {
    const harness = createHarness({ settings: createDefaultSettings() });
    await processCompletedDownload(harness.deps, 3);
    expect(harness.sent).toHaveLength(0);
    expect(harness.downloads).toHaveLength(1);
    expect(harness.executions).toHaveLength(0);
  });

  test("does not automate an interrupted download", async () => {
    const harness = createHarness({
      settings: withRuleEnabled(createDefaultSettings(), true),
      state: "interrupted",
    });
    await processCompletedDownload(harness.deps, 3);
    expect(harness.sent).toHaveLength(0);
    expect(harness.downloads).toHaveLength(0);
    expect(harness.handled).toHaveLength(0);
  });

  test("records one failure when the host is missing and does not retry", async () => {
    const harness = createHarness({
      settings: withRuleEnabled(createDefaultSettings(), true),
      sendError: new Error("Specified native messaging host not found."),
    });
    await processCompletedDownload(harness.deps, 3);
    await processCompletedDownload(harness.deps, 3);
    expect(harness.sent).toHaveLength(0);
    expect(harness.executions).toHaveLength(1);
    expect(harness.executions[0]?.ok).toBe(false);
    expect(harness.executions[0]?.errorCode).toBe("not_installed");
  });

  test("serializes two completion events for the same download", async () => {
    const harness = createHarness({ settings: withRuleEnabled(createDefaultSettings(), true) });
    await Promise.all([processCompletedDownload(harness.deps, 8), processCompletedDownload(harness.deps, 8)]);
    expect(harness.sent).toHaveLength(1);
  });

  test("schedules one real sleep and does not schedule the same download again", async () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    settings.rules[0] = { ...settings.rules[0]!, executionMode: "real" };
    const harness = createHarness({
      settings,
      permissionGranted: true,
      notificationsGranted: true,
    });
    await processCompletedDownload(harness.deps, 3);
    await processCompletedDownload(harness.deps, 3);
    expect(harness.scheduled).toHaveLength(1);
    expect(harness.scheduled[0]).toMatchObject({ action: "sleep", executionMode: "real", countdownSeconds: 30 });
    expect(harness.notifications).toEqual(["act-1"]);
    expect(harness.pending?.status).toBe("scheduled");
    expect(harness.executions[0]).toMatchObject({ status: "scheduled", executed: false });
  });

  test("schedules real shut down and restart when the helper allows them", async () => {
    for (const action of ["shutdown", "reboot"] as const) {
      const settings = withRuleEnabled(createDefaultSettings(), true);
      settings.rules[0] = { ...settings.rules[0]!, action, executionMode: "real" };
      const harness = createHarness({
        settings,
        permissionGranted: true,
        notificationsGranted: true,
      });
      await processCompletedDownload(harness.deps, 3);
      expect(harness.scheduled).toHaveLength(1);
      expect(harness.scheduled[0]).toMatchObject({ action, executionMode: "real" });
      expect(harness.pending?.action).toBe(action);
    }
  });

  test("does not schedule a real action the helper omitted", async () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    settings.rules[0] = { ...settings.rules[0]!, action: "reboot", executionMode: "real" };
    const harness = createHarness({
      settings,
      permissionGranted: true,
      notificationsGranted: true,
      realActions: ["sleep"],
    });
    await processCompletedDownload(harness.deps, 3);
    expect(harness.scheduled).toHaveLength(0);
    expect(harness.executions[0]).toMatchObject({ ok: false, errorCode: "real_action_not_enabled", executed: false });
  });

  test("records a second download without scheduling another sleep", async () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    settings.rules[0] = { ...settings.rules[0]!, executionMode: "real" };
    const harness = createHarness({
      settings,
      permissionGranted: true,
      notificationsGranted: true,
      liveSession: true,
    });
    await processCompletedDownload(harness.deps, 3);
    await processCompletedDownload(harness.deps, 4);
    expect(harness.scheduled).toHaveLength(1);
    expect(harness.downloads).toHaveLength(2);
    settings.rules[0] = { ...settings.rules[0]!, action: "reboot", executionMode: "real" };
    await processCompletedDownload(harness.deps, 5);
    expect(harness.scheduled).toHaveLength(1);
    expect(harness.downloads).toHaveLength(3);
    expect(harness.executions[0]).toMatchObject({ status: "coalesced", action: "sleep" });
    expect(harness.pending?.action).toBe("sleep");
  });

  test("cancels a scheduled sleep when the notification cannot be shown", async () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    settings.rules[0] = { ...settings.rules[0]!, executionMode: "real" };
    const harness = createHarness({
      settings,
      permissionGranted: true,
      notificationsGranted: true,
      notificationShown: false,
    });
    await processCompletedDownload(harness.deps, 3);
    expect(harness.cancelled).toHaveLength(1);
    expect(harness.pending?.status).toBe("cancelled");
    expect(harness.executions[0]).toMatchObject({ status: "cancelled", executed: false });
  });

  test("records a schedule failure once and does not retry it", async () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    settings.rules[0] = { ...settings.rules[0]!, executionMode: "real" };
    const harness = createHarness({
      settings,
      permissionGranted: true,
      notificationsGranted: true,
      scheduleError: new Error("Native host has exited."),
    });
    await processCompletedDownload(harness.deps, 3);
    await processCompletedDownload(harness.deps, 3);
    expect(harness.scheduled).toHaveLength(0);
    expect(harness.executions).toHaveLength(1);
    expect(harness.executions[0]?.status).toBe("failed");
    expect(harness.pending).toBeNull();
  });
});

function createHarness(options: {
  settings: Settings;
  state?: string;
  sendError?: Error;
  scheduleError?: Error;
  permissionGranted?: boolean;
  notificationsGranted?: boolean;
  notificationShown?: boolean;
  liveSession?: boolean;
  realActions?: Array<"sleep" | "shutdown" | "reboot">;
}) {
  const sent: OneShotRequest[] = [];
  const scheduled: ScheduleActionRequest[] = [];
  const cancelled: CancelActionRequest[] = [];
  const notifications: string[] = [];
  const downloads: DownloadCompletedEvent[] = [];
  const executions: ExecutionRecord[] = [];
  let handled: number[] = [];
  let pending: PendingAction | null = null;
  const settings = options.settings;
  const tails = new Map<string, Promise<void>>();
  let requestCount = 0;

  const deps: AutomationDeps = {
    async getDownload(id): Promise<DownloadItemSnapshot | null> {
      await delay(5);
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
    async permissionGranted() {
      return options.permissionGranted ?? false;
    },
    async notificationsGranted() {
      return options.notificationsGranted ?? false;
    },
    async realActions() {
      return options.realActions ?? ["sleep", "shutdown", "reboot"];
    },
    hasLiveSession() {
      return (options.liveSession ?? false) || pending?.status === "scheduled";
    },
    async send(request) {
      if (options.sendError) {
        throw options.sendError;
      }
      sent.push(request);
      if (request.type !== "execute_action") {
        throw new Error("unexpected request");
      }
      return {
        protocolVersion: 2,
        requestId: request.requestId,
        ok: true,
        result: {
          executed: false,
          executionMode: "dry_run",
          action: request.action,
          message:
            request.action === "sleep"
              ? "Would put this computer to sleep"
              : request.action === "shutdown"
                ? "Would shut down this computer"
                : "Would restart this computer",
        },
      };
    },
    async schedule(request) {
      if (options.scheduleError) {
        throw options.scheduleError;
      }
      scheduled.push(request);
      return {
        protocolVersion: 2,
        requestId: request.requestId,
        ok: true,
        result: {
          status: "scheduled",
          actionId: request.actionId,
          action: request.action,
          executionMode: "real",
          countdownSeconds: 30,
        },
      };
    },
    async cancel(request) {
      cancelled.push(request);
      return {
        protocolVersion: 2,
        requestId: request.requestId,
        ok: true,
        result: {
          status: "cancelled",
          actionId: request.actionId,
          action: "sleep",
          executionMode: "real",
          countdownSeconds: 30,
        },
      };
    },
    async showNotification(_action, actionId) {
      notifications.push(actionId);
      return options.notificationShown ?? true;
    },
    async clearNotification() {
      return undefined;
    },
    now: () => 1_700_000_000_000,
    newRequestId: () => {
      requestCount += 1;
      return `req-${requestCount}`;
    },
    newActionId: () => "act-1",
    lock: async (name, task) => {
      const previous = tails.get(name) ?? Promise.resolve();
      let release = () => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(
        name,
        previous.then(() => current),
      );
      await previous;
      try {
        return await task();
      } finally {
        release();
      }
    },
  };

  return {
    deps,
    sent,
    scheduled,
    cancelled,
    notifications,
    downloads,
    executions,
    get pending() {
      return pending;
    },
    get handled() {
      return handled;
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
