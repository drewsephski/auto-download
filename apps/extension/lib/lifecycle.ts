import { DEFAULT_RULE_ID } from "./constants";
import { applyTerminalStatus, type PendingAction, type PendingStatus } from "./pending";
import type { ExecutionRecord } from "./records";

export function describeInterruptedPending(pending: PendingAction): ExecutionRecord {
  return executionFromPending(pending, "connection_lost", false, "The sleep was cancelled because the helper connection closed.", "connection_lost");
}

export function describeCancelledPending(pending: PendingAction): ExecutionRecord {
  return executionFromPending(pending, "cancelled", false, "The pending sleep was cancelled.", undefined);
}

export function describeLifecycle(pending: PendingAction, status: Extract<PendingStatus, "executing" | "executed" | "failed">, message: string): {
  pending: PendingAction;
  record: ExecutionRecord;
} {
  const next = applyTerminalStatus(pending, status);
  const executed = status === "executed";
  return {
    pending: next,
    record: executionFromPending(next, status, executed, message, status === "failed" ? "sleep_failed" : undefined),
  };
}

function executionFromPending(
  pending: PendingAction,
  status: ExecutionRecord["status"],
  executed: boolean,
  message: string,
  errorCode: string | undefined,
): ExecutionRecord {
  return {
    id: pending.actionId,
    requestId: pending.requestId,
    ruleId: DEFAULT_RULE_ID,
    downloadId: pending.downloadId,
    filename: pending.filename,
    action: "sleep",
    createdAt: pending.scheduledAt,
    ok: status === "executed" || status === "executing" || status === "cancelled",
    message,
    executed,
    executionMode: "real",
    status,
    errorCode,
  };
}
