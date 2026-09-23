import { HANDLED_DOWNLOAD_LIMIT, HISTORY_LIMIT } from "./constants";
import { claimDownload } from "./dedup";
import { planAutomations, type PlannedAction } from "./decision";
import { toCompletedEvent, type DownloadCompletedEvent, type DownloadItemSnapshot } from "./download-event";
import { prependBounded } from "./history";
import { describeNativeFailure } from "./native-status";
import { parseHostResponse, type NativeRequest } from "./protocol";
import { normalizeSettings, type Settings } from "./settings";
import { type ExecutionRecord } from "./records";

export interface AutomationDeps {
  getDownload(id: number): Promise<DownloadItemSnapshot | null>;
  getSettings(): Promise<Settings>;
  getHandledIds(): Promise<number[]>;
  setHandledIds(ids: number[]): Promise<void>;
  getDownloadHistory(): Promise<DownloadCompletedEvent[]>;
  setDownloadHistory(records: DownloadCompletedEvent[]): Promise<void>;
  getExecutionHistory(): Promise<ExecutionRecord[]>;
  setExecutionHistory(records: ExecutionRecord[]): Promise<void>;
  send(request: NativeRequest): Promise<unknown>;
  now(): number;
  newRequestId(): string;
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
      await deps.setDownloadHistory(prependBounded(history, event, HISTORY_LIMIT));
    });

    const settings = normalizeSettings(await deps.getSettings());
    const plans = planAutomations(settings, event, deps.newRequestId);
    for (const plan of plans) {
      const record = await runPlan(deps, plan, event);
      await deps.lock("download-automations:history", async () => {
        const history = await deps.getExecutionHistory();
        await deps.setExecutionHistory(prependBounded(history, record, HISTORY_LIMIT));
      });
    }
  });
}

async function runPlan(
  deps: AutomationDeps,
  plan: PlannedAction,
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
    dryRun: true as const,
  };

  try {
    const payload = await deps.send(plan.request);
    const parsed = parseHostResponse(plan.request.requestId, "execute_action", payload);
    if (!parsed.ok) {
      return { ...base, ok: false, message: parsed.message, errorCode: parsed.code };
    }
    if (parsed.type !== "execute_action" || parsed.action !== plan.action) {
      return {
        ...base,
        ok: false,
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
      message: failure.message,
      errorCode: failure.status === "not_installed" ? "not_installed" : "host_error",
    };
  }
}
