import { describe, expect, test } from "vitest";
import { processCompletedDownload, type AutomationDeps } from "./automation";
import type { DownloadCompletedEvent, DownloadItemSnapshot } from "./download-event";
import type { NativeRequest } from "./protocol";
import type { ExecutionRecord } from "./records";
import { createDefaultSettings, withRuleEnabled, type Settings } from "./settings";

describe("completed download automation", () => {
  test("runs one dry-run for an enabled download and ignores a duplicate event", async () => {
    const harness = createHarness({ settings: withRuleEnabled(createDefaultSettings(), true) });
    await processCompletedDownload(harness.deps, 3);
    await processCompletedDownload(harness.deps, 3);
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toMatchObject({ type: "execute_action", action: "sleep", dryRun: true });
    expect(harness.downloads).toHaveLength(1);
    expect(harness.executions).toEqual([
      expect.objectContaining({
        ok: true,
        executed: false,
        dryRun: true,
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
    await Promise.all([
      processCompletedDownload(harness.deps, 8),
      processCompletedDownload(harness.deps, 8),
    ]);
    expect(harness.sent).toHaveLength(1);
  });
});

function createHarness(options: { settings: Settings; state?: string; sendError?: Error }) {
  const sent: NativeRequest[] = [];
  const downloads: DownloadCompletedEvent[] = [];
  const executions: ExecutionRecord[] = [];
  let handled: number[] = [];
  let settings = options.settings;
  const tails = new Map<string, Promise<void>>();

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
    async send(request) {
      if (options.sendError) {
        throw options.sendError;
      }
      sent.push(request);
      if (request.type !== "execute_action") {
        throw new Error("unexpected request");
      }
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        result: {
          executed: false,
          dryRun: true,
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
    now: () => 1_700_000_000_000,
    newRequestId: () => "req-test",
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
    downloads,
    executions,
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
