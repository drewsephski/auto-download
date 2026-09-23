import { z } from "zod";
import { filenameSchema } from "./protocol";
import { powerActionSchema, type PowerAction } from "./settings";

export const pendingStatusSchema = z.enum([
  "scheduled",
  "cancelled",
  "executing",
  "executed",
  "failed",
  "connection_lost",
]);

export type PendingStatus = z.infer<typeof pendingStatusSchema>;

export const pendingActionSchema = z.strictObject({
  actionId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  action: powerActionSchema,
  downloadId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  filename: filenameSchema,
  scheduledAt: z.number().int().nonnegative(),
  executeAt: z.number().int().nonnegative(),
  status: pendingStatusSchema,
});

export type PendingAction = z.infer<typeof pendingActionSchema>;

const TERMINAL_STATUSES: ReadonlySet<PendingStatus> = new Set([
  "cancelled",
  "executed",
  "failed",
  "connection_lost",
]);

export function normalizePending(input: unknown): PendingAction | null {
  const parsed = pendingActionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function isActivePending(pending: PendingAction | null): pending is PendingAction {
  return pending?.status === "scheduled" || pending?.status === "executing";
}

export function shouldCoalesce(pending: PendingAction | null, hasLiveSession: boolean): boolean {
  return hasLiveSession && isActivePending(pending);
}

export function interruptStalePending(
  pending: PendingAction | null,
  hasLiveSession: boolean,
): { pending: PendingAction | null; changed: boolean } {
  if (!pending || hasLiveSession || !isActivePending(pending)) {
    return { pending, changed: false };
  }
  return {
    pending: { ...pending, status: "connection_lost" },
    changed: true,
  };
}

export function applyTerminalStatus(pending: PendingAction, status: PendingStatus): PendingAction {
  if (TERMINAL_STATUSES.has(pending.status)) {
    return pending;
  }
  return { ...pending, status };
}

export function createPendingAction(input: {
  actionId: string;
  requestId: string;
  action: PowerAction;
  downloadId: number;
  filename: string;
  scheduledAt: number;
  countdownSeconds: number;
}): PendingAction {
  return pendingActionSchema.parse({
    actionId: input.actionId,
    requestId: input.requestId,
    action: input.action,
    downloadId: input.downloadId,
    filename: input.filename,
    scheduledAt: input.scheduledAt,
    executeAt: input.scheduledAt + input.countdownSeconds * 1000,
    status: "scheduled",
  });
}
