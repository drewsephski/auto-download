import { actionPhrase, confirmationCopy, liveDetail, liveLabel } from "./action-copy";
import { withDryRun, type AutomationRule, type PowerAction, type Settings } from "./settings";

export type ArmBlock =
  | "confirmation_required"
  | "permission_required"
  | "notifications_required"
  | "action_not_enabled"
  | "helper_not_ready";

export interface RealActionGates {
  permissionGranted: boolean;
  notificationsGranted: boolean;
  realActions: readonly PowerAction[];
  confirmed: boolean;
}

export type RealActionDecision =
  | { ok: true; settings: Settings }
  | { ok: false; reason: ArmBlock; message: string };

export function prepareRealAction(settings: Settings, rule: AutomationRule, gates: RealActionGates): RealActionDecision {
  if (!gates.realActions.includes(rule.action)) {
    return blocked(rule.action, gates.realActions.length === 0 ? "helper_not_ready" : "action_not_enabled");
  }
  if (!gates.permissionGranted) {
    return blocked(rule.action, "permission_required");
  }
  if (!gates.notificationsGranted) {
    return blocked(rule.action, "notifications_required");
  }
  if (!gates.confirmed) {
    return {
      ok: false,
      reason: "confirmation_required",
      message: `Confirm real ${actionPhrase(rule.action)} before it can be enabled.`,
    };
  }

  return {
    ok: true,
    settings: {
      version: 3,
      rules: settings.rules.map((candidate) => {
        if (candidate.id !== rule.id) {
          return candidate;
        }
        return {
          ...candidate,
          action: rule.action,
          executionMode: "real",
          countdownSeconds: 30,
          revision: candidate.executionMode === "real" ? candidate.revision : candidate.revision + 1,
        };
      }),
    },
  };
}

export function modePresentation(rule: AutomationRule): { live: boolean; label: string; detail: string } {
  if (rule.executionMode === "real") {
    return {
      live: true,
      label: liveLabel(rule.action),
      detail: liveDetail(rule.action, rule.enabled),
    };
  }
  return {
    live: false,
    label: "DRY RUN",
    detail: "Sleep, shut down, and restart are simulated. Nothing will actually happen.",
  };
}

export function realConfirmation(action: PowerAction) {
  return confirmationCopy(action);
}

export function keepDryRun(settings: Settings): Settings {
  return withDryRun(settings);
}

function blocked(action: PowerAction, reason: Exclude<ArmBlock, "confirmation_required">): RealActionDecision {
  return { ok: false, reason, message: armMessage(action, reason) };
}

function armMessage(action: PowerAction, reason: Exclude<ArmBlock, "confirmation_required">): string {
  const phrase = actionPhrase(action);
  switch (reason) {
    case "permission_required":
      return `Allow macOS control before real ${phrase} can be enabled.`;
    case "notifications_required":
      return `Turn on Chrome notifications so you can cancel ${phrase}. Dry run still works.`;
    case "action_not_enabled":
      return `Real ${phrase} is not available from this helper.`;
    case "helper_not_ready":
      return `Real ${phrase} needs a connected helper that allows it.`;
  }
}
