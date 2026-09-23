import { actionPhrase } from "./action-copy";
import { COUNTDOWN_SECONDS } from "./constants";
import type { DownloadCompletedEvent } from "./download-event";
import { matchesDownload } from "./rule-conditions";
import type { PendingAction } from "./pending";
import { shouldCoalesce } from "./pending";
import {
  executeActionRequest,
  scheduleActionRequest,
  type ExecuteActionRequest,
  type ScheduleActionRequest,
} from "./protocol";
import { type AutomationRule, type PowerAction, type Settings } from "./settings";

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

export function findFirstMatchingRule(settings: Settings, event: DownloadCompletedEvent): AutomationRule | null {
  for (const rule of settings.rules) {
    if (!rule.enabled) {
      continue;
    }
    const match = matchesDownload(event, rule.conditions);
    if (match.matched) {
      return rule;
    }
  }
  return null;
}

export function planAutomations(
  settings: Settings,
  event: DownloadCompletedEvent,
  createRequestId: () => string,
  createActionId: () => string,
  gates: PlanGates,
): PlannedAction[] {
  const rule = findFirstMatchingRule(settings, event);
  if (!rule) {
    return [];
  }
  const plan = planAutomationForRule(rule, event, createRequestId, createActionId, gates);
  return plan ? [plan] : [];
}

export function planAutomationForRule(
  rule: AutomationRule,
  event: DownloadCompletedEvent,
  createRequestId: () => string,
  createActionId: () => string,
  gates: PlanGates,
): PlannedAction | null {
  if (!rule.enabled) {
    return null;
  }
  if (rule.executionMode === "dry_run") {
    return {
      kind: "dry_run",
      ruleId: rule.id,
      action: rule.action,
      request: executeActionRequest({
        requestId: createRequestId(),
        action: rule.action,
        downloadId: event.downloadId,
        filename: event.filename,
      }),
    };
  }
  if (rule.countdownSeconds !== COUNTDOWN_SECONDS || !gates.realActions.includes(rule.action)) {
    return {
      kind: "rejected",
      ruleId: rule.id,
      action: rule.action,
      code: "real_action_not_enabled",
      message: `Real ${actionPhrase(rule.action)} is not available from this helper.`,
    };
  }
  if (shouldCoalesce(gates.pending, gates.hasLiveSession) && gates.pending) {
    return {
      kind: "coalesced",
      ruleId: rule.id,
      action: gates.pending.action,
      actionId: gates.pending.actionId,
    };
  }
  if (!gates.permissionGranted || !gates.notificationsGranted) {
    return {
      kind: "rejected",
      ruleId: rule.id,
      action: rule.action,
      code: "prerequisites_missing",
      message: gates.permissionGranted
        ? `Real ${actionPhrase(rule.action)} was not scheduled because notifications are unavailable.`
        : `Real ${actionPhrase(rule.action)} was not scheduled because macOS control has not been allowed.`,
    };
  }
  return {
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
  };
}
