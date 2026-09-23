import { withDryRun, type AutomationRule, type Settings } from "./settings";

export type ArmBlock =
  | "confirmation_required"
  | "permission_required"
  | "notifications_required"
  | "action_not_enabled"
  | "helper_not_ready";

export interface RealSleepGates {
  permissionGranted: boolean;
  notificationsGranted: boolean;
  realSleepSupported: boolean;
  confirmed: boolean;
}

export type RealSleepDecision =
  | { ok: true; settings: Settings }
  | { ok: false; reason: ArmBlock; message: string };

const ARM_MESSAGES: Record<Exclude<ArmBlock, "confirmation_required">, string> = {
  permission_required: "Allow macOS control before real sleep can be enabled.",
  notifications_required: "Turn on Chrome notifications so you can cancel sleep. Dry run still works.",
  action_not_enabled: "Real shut down and restart are not enabled yet.",
  helper_not_ready: "Real sleep needs a connected helper that allows it.",
};

export function prepareRealSleep(settings: Settings, rule: AutomationRule, gates: RealSleepGates): RealSleepDecision {
  if (rule.action !== "sleep") {
    return blocked("action_not_enabled");
  }
  if (!gates.realSleepSupported) {
    return blocked("helper_not_ready");
  }
  if (!gates.permissionGranted) {
    return blocked("permission_required");
  }
  if (!gates.notificationsGranted) {
    return blocked("notifications_required");
  }
  if (!gates.confirmed) {
    return {
      ok: false,
      reason: "confirmation_required",
      message: "Confirm real sleep before it can be enabled.",
    };
  }

  return {
    ok: true,
    settings: {
      version: 2,
      rules: settings.rules.map((candidate) => {
        if (candidate.id !== rule.id) {
          return candidate;
        }
        return {
          ...candidate,
          action: "sleep",
          executionMode: "real",
          countdownSeconds: 30,
        };
      }),
    },
  };
}

export function modePresentation(rule: AutomationRule): { live: boolean; label: string; detail: string } {
  if (rule.executionMode === "real" && rule.action === "sleep") {
    return {
      live: true,
      label: "LIVE — SLEEP ENABLED",
      detail: rule.enabled
        ? "After a download finishes, this Mac sleeps in 30 seconds unless you cancel."
        : "Real sleep is armed. Turn on automation before a download can use it.",
    };
  }
  return {
    live: false,
    label: "DRY RUN",
    detail: "Sleep, shut down, and restart are simulated. Nothing will actually happen.",
  };
}

export function keepDryRun(settings: Settings): Settings {
  return withDryRun(settings);
}

function blocked(reason: Exclude<ArmBlock, "confirmation_required">): RealSleepDecision {
  return { ok: false, reason, message: ARM_MESSAGES[reason] };
}
