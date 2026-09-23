import { describe, expect, test } from "vitest";
import { createDefaultSettings, normalizeSettings, withRuleAction, withRuleEnabled } from "./settings";

describe("settings", () => {
  test("defaults to a disabled dry-run sleep rule", () => {
    expect(createDefaultSettings()).toEqual({
      version: 2,
      rules: [
        {
          id: "after-download",
          enabled: false,
          action: "sleep",
          executionMode: "dry_run",
          countdownSeconds: 30,
        },
      ],
    });
  });

  test("migrates version 1 dry-run settings without enabling real execution", () => {
    expect(
      normalizeSettings({
        version: 1,
        rules: [
          { id: "after-download", enabled: true, action: "shutdown", dryRun: true },
          { id: "later", enabled: true, action: "reboot", dryRun: true },
        ],
      }),
    ).toEqual({
      version: 2,
      rules: [
        {
          id: "after-download",
          enabled: true,
          action: "shutdown",
          executionMode: "dry_run",
          countdownSeconds: 30,
        },
        {
          id: "later",
          enabled: true,
          action: "reboot",
          executionMode: "dry_run",
          countdownSeconds: 30,
        },
      ],
    });
  });

  test("does not migrate a non-dry-run version 1 rule into real mode", () => {
    expect(
      normalizeSettings({
        version: 1,
        rules: [{ id: "after-download", enabled: true, action: "sleep", dryRun: false }],
      }),
    ).toEqual(createDefaultSettings());
  });

  test("drops a version 1 document that tries to smuggle real mode", () => {
    expect(
      normalizeSettings({
        version: 1,
        rules: [{ id: "after-download", enabled: true, action: "sleep", dryRun: true, executionMode: "real" }],
      }),
    ).toEqual(createDefaultSettings());
  });

  test("keeps an explicit real sleep rule and refuses real mode for other actions", () => {
    const settings = normalizeSettings({
      version: 2,
      rules: [
        {
          id: "after-download",
          enabled: true,
          action: "sleep",
          executionMode: "real",
          countdownSeconds: 30,
        },
        {
          id: "later",
          enabled: true,
          action: "shutdown",
          executionMode: "real",
          countdownSeconds: 30,
        },
      ],
    });
    expect(settings.rules[0]?.executionMode).toBe("real");
    expect(settings.rules[1]?.executionMode).toBe("dry_run");
  });

  test("returns to dry run when the default action leaves sleep", () => {
    const settings = normalizeSettings({
      version: 2,
      rules: [
        {
          id: "after-download",
          enabled: true,
          action: "sleep",
          executionMode: "real",
          countdownSeconds: 30,
        },
      ],
    });
    expect(withRuleAction(settings, "reboot").rules[0]).toMatchObject({
      action: "reboot",
      executionMode: "dry_run",
    });
  });

  test("keeps an additional valid rule and edits only the default rule", () => {
    const settings = normalizeSettings({
      version: 2,
      rules: [
        {
          id: "after-download",
          enabled: false,
          action: "sleep",
          executionMode: "dry_run",
          countdownSeconds: 30,
        },
        {
          id: "later",
          enabled: true,
          action: "reboot",
          executionMode: "dry_run",
          countdownSeconds: 30,
        },
      ],
    });
    const updated = withRuleAction(withRuleEnabled(settings, true), "shutdown");
    expect(updated.rules).toEqual([
      {
        id: "after-download",
        enabled: true,
        action: "shutdown",
        executionMode: "dry_run",
        countdownSeconds: 30,
      },
      {
        id: "later",
        enabled: true,
        action: "reboot",
        executionMode: "dry_run",
        countdownSeconds: 30,
      },
    ]);
  });

  test("restores the default rule when it is missing", () => {
    const settings = normalizeSettings({
      version: 2,
      rules: [
        {
          id: "later",
          enabled: true,
          action: "reboot",
          executionMode: "dry_run",
          countdownSeconds: 30,
        },
      ],
    });
    expect(settings.rules[0]?.id).toBe("after-download");
    expect(settings.rules[0]?.executionMode).toBe("dry_run");
    expect(settings.rules[1]?.id).toBe("later");
  });
});
