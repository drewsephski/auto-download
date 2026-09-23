import { describe, expect, test } from "vitest";
import { confirmationCopy, notificationMessage, pendingCopy } from "./action-copy";
import { modePresentation, prepareRealAction } from "./arming";
import { createDefaultSettings, withRuleAction, withRuleEnabled, type PowerAction, type Settings } from "./settings";

const ready = {
  permissionGranted: true,
  notificationsGranted: true,
  realActions: ["sleep", "shutdown", "reboot"] as const,
  confirmed: true,
};

describe("real action arming", () => {
  test("requires a separate confirmation for each action", () => {
    for (const action of ["sleep", "shutdown", "reboot"] as const) {
      const settings = enabled(action);
      const decision = prepareRealAction(settings, settings.rules[0]!, { ...ready, confirmed: false });
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.reason).toBe("confirmation_required");
      }
      expect(confirmationCopy(action).confirm).toMatch(/^Enable real /);
      expect(settings.rules[0]?.executionMode).toBe("dry_run");
    }
  });

  test("stores real mode only after confirmation and prerequisites", () => {
    for (const action of ["sleep", "shutdown", "reboot"] as const) {
      const settings = enabled(action);
      const decision = prepareRealAction(settings, settings.rules[0]!, ready);
      expect(decision.ok).toBe(true);
      if (decision.ok) {
        expect(decision.settings.rules[0]).toMatchObject({ action, executionMode: "real" });
        expect(modePresentation(decision.settings.rules[0]!).label).toBe(expectedBanner(action));
      }
    }
  });

  test("refuses real mode without macOS permission", () => {
    const settings = enabled("shutdown");
    const decision = prepareRealAction(settings, settings.rules[0]!, { ...ready, permissionGranted: false });
    expect(decision).toMatchObject({ ok: false, reason: "permission_required" });
  });

  test("refuses real mode when notifications are unavailable", () => {
    const settings = enabled("reboot");
    const decision = prepareRealAction(settings, settings.rules[0]!, { ...ready, notificationsGranted: false });
    expect(decision).toMatchObject({ ok: false, reason: "notifications_required" });
  });

  test("refuses a real action the helper did not advertise", () => {
    const settings = enabled("reboot");
    const decision = prepareRealAction(settings, settings.rules[0]!, { ...ready, realActions: ["sleep"] });
    expect(decision).toMatchObject({ ok: false, reason: "action_not_enabled" });
    expect(settings.rules[0]?.executionMode).toBe("dry_run");
  });

  test("uses a dry-run banner until an action is armed", () => {
    expect(modePresentation(enabled("sleep").rules[0]!).label).toBe("DRY RUN");
  });
});

describe("action presentation", () => {
  test("describes pending state and notifications for every action", () => {
    expect(pendingCopy("sleep")).toEqual({
      title: "Sleep pending",
      countdown: "Sleeping in ~30 seconds",
      cancel: "Cancel sleep",
    });
    expect(pendingCopy("shutdown")).toEqual({
      title: "Shut down pending",
      countdown: "Shutting down in ~30 seconds",
      cancel: "Cancel shut down",
    });
    expect(pendingCopy("reboot")).toEqual({
      title: "Restart pending",
      countdown: "Restarting in ~30 seconds",
      cancel: "Cancel restart",
    });
    expect(notificationMessage("sleep")).toBe("This Mac will sleep in 30 seconds.");
    expect(notificationMessage("shutdown")).toContain("Save any open work now.");
    expect(notificationMessage("reboot")).toContain("Save any open work now.");
  });
});

function enabled(action: PowerAction): Settings {
  return withRuleAction(withRuleEnabled(createDefaultSettings(), true), action);
}

function expectedBanner(action: PowerAction): string {
  switch (action) {
    case "sleep":
      return "LIVE — SLEEP ENABLED";
    case "shutdown":
      return "LIVE — SHUT DOWN ENABLED";
    case "reboot":
      return "LIVE — RESTART ENABLED";
  }
}
