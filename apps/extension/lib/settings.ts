import { z } from "zod";
import { COUNTDOWN_SECONDS, DEFAULT_RULE_ID } from "./constants";
import type { RuleConditions } from "./rule-conditions";
import { MAX_EXTENSION_ENTRIES, MAX_SOURCE_HOST_ENTRIES } from "./rule-conditions";

export const powerActionSchema = z.enum(["sleep", "shutdown", "reboot"]);

export type PowerAction = z.infer<typeof powerActionSchema>;

export const executionModeSchema = z.enum(["dry_run", "real"]);

export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const ruleConditionsSchema = z.strictObject({
  filenamePattern: z.string().min(1).max(128).nullable(),
  extensions: z.array(z.string().min(1).max(32)).max(MAX_EXTENSION_ENTRIES),
  sourceHosts: z.array(z.string().min(1).max(253)).max(MAX_SOURCE_HOST_ENTRIES),
  minSizeBytes: z.number().int().nonnegative().nullable(),
  maxSizeBytes: z.number().int().nonnegative().nullable(),
});

export const automationRuleSchema = z.strictObject({
  id: z.string().min(1).max(64),
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  action: powerActionSchema,
  executionMode: executionModeSchema,
  countdownSeconds: z.literal(COUNTDOWN_SECONDS),
  conditions: ruleConditionsSchema,
  waitForAllDownloads: z.boolean(),
});

export type AutomationRule = z.infer<typeof automationRuleSchema>;

export const settingsSchema = z.strictObject({
  version: z.literal(3),
  rules: z.array(automationRuleSchema).min(1).max(20),
});

export type Settings = z.infer<typeof settingsSchema>;

const versionTwoRuleSchema = z.strictObject({
  id: z.string().min(1).max(64),
  enabled: z.boolean(),
  action: powerActionSchema,
  executionMode: executionModeSchema,
  countdownSeconds: z.literal(COUNTDOWN_SECONDS),
});

const versionTwoSettingsSchema = z.strictObject({
  version: z.literal(2),
  rules: z.array(versionTwoRuleSchema).min(1).max(20),
});

const versionOneRuleSchema = z.strictObject({
  id: z.string().min(1).max(64),
  enabled: z.boolean(),
  action: powerActionSchema,
  dryRun: z.literal(true),
});

const versionOneSettingsSchema = z.strictObject({
  version: z.literal(1),
  rules: z.array(versionOneRuleSchema).min(1).max(20),
});

export function createEmptyConditions(): RuleConditions {
  return {
    filenamePattern: null,
    extensions: [],
    sourceHosts: [],
    minSizeBytes: null,
    maxSizeBytes: null,
  };
}

export function createDefaultRule(): AutomationRule {
  return {
    id: DEFAULT_RULE_ID,
    revision: 1,
    enabled: false,
    action: "sleep",
    executionMode: "dry_run",
    countdownSeconds: COUNTDOWN_SECONDS,
    conditions: createEmptyConditions(),
    waitForAllDownloads: false,
  };
}

export function createDefaultSettings(): Settings {
  return {
    version: 3,
    rules: [createDefaultRule()],
  };
}

export const defaultSettings: Settings = createDefaultSettings();

export function normalizeSettings(input: unknown): Settings {
  return ensureDefaultRule(migrateSettings(input));
}

export function migrateSettings(input: unknown): Settings {
  const current = settingsSchema.safeParse(input);
  if (current.success) {
    return {
      version: 3,
      rules: current.data.rules.map(sanitizeRule),
    };
  }

  const previousTwo = versionTwoSettingsSchema.safeParse(input);
  if (previousTwo.success) {
    return {
      version: 3,
      rules: previousTwo.data.rules.map((rule) =>
        sanitizeRule({
          ...rule,
          revision: 1,
          conditions: createEmptyConditions(),
          waitForAllDownloads: false,
        }),
      ),
    };
  }

  const previous = versionOneSettingsSchema.safeParse(input);
  if (!previous.success) {
    return createDefaultSettings();
  }

  return {
    version: 3,
    rules: previous.data.rules.map((rule) =>
      sanitizeRule({
        id: rule.id,
        revision: 1,
        enabled: rule.enabled,
        action: rule.action,
        executionMode: "dry_run",
        countdownSeconds: COUNTDOWN_SECONDS,
        conditions: createEmptyConditions(),
        waitForAllDownloads: false,
      }),
    ),
  };
}

export function defaultRule(settings: Settings): AutomationRule {
  return settings.rules.find((rule) => rule.id === DEFAULT_RULE_ID) ?? createDefaultRule();
}

export function withRuleEnabled(settings: Settings, enabled: boolean): Settings {
  return updateDefaultRule(settings, { enabled }, enabled !== defaultRule(settings).enabled);
}

export function withRuleAction(settings: Settings, action: PowerAction): Settings {
  const current = defaultRule(settings);
  const executionMode: ExecutionMode = action === current.action ? current.executionMode : "dry_run";
  const actionChanged = action !== current.action;
  const modeChanged = executionMode !== current.executionMode;
  return updateDefaultRule(settings, { action, executionMode }, actionChanged || modeChanged);
}

export function withDryRun(settings: Settings): Settings {
  const changed = defaultRule(settings).executionMode !== "dry_run";
  return updateDefaultRule(settings, { executionMode: "dry_run" }, changed);
}

export function withDefaultRuleConditions(
  settings: Settings,
  patch: {
    conditions: RuleConditions;
    waitForAllDownloads: boolean;
  },
): Settings {
  const current = defaultRule(settings);
  const materiallyChanged =
    !conditionsEqual(current.conditions, patch.conditions) ||
    current.waitForAllDownloads !== patch.waitForAllDownloads;
  return updateDefaultRule(
    settings,
    {
      conditions: patch.conditions,
      waitForAllDownloads: patch.waitForAllDownloads,
    },
    materiallyChanged,
  );
}

export function conditionsEqual(left: RuleConditions, right: RuleConditions): boolean {
  return (
    left.filenamePattern === right.filenamePattern &&
    left.minSizeBytes === right.minSizeBytes &&
    left.maxSizeBytes === right.maxSizeBytes &&
    arraysEqual(left.extensions, right.extensions) &&
    arraysEqual(left.sourceHosts, right.sourceHosts)
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function ensureDefaultRule(settings: Settings): Settings {
  if (settings.rules.some((rule) => rule.id === DEFAULT_RULE_ID)) {
    return settings;
  }
  return {
    version: 3,
    rules: [createDefaultRule(), ...settings.rules].slice(0, 20),
  };
}

function sanitizeRule(rule: AutomationRule): AutomationRule {
  const executionMode = rule.id !== DEFAULT_RULE_ID && rule.executionMode === "real" ? "dry_run" : rule.executionMode;
  const { minSizeBytes, maxSizeBytes } = rule.conditions;
  const sizeValid = minSizeBytes === null || maxSizeBytes === null || minSizeBytes <= maxSizeBytes;
  const conditions = sizeValid
    ? rule.conditions
    : { ...rule.conditions, minSizeBytes: null, maxSizeBytes: null };
  return {
    ...rule,
    executionMode,
    conditions,
    countdownSeconds: COUNTDOWN_SECONDS,
  };
}

function updateDefaultRule(
  settings: Settings,
  patch: Partial<
    Pick<AutomationRule, "enabled" | "action" | "executionMode" | "conditions" | "waitForAllDownloads">
  >,
  bumpRevision: boolean,
): Settings {
  const normalized = normalizeSettings(settings);
  return {
    version: 3,
    rules: normalized.rules.map((rule) => {
      if (rule.id !== DEFAULT_RULE_ID) {
        return sanitizeRule(rule);
      }
      const next = sanitizeRule({
        ...rule,
        ...patch,
        revision: bumpRevision ? rule.revision + 1 : rule.revision,
        countdownSeconds: COUNTDOWN_SECONDS,
      });
      return next;
    }),
  };
}
