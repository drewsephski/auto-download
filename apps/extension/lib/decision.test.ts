import { describe, expect, test } from "vitest";
import { planAutomations, type PlanGates } from "./decision";
import type { DownloadCompletedEvent } from "./download-event";
import { createPendingAction } from "./pending";
import { createDefaultSettings, withRuleAction, withRuleEnabled, type Settings } from "./settings";

const event: DownloadCompletedEvent = {
  downloadId: 4,
  filename: "example.zip",
  extension: "zip",
  mime: "application/zip",
  sizeBytes: 10,
  sourceHost: null,
  completedAt: 1,
};

const closed: PlanGates = {
  permissionGranted: false,
  notificationsGranted: false,
  realActions: [],
  hasLiveSession: false,
  pending: null,
};

const open: PlanGates = {
  permissionGranted: true,
  notificationsGranted: true,
  realActions: ["sleep", "shutdown", "reboot"],
  hasLiveSession: false,
  pending: null,
};

describe("automation decisions", () => {
  test("does nothing while the default rule is disabled", () => {
    expect(planAutomations(createDefaultSettings(), event, () => "req-1", () => "act-1", closed)).toEqual([]);
  });

  test("uses first-match rule ordering for enabled rules", () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    settings.rules.push({
      id: "later",
      revision: 1,
      enabled: false,
      action: "reboot",
      executionMode: "dry_run",
      countdownSeconds: 30,
      conditions: { filenamePattern: null, extensions: [], sourceHosts: [], minSizeBytes: null, maxSizeBytes: null },
      waitForAllDownloads: false,
    });
    settings.rules.push({
      id: "also",
      revision: 1,
      enabled: true,
      action: "shutdown",
      executionMode: "dry_run",
      countdownSeconds: 30,
      conditions: { filenamePattern: null, extensions: [], sourceHosts: [], minSizeBytes: null, maxSizeBytes: null },
      waitForAllDownloads: false,
    });
    const plans = planAutomations(settings, event, () => "req-1", () => "act-1", closed);
    expect(plans.map((plan) => (plan.kind === "dry_run" ? plan.action : plan.kind))).toEqual(["sleep"]);
    if (plans[0]?.kind === "dry_run") {
      expect(plans[0].request.context).toEqual({ downloadId: 4, filename: "example.zip" });
    }
  });

  test("plans each armed real action when the helper allows it", () => {
    for (const action of ["sleep", "shutdown", "reboot"] as const) {
      const plans = planAutomations(armed(action), event, () => "req-1", () => "act-1", open);
      expect(plans).toEqual([
        expect.objectContaining({
          kind: "real_action",
          action,
          request: expect.objectContaining({
            type: "schedule_action",
            action,
            executionMode: "real",
            countdownSeconds: 30,
            actionId: "act-1",
          }),
        }),
      ]);
    }
  });

  test("rejects a real action the helper did not advertise", () => {
    const plans = planAutomations(armed("shutdown"), event, () => "req-1", () => "act-1", {
      ...open,
      realActions: ["sleep"],
    });
    expect(plans).toEqual([
      expect.objectContaining({ kind: "rejected", action: "shutdown", code: "real_action_not_enabled" }),
    ]);
  });

  test("coalesces onto the original pending action without replacing it", () => {
    const plans = planAutomations(armed("reboot"), event, () => "req-2", () => "act-2", {
      ...open,
      hasLiveSession: true,
      pending: createPendingAction({
        actionId: "act-1",
        requestId: "req-1",
        action: "shutdown",
        downloadId: 3,
        filename: "first.zip",
        scheduledAt: 1,
        countdownSeconds: 30,
      }),
    });
    expect(plans).toEqual([expect.objectContaining({ kind: "coalesced", action: "shutdown", actionId: "act-1" })]);
  });

  test("does not schedule a real action when permission or notifications are missing", () => {
    const plans = planAutomations(armed("sleep"), event, () => "req-1", () => "act-1", {
      ...closed,
      realActions: ["sleep", "shutdown", "reboot"],
    });
    expect(plans[0]).toMatchObject({ kind: "rejected", code: "prerequisites_missing" });
  });
});

function armed(action: "sleep" | "shutdown" | "reboot"): Settings {
  const settings = withRuleEnabled(withRuleAction(createDefaultSettings(), action), true);
  settings.rules[0] = { ...settings.rules[0]!, executionMode: "real", revision: settings.rules[0]!.revision + 1 };
  return settings;
}
