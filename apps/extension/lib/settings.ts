import { z } from "zod";
import { DEFAULT_RULE_ID } from "./constants";

export const powerActionSchema = z.enum(["sleep", "shutdown", "reboot"]);

export type PowerAction = z.infer<typeof powerActionSchema>;

export const automationRuleSchema = z.strictObject({
  id: z.string().min(1).max(64),
  enabled: z.boolean(),
  action: powerActionSchema,
  dryRun: z.literal(true),
});

export type AutomationRule = z.infer<typeof automationRuleSchema>;

export const settingsSchema = z.strictObject({
  version: z.literal(1),
  rules: z.array(automationRuleSchema).min(1).max(20),
});

export type Settings = z.infer<typeof settingsSchema>;

export function createDefaultRule(): AutomationRule {
  return {
    id: DEFAULT_RULE_ID,
    enabled: false,
    action: "sleep",
    dryRun: true,
  };
}

export function createDefaultSettings(): Settings {
  return {
    version: 1,
    rules: [createDefaultRule()],
  };
}

export const defaultSettings: Settings = createDefaultSettings();

export function normalizeSettings(input: unknown): Settings {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return createDefaultSettings();
  }
  if (parsed.data.rules.some((rule) => rule.id === DEFAULT_RULE_ID)) {
    return parsed.data;
  }
  return {
    version: 1,
    rules: [createDefaultRule(), ...parsed.data.rules].slice(0, 20),
  };
}

export function defaultRule(settings: Settings): AutomationRule {
  return settings.rules.find((rule) => rule.id === DEFAULT_RULE_ID) ?? createDefaultRule();
}

export function withRuleEnabled(settings: Settings, enabled: boolean): Settings {
  return updateDefaultRule(settings, { enabled });
}

export function withRuleAction(settings: Settings, action: PowerAction): Settings {
  return updateDefaultRule(settings, { action });
}

function updateDefaultRule(settings: Settings, patch: Partial<Pick<AutomationRule, "enabled" | "action">>): Settings {
  const normalized = normalizeSettings(settings);
  return {
    version: 1,
    rules: normalized.rules.map((rule) => {
      if (rule.id !== DEFAULT_RULE_ID) {
        return rule;
      }
      return {
        ...rule,
        ...patch,
        dryRun: true,
      };
    }),
  };
}
