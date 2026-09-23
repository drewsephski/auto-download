import { describe, expect, test } from "vitest";
import {
  createDefaultSettings,
  normalizeSettings,
  withRuleAction,
  withRuleEnabled,
} from "./settings";

describe("settings", () => {
  test("defaults to a disabled dry-run sleep rule", () => {
    expect(createDefaultSettings()).toEqual({
      version: 1,
      rules: [
        {
          id: "after-download",
          enabled: false,
          action: "sleep",
          dryRun: true,
        },
      ],
    });
  });

  test("rejects a stored rule that is not a dry run", () => {
    expect(
      normalizeSettings({
        version: 1,
        rules: [{ id: "after-download", enabled: true, action: "shutdown", dryRun: false }],
      }),
    ).toEqual(createDefaultSettings());
  });

  test("keeps an additional valid rule and edits only the default rule", () => {
    const settings = normalizeSettings({
      version: 1,
      rules: [
        { id: "after-download", enabled: false, action: "sleep", dryRun: true },
        { id: "later", enabled: true, action: "reboot", dryRun: true },
      ],
    });
    const updated = withRuleAction(withRuleEnabled(settings, true), "shutdown");
    expect(updated.rules).toEqual([
      { id: "after-download", enabled: true, action: "shutdown", dryRun: true },
      { id: "later", enabled: true, action: "reboot", dryRun: true },
    ]);
  });

  test("restores the default rule when it is missing", () => {
    const settings = normalizeSettings({
      version: 1,
      rules: [{ id: "later", enabled: true, action: "reboot", dryRun: true }],
    });
    expect(settings.rules[0]?.id).toBe("after-download");
    expect(settings.rules[1]?.id).toBe("later");
  });
});
