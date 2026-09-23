import { describe, expect, test } from "vitest";
import { planAutomations } from "./decision";
import type { DownloadCompletedEvent } from "./download-event";
import { createDefaultSettings, withRuleEnabled } from "./settings";

const event: DownloadCompletedEvent = {
  downloadId: 4,
  filename: "example.zip",
  fileSize: 10,
  mime: "application/zip",
  completedAt: 1,
};

describe("automation decisions", () => {
  test("does nothing while the default rule is disabled", () => {
    expect(planAutomations(createDefaultSettings(), event, () => "req-1")).toEqual([]);
  });

  test("plans one dry-run action for each enabled rule", () => {
    const settings = withRuleEnabled(createDefaultSettings(), true);
    settings.rules.push({ id: "later", enabled: false, action: "reboot", dryRun: true });
    settings.rules.push({ id: "also", enabled: true, action: "shutdown", dryRun: true });
    let count = 0;
    const plans = planAutomations(settings, event, () => {
      count += 1;
      return `req-${count}`;
    });
    expect(plans.map((plan) => plan.action)).toEqual(["sleep", "shutdown"]);
    expect(plans.every((plan) => plan.request.dryRun === true)).toBe(true);
    expect(plans[0]?.request.context).toEqual({ downloadId: 4, filename: "example.zip" });
  });
});
