import { describe, expect, test } from "vitest";
import {
  createDefaultSettings,
  createEmptyConditions,
  normalizeSettings,
  withDefaultRuleConditions,
  withRuleAction,
} from "./settings";

describe("settings", () => {
  test("defaults to a disabled dry-run sleep rule with empty conditions", () => {
    expect(createDefaultSettings()).toEqual({
      version: 3,
      rules: [
        {
          id: "after-download",
          revision: 1,
          enabled: false,
          action: "sleep",
          executionMode: "dry_run",
          countdownSeconds: 30,
          conditions: createEmptyConditions(),
          waitForAllDownloads: false,
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
      version: 3,
      rules: [
        {
          id: "after-download",
          revision: 1,
          enabled: true,
          action: "shutdown",
          executionMode: "dry_run",
          countdownSeconds: 30,
          conditions: createEmptyConditions(),
          waitForAllDownloads: false,
        },
        {
          id: "later",
          revision: 1,
          enabled: true,
          action: "reboot",
          executionMode: "dry_run",
          countdownSeconds: 30,
          conditions: createEmptyConditions(),
          waitForAllDownloads: false,
        },
      ],
    });
  });

  test("migrates version 2 settings and preserves real execution mode", () => {
    expect(
      normalizeSettings({
        version: 2,
        rules: [
          {
            id: "after-download",
            enabled: true,
            action: "shutdown",
            executionMode: "real",
            countdownSeconds: 30,
          },
        ],
      }).rules[0],
    ).toMatchObject({
      action: "shutdown",
      executionMode: "real",
      revision: 1,
      waitForAllDownloads: false,
      conditions: createEmptyConditions(),
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
      version: 3,
      rules: [
        {
          id: "after-download",
          revision: 1,
          enabled: true,
          action: "sleep",
          executionMode: "real",
          countdownSeconds: 30,
          conditions: createEmptyConditions(),
          waitForAllDownloads: false,
        },
        {
          id: "later",
          revision: 1,
          enabled: true,
          action: "shutdown",
          executionMode: "real",
          countdownSeconds: 30,
          conditions: createEmptyConditions(),
          waitForAllDownloads: false,
        },
      ],
    });
    expect(settings.rules[0]?.executionMode).toBe("real");
    expect(settings.rules[1]?.executionMode).toBe("dry_run");
  });

  test("returns to dry run when the selected action changes", () => {
    const settings = normalizeSettings({
      version: 3,
      rules: [
        {
          id: "after-download",
          revision: 2,
          enabled: true,
          action: "sleep",
          executionMode: "real",
          countdownSeconds: 30,
          conditions: createEmptyConditions(),
          waitForAllDownloads: false,
        },
      ],
    });
    expect(withRuleAction(settings, "reboot").rules[0]).toMatchObject({
      action: "reboot",
      executionMode: "dry_run",
      revision: 3,
    });
    expect(withRuleAction(settings, "sleep").rules[0]).toMatchObject({
      action: "sleep",
      executionMode: "real",
      revision: 2,
    });
  });

  test("increments revision when conditions materially change but not on no-op save", () => {
    const settings = createDefaultSettings();
    const first = withDefaultRuleConditions(settings, {
      conditions: { ...createEmptyConditions(), extensions: ["zip"] },
      waitForAllDownloads: false,
    });
    expect(first.rules[0]?.revision).toBe(2);
    const second = withDefaultRuleConditions(first, {
      conditions: { ...createEmptyConditions(), extensions: ["zip"] },
      waitForAllDownloads: false,
    });
    expect(second.rules[0]?.revision).toBe(2);
  });

  test("restores the default rule when it is missing", () => {
    const settings = normalizeSettings({
      version: 3,
      rules: [
        {
          id: "later",
          revision: 1,
          enabled: true,
          action: "reboot",
          executionMode: "dry_run",
          countdownSeconds: 30,
          conditions: createEmptyConditions(),
          waitForAllDownloads: false,
        },
      ],
    });
    expect(settings.rules[0]?.id).toBe("after-download");
    expect(settings.rules[1]?.id).toBe("later");
  });
});
