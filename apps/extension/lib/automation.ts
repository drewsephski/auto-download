import { coalesceMessage, notificationBlockedMessage, scheduledMessage } from "./action-copy";
import { HANDLED_DOWNLOAD_LIMIT, HISTORY_LIMIT } from "./constants";
import { claimDownload } from "./dedup";
import { findFirstMatchingRule, planAutomationForRule, type PlannedAction } from "./decision";
import type { DeferredTrigger } from "./deferred-trigger";
import { deferredFromPendingMetadata } from "./deferred-trigger";
import { QUEUE_LOCK, shouldDeferForIdle, upsertDeferred } from "./download-queue";
import { toCompletedEvent, type DownloadCompletedEvent, type DownloadItemSnapshot } from "./download-event";
import { describeNativeFailure } from "./native-status";
import { createPendingAction, pendingRequiresIdleReroute, type PendingAction } from "./pending";
import {
  cancelActionRequest,
  parseHostResponse,
  type CancelActionRequest,
  type OneShotRequest,
  type ScheduleActionRequest,
} from "./protocol";
import { upsertExecution, type ExecutionRecord } from "./records";
import { normalizeSettings, type AutomationRule, type PowerAction, type Settings } from "./settings";

export interface AutomationDeps {
  getDownload(id: number): Promise<DownloadItemSnapshot | null>;
  getSettings(): Promise<Settings>;
  getHandledIds(): Promise<number[]>;
  setHandledIds(ids: number[]): Promise<void>;
  getDownloadHistory(): Promise<DownloadCompletedEvent[]>;
  setDownloadHistory(records: DownloadCompletedEvent[]): Promise<void>;
  getExecutionHistory(): Promise<ExecutionRecord[]>;
  setExecutionHistory(records: ExecutionRecord[]): Promise<void>;
  getPending(): Promise<PendingAction | null>;
  setPending(pending: PendingAction | null): Promise<void>;
  getDeferred(): Promise<DeferredTrigger | null>;
  setDeferred(deferred: DeferredTrigger | null): Promise<void>;
  hasActiveDownloads(): Promise<boolean>;
  permissionGranted(): Promise<boolean>;
  notificationsGranted(): Promise<boolean>;
  realActions(): Promise<readonly PowerAction[]>;
  hasLiveSession(): boolean;
  send(request: OneShotRequest): Promise<unknown>;
  schedule(request: ScheduleActionRequest): Promise<unknown>;
  cancel(request: CancelActionRequest): Promise<unknown>;
  showNotification(action: PowerAction, actionId: string): Promise<boolean>;
  clearNotification(actionId: string): Promise<void>;
  now(): number;
  newRequestId(): string;
  newActionId(): string;
  lock<T>(name: string, task: () => Promise<T>): Promise<T>;
}

export async function processCompletedDownload(deps: AutomationDeps, downloadId: number): Promise<void> {
  await deps.lock(`download-automations:claim:${downloadId}`, async () => {
    const handled = await deps.getHandledIds();
    if (handled.includes(downloadId)) {
      return;
    }

    const item = await deps.getDownload(downloadId);
    const event = item ? toCompletedEvent(item, deps.now()) : null;
    if (!event) {
      return;
    }

    const claim = claimDownload(handled, downloadId, HANDLED_DOWNLOAD_LIMIT);
    if (!claim.claimed) {
      return;
    }
    await deps.setHandledIds(claim.nextIds);

    await deps.lock("download-automations:history", async () => {
      const history = await deps.getDownloadHistory();
      await deps.setDownloadHistory(prependDownload(history, event));
    });

    await handleMatchedAutomation(deps, event);
    await flushDeferredIfIdle(deps);
  });
}

export async function handleQueueTerminalChange(deps: AutomationDeps): Promise<void> {
  await flushDeferredIfIdle(deps);
}

export async function handleDownloadStartedDuringCountdown(deps: AutomationDeps): Promise<void> {
  const pending = await deps.getPending();
  if (!pending || !pendingRequiresIdleReroute(pending)) {
    return;
  }
  if (!pending.ruleId || pending.ruleRevision === undefined) {
    return;
  }
  await deps.lock("download-automations:dispatch", async () => {
    const current = await deps.getPending();
    if (!current || !pendingRequiresIdleReroute(current)) {
      return;
    }
    await cancelPendingForReroute(deps, current);
    const deferred = deferredFromPendingMetadata({
      ruleId: current.ruleId!,
      ruleRevision: current.ruleRevision!,
      downloadId: current.downloadId,
      filename: current.filename,
      deferredAt: deps.now(),
    });
    await deps.setDeferred(deferred);
  });
}

export async function flushDeferredIfIdle(deps: AutomationDeps): Promise<void> {
  await deps.lock(QUEUE_LOCK, async () => {
    if (await deps.hasActiveDownloads()) {
      return;
    }
    const deferred = await deps.getDeferred();
    if (!deferred) {
      return;
    }
    const settings = normalizeSettings(await deps.getSettings());
    const rule = settings.rules.find((item) => item.id === deferred.ruleId);
    if (!rule || !rule.enabled || rule.revision !== deferred.ruleRevision) {
      await deps.setDeferred(null);
      return;
    }
    await deps.lock("download-automations:dispatch", async () => {
      const stillDeferred = await deps.getDeferred();
      if (!stillDeferred || stillDeferred.ruleId !== deferred.ruleId) {
        return;
      }
      if (await deps.hasActiveDownloads()) {
        return;
      }
      const latestSettings = normalizeSettings(await deps.getSettings());
      const latestRule = latestSettings.rules.find((item) => item.id === stillDeferred.ruleId);
      if (!latestRule || !latestRule.enabled || latestRule.revision !== stillDeferred.ruleRevision) {
        await deps.setDeferred(null);
        return;
      }
      await executeAutomationForRule(deps, latestRule, stillDeferred.representativeDownload, {
        requiresIdleDownloads: latestRule.waitForAllDownloads,
      });
      await deps.setDeferred(null);
    });
  });
}

async function handleMatchedAutomation(deps: AutomationDeps, event: DownloadCompletedEvent): Promise<void> {
  await deps.lock("download-automations:dispatch", async () => {
    const settings = normalizeSettings(await deps.getSettings());
    const rule = findFirstMatchingRule(settings, event);
    if (!rule) {
      return;
    }
    const defer = await shouldDeferForIdle(rule, deps);
    if (defer) {
      const current = await deps.getDeferred();
      const next = upsertDeferred(
        current,
        {
          ruleId: rule.id,
          ruleRevision: rule.revision,
          representativeDownload: event,
          deferredAt: deps.now(),
        },
        settings,
      );
      await deps.setDeferred(next);
      return;
    }
    await executeAutomationForRule(deps, rule, event, {
      requiresIdleDownloads: rule.waitForAllDownloads,
    });
  });
}

async function executeAutomationForRule(
  deps: AutomationDeps,
  rule: AutomationRule,
  event: DownloadCompletedEvent,
  options: { requiresIdleDownloads: boolean },
): Promise<void> {
  const pending = await deps.getPending();
  const needsRealActions = rule.enabled && rule.executionMode === "real";
  const realActions = needsRealActions ? await deps.realActions().catch(() => []) : [];
  const plan = planAutomationForRule(rule, event, deps.newRequestId, deps.newActionId, {
    permissionGranted: await deps.permissionGranted(),
    notificationsGranted: await deps.notificationsGranted(),
    realActions,
    hasLiveSession: deps.hasLiveSession(),
    pending,
  });
  if (!plan) {
    return;
  }
  const record = await runPlan(deps, plan, event, rule, options.requiresIdleDownloads);
  await remember(deps, record);
}

async function runPlan(
  deps: AutomationDeps,
  plan: PlannedAction,
  event: DownloadCompletedEvent,
  rule: AutomationRule,
  requiresIdleDownloads: boolean,
): Promise<ExecutionRecord> {
  if (plan.kind === "dry_run") {
    return runDryRun(deps, plan, event);
  }
  if (plan.kind === "coalesced") {
    return {
      id: deps.newRequestId(),
      requestId: plan.actionId || deps.newRequestId(),
      ruleId: plan.ruleId,
      downloadId: event.downloadId,
      filename: event.filename,
      action: plan.action,
      createdAt: deps.now(),
      ok: true,
      executed: false,
      executionMode: "real",
      status: "coalesced",
      message: coalesceMessage(plan.action),
    };
  }
  if (plan.kind === "rejected") {
    return {
      id: deps.newRequestId(),
      requestId: deps.newRequestId(),
      ruleId: plan.ruleId,
      downloadId: event.downloadId,
      filename: event.filename,
      action: plan.action,
      createdAt: deps.now(),
      ok: false,
      executed: false,
      executionMode: "real",
      status: "failed",
      message: plan.message,
      errorCode: plan.code,
    };
  }
  return runRealAction(deps, plan, event, rule, requiresIdleDownloads);
}

async function runDryRun(
  deps: AutomationDeps,
  plan: Extract<PlannedAction, { kind: "dry_run" }>,
  event: DownloadCompletedEvent,
): Promise<ExecutionRecord> {
  const base = {
    id: plan.request.requestId,
    requestId: plan.request.requestId,
    ruleId: plan.ruleId,
    downloadId: event.downloadId,
    filename: event.filename,
    action: plan.action,
    createdAt: deps.now(),
    executed: false as const,
    executionMode: "dry_run" as const,
    status: "simulated" as const,
  };

  try {
    const payload = await deps.send(plan.request);
    const parsed = parseHostResponse(plan.request.requestId, "execute_action", payload);
    if (!parsed.ok) {
      return { ...base, ok: false, status: "failed", message: parsed.message, errorCode: parsed.code };
    }
    if (parsed.type !== "execute_action" || parsed.action !== plan.action) {
      return {
        ...base,
        ok: false,
        status: "failed",
        message: "The helper returned an unexpected result.",
        errorCode: "unexpected_result",
      };
    }
    return { ...base, ok: true, message: parsed.message };
  } catch (error) {
    const failure = describeNativeFailure(error);
    return {
      ...base,
      ok: false,
      status: "failed",
      message: failure.message,
      errorCode: failure.status === "not_installed" ? "not_installed" : "host_error",
    };
  }
}

async function runRealAction(
  deps: AutomationDeps,
  plan: Extract<PlannedAction, { kind: "real_action" }>,
  event: DownloadCompletedEvent,
  rule: AutomationRule,
  requiresIdleDownloads: boolean,
): Promise<ExecutionRecord> {
  const base = {
    id: plan.request.actionId,
    requestId: plan.request.requestId,
    ruleId: plan.ruleId,
    downloadId: event.downloadId,
    filename: event.filename,
    action: plan.action,
    createdAt: deps.now(),
    executed: false as const,
    executionMode: "real" as const,
  };

  let payload: unknown;
  try {
    payload = await deps.schedule(plan.request);
  } catch (error) {
    const failure = describeNativeFailure(error);
    return {
      ...base,
      ok: false,
      status: "failed",
      message: failure.message,
      errorCode: failure.status === "not_installed" ? "not_installed" : "host_error",
    };
  }

  const parsed = parseHostResponse(plan.request.requestId, "schedule_action", payload);
  if (!parsed.ok || parsed.type !== "schedule_action") {
    return {
      ...base,
      ok: false,
      status: "failed",
      message: parsed.ok ? "The helper returned an unexpected result." : parsed.message,
      errorCode: parsed.ok ? "unexpected_result" : parsed.code,
    };
  }
  if (parsed.status === "scheduled" && parsed.action !== plan.action) {
    await cancelPending(deps, parsed.actionId);
    return {
      ...base,
      ok: false,
      status: "failed",
      message: "The helper returned an unexpected result.",
      errorCode: "unexpected_result",
    };
  }
  if (parsed.status === "coalesced") {
    return {
      ...base,
      id: deps.newRequestId(),
      action: parsed.action,
      ok: true,
      status: "coalesced",
      message: coalesceMessage(parsed.action),
    };
  }

  const pending = createPendingAction({
    actionId: parsed.actionId,
    requestId: plan.request.requestId,
    action: plan.action,
    downloadId: event.downloadId,
    filename: event.filename,
    scheduledAt: deps.now(),
    countdownSeconds: parsed.countdownSeconds,
    ruleId: rule.id,
    ruleRevision: rule.revision,
    requiresIdleDownloads,
  });
  await deps.setPending(pending);
  const shown = await deps.showNotification(pending.action, pending.actionId);
  if (!shown) {
    await cancelPending(deps, pending.actionId);
    await deps.setPending({ ...pending, status: "cancelled" });
    await deps.clearNotification(pending.actionId);
    return {
      ...base,
      ok: false,
      status: "cancelled",
      message: notificationBlockedMessage(plan.action),
      errorCode: "notifications_unavailable",
    };
  }

  return {
    ...base,
    ok: true,
    status: "scheduled",
    message: scheduledMessage(plan.action),
  };
}

async function cancelPendingForReroute(deps: AutomationDeps, pending: PendingAction): Promise<void> {
  try {
    await deps.cancel(cancelActionRequest({ requestId: deps.newRequestId(), actionId: pending.actionId }));
  } catch {
    // Connection loss already discarded the host-side action.
  }
  await deps.setPending({ ...pending, status: "cancelled" });
  await deps.clearNotification(pending.actionId);
}

async function cancelPending(deps: AutomationDeps, actionId: string): Promise<void> {
  try {
    await deps.cancel(cancelActionRequest({ requestId: deps.newRequestId(), actionId }));
  } catch {
    // The host discards a pending action when the connection closes. Do not retry it.
  }
}

async function remember(deps: AutomationDeps, record: ExecutionRecord): Promise<void> {
  await deps.lock("download-automations:history", async () => {
    const history = await deps.getExecutionHistory();
    await deps.setExecutionHistory(upsertExecution(history, record, HISTORY_LIMIT));
  });
}

function prependDownload(history: DownloadCompletedEvent[], event: DownloadCompletedEvent): DownloadCompletedEvent[] {
  return [event, ...history].slice(0, HISTORY_LIMIT);
}

export async function clearDeferredOnBrowserStartup(deps: Pick<AutomationDeps, "setDeferred">): Promise<void> {
  await deps.setDeferred(null);
}
