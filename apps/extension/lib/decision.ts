import { actionPhrase } from "./action-copy";
import { COUNTDOWN_SECONDS } from "./constants";
import type { DownloadCompletedEvent } from "./download-event";
import type { PendingAction } from "./pending";
import { shouldCoalesce } from "./pending";
import {
  executeActionRequest,
  scheduleActionRequest,
  type ExecuteActionRequest,
  type ScheduleActionRequest,
} from "./protocol";
import { type PowerAction, type Settings } from "./settings";

export type PlannedAction =
  | { kind: "dry_run"; ruleId: string; action: PowerAction; request: ExecuteActionRequest }
  | { kind: "real_action"; ruleId: string; action: PowerAction; request: ScheduleActionRequest }
  | { kind: "coalesced"; ruleId: string; action: PowerAction; actionId: string }
  | { kind: "rejected"; ruleId: string; action: PowerAction; code: "real_action_not_enabled" | "prerequisites_missing"; message: string };

export interface PlanGates {
  permissionGranted: boolean;
  notificationsGranted: boolean;
  realActions: readonly PowerAction[];
  hasLiveSession: boolean;
  pending: PendingAction | null;
}

export function planAutomations(
  settings: Settings,
  event: DownloadCompletedEvent,
  createRequestId: () => string,
  createActionId: () => string,
  gates: PlanGates,
): PlannedAction[] {
  const plans: PlannedAction[] = [];
  for (const rule of settings.rules) {
    if (!rule.enabled) {
      continue;
    }
    if (rule.executionMode === "dry_run") {
      plans.push({
        kind: "dry_run",
        ruleId: rule.id,
        action: rule.action,
        request: executeActionRequest({
          requestId: createRequestId(),
          action: rule.action,
          downloadId: event.downloadId,
          filename: event.filename,
        }),
      });
      continue;
    }
    if (rule.countdownSeconds !== COUNTDOWN_SECONDS || !gates.realActions.includes(rule.action)) {
      plans.push({
        kind: "rejected",
        ruleId: rule.id,
        action: rule.action,
        code: "real_action_not_enabled",
        message: `Real ${actionPhrase(rule.action)} is not available from this helper.`,
      });
      continue;
    }
    if (shouldCoalesce(gates.pending, gates.hasLiveSession) && gates.pending) {
      plans.push({
        kind: "coalesced",
        ruleId: rule.id,
        action: gates.pending.action,
        actionId: gates.pending.actionId,
      });
      continue;
    }
    if (!gates.permissionGranted || !gates.notificationsGranted) {
      plans.push({
        kind: "rejected",
        ruleId: rule.id,
        action: rule.action,
        code: "prerequisites_missing",
        message: gates.permissionGranted
          ? `Real ${actionPhrase(rule.action)} was not scheduled because notifications are unavailable.`
          : `Real ${actionPhrase(rule.action)} was not scheduled because macOS control has not been allowed.`,
      });
      continue;
    }
    plans.push({
      kind: "real_action",
      ruleId: rule.id,
      action: rule.action,
      request: scheduleActionRequest({
        requestId: createRequestId(),
        actionId: createActionId(),
        action: rule.action,
        downloadId: event.downloadId,
        filename: event.filename,
      }),
    });
  }
  return plans;
}
