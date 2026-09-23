import type { DeferredTrigger } from "./deferred-trigger";
import { mergeDeferredTrigger } from "./deferred-trigger";
import type { DownloadCompletedEvent } from "./download-event";
import type { AutomationRule, Settings } from "./settings";

export const QUEUE_LOCK = "download-automations:queue";

export interface ActiveDownloadQuery {
  hasActiveDownloads(): Promise<boolean>;
}

export async function shouldDeferForIdle(rule: AutomationRule, query: ActiveDownloadQuery): Promise<boolean> {
  if (!rule.waitForAllDownloads) {
    return false;
  }
  return await query.hasActiveDownloads();
}

export function buildDeferredCandidate(
  rule: AutomationRule,
  event: DownloadCompletedEvent,
  deferredAt: number,
): {
  ruleId: string;
  ruleRevision: number;
  representativeDownload: DownloadCompletedEvent;
  deferredAt: number;
} {
  return {
    ruleId: rule.id,
    ruleRevision: rule.revision,
    representativeDownload: event,
    deferredAt,
  };
}

export function upsertDeferred(
  current: DeferredTrigger | null,
  candidate: ReturnType<typeof buildDeferredCandidate>,
  settings: Settings,
): DeferredTrigger {
  return mergeDeferredTrigger(current, candidate, settings);
}
