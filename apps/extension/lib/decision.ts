import { executeActionRequest, type ExecuteActionRequest } from "./protocol";
import type { DownloadCompletedEvent } from "./download-event";
import { type PowerAction, type Settings } from "./settings";

export interface PlannedAction {
  ruleId: string;
  action: PowerAction;
  request: ExecuteActionRequest;
}

export function planAutomations(
  settings: Settings,
  event: DownloadCompletedEvent,
  createRequestId: () => string,
): PlannedAction[] {
  const plans: PlannedAction[] = [];
  for (const rule of settings.rules) {
    if (!rule.enabled || rule.dryRun !== true) {
      continue;
    }
    plans.push({
      ruleId: rule.id,
      action: rule.action,
      request: executeActionRequest({
        requestId: createRequestId(),
        action: rule.action,
        downloadId: event.downloadId,
        filename: event.filename,
      }),
    });
  }
  return plans;
}
