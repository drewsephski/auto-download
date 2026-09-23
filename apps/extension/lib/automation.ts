import { HANDLED_DOWNLOAD_LIMIT, HISTORY_LIMIT } from "./constants";
import { claimDownload } from "./dedup";
import { planAutomations, type PlannedAction } from "./decision";
import { toCompletedEvent, type DownloadCompletedEvent, type DownloadItemSnapshot } from "./download-event";
import { describeNativeFailure } from "./native-status";
import { createPendingAction, type PendingAction } from "./pending";
import {
  cancelActionRequest,
  parseHostResponse,
  type CancelActionRequest,
  type OneShotRequest,
  type ScheduleActionRequest,
} from "./protocol";
import { upsertExecution, type ExecutionRecord } from "./records";
import { normalizeSettings, type Settings } from "./settings";

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
  permissionGranted(): Promise<boolean>;
  notificationsGranted(): Promise<boolean>;
  hasLiveSession(): boolean;
  send(request: OneShotRequest): Promise<unknown>;
  schedule(request: ScheduleActionRequest): Promise<unknown>;
  cancel(request: CancelActionRequest): Promise<unknown>;
  showSleepNotification(actionId: string): Promise<boolean>;
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

    await deps.lock("download-automations:dispatch", async () => {
      const settings = normalizeSettings(await deps.getSettings());
      const pending = await deps.getPending();
      const plans = planAutomations(settings, event, deps.newRequestId, deps.newActionId, {
        permissionGranted: await deps.permissionGranted(),
        notificationsGranted: await deps.notificationsGranted(),
        hasLiveSession: deps.hasLiveSession(),
        pending,
      });
      for (const plan of plans) {
        const record = await runPlan(deps, plan, event);
        await remember(deps, record);
      }
    });
  });
}

async function runPlan(deps: AutomationDeps, plan: PlannedAction, event: DownloadCompletedEvent): Promise<ExecutionRecord> {
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
      action: "sleep",
      createdAt: deps.now(),
      ok: true,
      executed: false,
      executionMode: "real",
      status: "coalesced",
      message: "Sleep is already pending, so this download did not schedule another one.",
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
  return runRealSleep(deps, plan, event);
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

async function runRealSleep(
  deps: AutomationDeps,
  plan: Extract<PlannedAction, { kind: "real_sleep" }>,
  event: DownloadCompletedEvent,
): Promise<ExecutionRecord> {
  const base = {
    id: plan.request.actionId,
    requestId: plan.request.requestId,
    ruleId: plan.ruleId,
    downloadId: event.downloadId,
    filename: event.filename,
    action: "sleep" as const,
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
  if (parsed.status === "coalesced") {
    return {
      ...base,
      id: deps.newRequestId(),
      ok: true,
      status: "coalesced",
      message: "Sleep is already pending, so this download did not schedule another one.",
    };
  }

  const pending = createPendingAction({
    actionId: parsed.actionId,
    requestId: plan.request.requestId,
    downloadId: event.downloadId,
    filename: event.filename,
    scheduledAt: deps.now(),
    countdownSeconds: parsed.countdownSeconds,
  });
  await deps.setPending(pending);
  const shown = await deps.showSleepNotification(pending.actionId);
  if (!shown) {
    await cancelPending(deps, pending.actionId);
    await deps.setPending({ ...pending, status: "cancelled" });
    await deps.clearNotification(pending.actionId);
    return {
      ...base,
      ok: false,
      status: "cancelled",
      message: "Sleep was cancelled because the notification could not be shown.",
      errorCode: "notifications_unavailable",
    };
  }

  return {
    ...base,
    ok: true,
    status: "scheduled",
    message: "This Mac will sleep in 30 seconds unless you cancel.",
  };
}

async function cancelPending(deps: AutomationDeps, actionId: string): Promise<void> {
  try {
    await deps.cancel(cancelActionRequest({ requestId: deps.newRequestId(), actionId }));
  } catch {
    // The host discards a pending sleep when the connection closes. Do not retry it.
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
