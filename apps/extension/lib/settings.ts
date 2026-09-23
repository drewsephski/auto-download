import { z } from "zod";
import { COUNTDOWN_SECONDS, DEFAULT_RULE_ID } from "./constants";

export const powerActionSchema = z.enum(["sleep", "shutdown", "reboot"]);

export type PowerAction = z.infer<typeof powerActionSchema>;

export const executionModeSchema = z.enum(["dry_run", "real"]);

export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const automationRuleSchema = z.strictObject({
  id: z.string().min(1).max(64),
  enabled: z.boolean(),
  action: powerActionSchema,
  executionMode: executionModeSchema,
  countdownSeconds: z.literal(COUNTDOWN_SECONDS),
});

export type AutomationRule = z.infer<typeof automationRuleSchema>;

export const settingsSchema = z.strictObject({
  version: z.literal(2),
  rules: z.array(automationRuleSchema).min(1).max(20),
});

export type Settings = z.infer<typeof settingsSchema>;

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

export function createDefaultRule(): AutomationRule {
  return {
    id: DEFAULT_RULE_ID,
    enabled: false,
    action: "sleep",
    executionMode: "dry_run",
    countdownSeconds: COUNTDOWN_SECONDS,
  };
}

export function createDefaultSettings(): Settings {
  return {
    version: 2,
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
      version: 2,
      rules: current.data.rules.map(sanitizeRule),
    };
  }

  const previous = versionOneSettingsSchema.safeParse(input);
  if (!previous.success) {
    return createDefaultSettings();
  }

  return {
    version: 2,
    rules: previous.data.rules.map((rule) => ({
      id: rule.id,
      enabled: rule.enabled,
      action: rule.action,
      executionMode: "dry_run",
      countdownSeconds: COUNTDOWN_SECONDS,
    })),
  };
}

export function defaultRule(settings: Settings): AutomationRule {
  return settings.rules.find((rule) => rule.id === DEFAULT_RULE_ID) ?? createDefaultRule();
}

export function withRuleEnabled(settings: Settings, enabled: boolean): Settings {
  return updateDefaultRule(settings, { enabled });
}

export function withRuleAction(settings: Settings, action: PowerAction): Settings {
  const current = defaultRule(settings);
  const executionMode: ExecutionMode =
    action === "sleep" && current.executionMode === "real" ? "real" : "dry_run";
  return updateDefaultRule(settings, { action, executionMode });
}

export function withDryRun(settings: Settings): Settings {
  return updateDefaultRule(settings, { executionMode: "dry_run" });
}

function ensureDefaultRule(settings: Settings): Settings {
  if (settings.rules.some((rule) => rule.id === DEFAULT_RULE_ID)) {
    return settings;
  }
  return {
    version: 2,
    rules: [createDefaultRule(), ...settings.rules].slice(0, 20),
  };
}

function sanitizeRule(rule: AutomationRule): AutomationRule {
  if (rule.id !== DEFAULT_RULE_ID && rule.executionMode === "real") {
    return { ...rule, executionMode: "dry_run" };
  }
  return rule;
}

function updateDefaultRule(
  settings: Settings,
  patch: Partial<Pick<AutomationRule, "enabled" | "action" | "executionMode">>,
): Settings {
  const normalized = normalizeSettings(settings);
  return {
    version: 2,
    rules: normalized.rules.map((rule) => {
      if (rule.id !== DEFAULT_RULE_ID) {
        return sanitizeRule(rule);
      }
      return sanitizeRule({
        ...rule,
        ...patch,
        countdownSeconds: COUNTDOWN_SECONDS,
      });
    }),
  };
}
