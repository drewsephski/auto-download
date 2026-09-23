import { describe, expect, test } from "vitest";
import { modePresentation, prepareRealSleep } from "./arming";
import { createDefaultSettings, withRuleAction, withRuleEnabled, type Settings } from "./settings";

const ready = {
  permissionGranted: true,
  notificationsGranted: true,
  realSleepSupported: true,
  confirmed: true,
};

describe("real sleep arming", () => {
  test("requires confirmation before real mode is stored", () => {
    const decision = prepareRealSleep(enabledSleep(), enabledSleep().rules[0]!, { ...ready, confirmed: false });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("confirmation_required");
    }
  });

  test("stores real sleep only after confirmation and prerequisites", () => {
    const settings = enabledSleep();
    const decision = prepareRealSleep(settings, settings.rules[0]!, ready);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.settings.rules[0]?.executionMode).toBe("real");
      expect(decision.settings.rules[0]?.action).toBe("sleep");
    }
  });

  test("refuses real mode without macOS permission", () => {
    const settings = enabledSleep();
    const decision = prepareRealSleep(settings, settings.rules[0]!, { ...ready, permissionGranted: false });
    expect(decision).toMatchObject({ ok: false, reason: "permission_required" });
  });

  test("refuses real mode when notifications are unavailable", () => {
    const settings = enabledSleep();
    const decision = prepareRealSleep(settings, settings.rules[0]!, { ...ready, notificationsGranted: false });
    expect(decision).toMatchObject({ ok: false, reason: "notifications_required" });
  });

  test("refuses real mode for shut down and restart", () => {
    const settings = withRuleAction(enabledSleep(), "shutdown");
    const decision = prepareRealSleep(settings, settings.rules[0]!, ready);
    expect(decision).toMatchObject({ ok: false, reason: "action_not_enabled" });
    expect(settings.rules[0]?.executionMode).toBe("dry_run");
  });

  test("uses a distinct live banner only for armed sleep", () => {
    expect(modePresentation(enabledSleep().rules[0]!).label).toBe("DRY RUN");
    const armed = prepareRealSleep(enabledSleep(), enabledSleep().rules[0]!, ready);
    if (!armed.ok) {
      throw new Error("expected real sleep to arm");
    }
    expect(modePresentation(armed.settings.rules[0]!).label).toBe("LIVE — SLEEP ENABLED");
  });
});

function enabledSleep(): Settings {
  return withRuleEnabled(createDefaultSettings(), true);
}
