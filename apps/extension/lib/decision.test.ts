import { describe, expect, test } from "vitest";
import { planAutomations, type PlanGates } from "./decision";
import type { DownloadCompletedEvent } from "./download-event";
import { createPendingAction } from "./pending";
import { createDefaultSettings, withRuleAction, withRuleEnabled, type Settings } from "./settings";

const event: DownloadCompletedEvent = {
  downloadId: 4,
  filename: "example.zip",
  fileSize: 10,
  mime: "application/zip",
  completedAt: 1,
};

const closed: PlanGates = {
  permissionGranted: false,
  notificationsGranted: false,
  hasLiveSession: false,
  pending: null,
};

describe("automation decisions", () => {
  test("does nothing while the default rule is disabled", () => {
    expect(planAutomations(createDefaultSettings(), event, () => "req-1", () => "act-1", closed)).toEqual([]);
  });

  test("plans one dry-run action for each enabled rule", () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    settings.rules.push({
      id: "later",
      enabled: false,
      action: "reboot",
      executionMode: "dry_run",
      countdownSeconds: 30,
    });
    settings.rules.push({
      id: "also",
      enabled: true,
      action: "shutdown",
      executionMode: "dry_run",
      countdownSeconds: 30,
    });
    let count = 0;
    const plans = planAutomations(
      settings,
      event,
      () => {
        count += 1;
        return `req-${count}`;
      },
      () => "act-1",
      closed,
    );
    expect(plans.map((plan) => (plan.kind === "dry_run" ? plan.action : plan.kind))).toEqual(["sleep", "shutdown"]);
    expect(plans.every((plan) => plan.kind === "dry_run" && plan.request.executionMode === "dry_run")).toBe(true);
    if (plans[0]?.kind === "dry_run") {
      expect(plans[0].request.context).toEqual({ downloadId: 4, filename: "example.zip" });
    }
  });

  test("plans real sleep when the rule is armed and prerequisites are met", () => {
    const plans = planAutomations(realSleep(), event, () => "req-1", () => "act-1", {
      ...closed,
      permissionGranted: true,
      notificationsGranted: true,
    });
    expect(plans).toEqual([
      expect.objectContaining({
        kind: "real_sleep",
        request: expect.objectContaining({
          type: "schedule_action",
          action: "sleep",
          executionMode: "real",
          countdownSeconds: 30,
          actionId: "act-1",
        }),
      }),
    ]);
  });

  test("rejects real shut down and restart without contacting a schedule", () => {
    const shutdown = withRuleEnabled(withRuleAction(createDefaultSettings(), "shutdown"), true);
    shutdown.rules[0] = { ...shutdown.rules[0]!, executionMode: "real" };
    const plans = planAutomations(shutdown, event, () => "req-1", () => "act-1", {
      ...closed,
      permissionGranted: true,
      notificationsGranted: true,
    });
    expect(plans).toEqual([
      expect.objectContaining({ kind: "rejected", action: "shutdown", code: "real_action_not_enabled" }),
    ]);
  });

  test("coalesces a second download while sleep is already pending", () => {
    const plans = planAutomations(realSleep(), event, () => "req-2", () => "act-2", {
      permissionGranted: true,
      notificationsGranted: true,
      hasLiveSession: true,
      pending: createPendingAction({
        actionId: "act-1",
        requestId: "req-1",
        downloadId: 3,
        filename: "first.zip",
        scheduledAt: 1,
        countdownSeconds: 30,
      }),
    });
    expect(plans).toEqual([expect.objectContaining({ kind: "coalesced", actionId: "act-1" })]);
  });

  test("does not schedule real sleep when permission or notifications are missing", () => {
    const plans = planAutomations(realSleep(), event, () => "req-1", () => "act-1", closed);
    expect(plans[0]).toMatchObject({ kind: "rejected", code: "prerequisites_missing" });
  });
});

function realSleep(): Settings {
  const settings = withRuleEnabled(createDefaultSettings(), true);
  settings.rules[0] = { ...settings.rules[0]!, executionMode: "real" };
  return settings;
}
