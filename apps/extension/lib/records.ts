import { z } from "zod";
import { HISTORY_LIMIT } from "./constants";
import type { DownloadCompletedEvent } from "./download-event";
import { prependBounded } from "./history";
import { executionModeSchema, powerActionSchema } from "./settings";

export const executionStatusSchema = z.enum([
  "simulated",
  "scheduled",
  "cancelled",
  "executing",
  "executed",
  "failed",
  "connection_lost",
  "coalesced",
]);

export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const downloadRecordSchema = z.strictObject({
  downloadId: z.number().int().nonnegative(),
  filename: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  mime: z.string().nullable(),
  completedAt: z.number().int().nonnegative(),
});

export const executionRecordSchema = z.strictObject({
  id: z.string().min(1),
  requestId: z.string().min(1),
  ruleId: z.string().min(1),
  downloadId: z.number().int().nonnegative(),
  filename: z.string().min(1).max(255),
  action: powerActionSchema,
  createdAt: z.number().int().nonnegative(),
  ok: z.boolean(),
  message: z.string().min(1).max(300),
  executed: z.boolean(),
  executionMode: executionModeSchema,
  status: executionStatusSchema,
  errorCode: z.string().min(1).max(64).optional(),
});

const legacyExecutionRecordSchema = z
  .strictObject({
    id: z.string().min(1),
    requestId: z.string().min(1),
    ruleId: z.string().min(1),
    downloadId: z.number().int().nonnegative(),
    filename: z.string().min(1).max(255),
    action: powerActionSchema,
    createdAt: z.number().int().nonnegative(),
    ok: z.boolean(),
    message: z.string().min(1).max(300),
    executed: z.literal(false),
    dryRun: z.literal(true),
    errorCode: z.string().min(1).max(64).optional(),
  })
  .transform((record): ExecutionRecord => ({
    id: record.id,
    requestId: record.requestId,
    ruleId: record.ruleId,
    downloadId: record.downloadId,
    filename: record.filename,
    action: record.action,
    createdAt: record.createdAt,
    ok: record.ok,
    message: record.message,
    executed: false,
    executionMode: "dry_run",
    status: "simulated",
    errorCode: record.errorCode,
  }));

export type ExecutionRecord = z.infer<typeof executionRecordSchema>;

export function normalizeDownloadHistory(input: unknown): DownloadCompletedEvent[] {
  return normalizeRecords(input, downloadRecordSchema);
}

export function normalizeExecutionHistory(input: unknown): ExecutionRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const records: ExecutionRecord[] = [];
  for (const item of input) {
    const current = executionRecordSchema.safeParse(item);
    if (current.success) {
      records.push(current.data);
    } else {
      const legacy = legacyExecutionRecordSchema.safeParse(item);
      if (legacy.success) {
        records.push(legacy.data);
      }
    }
    if (records.length >= HISTORY_LIMIT) {
      break;
    }
  }
  return records;
}

export function upsertExecution(history: readonly ExecutionRecord[], record: ExecutionRecord, limit = HISTORY_LIMIT): ExecutionRecord[] {
  const rest = history.filter((item) => item.id !== record.id);
  return prependBounded(rest, record, limit);
}

function normalizeRecords<T>(input: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const records: T[] = [];
  for (const item of input) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      records.push(parsed.data);
    }
    if (records.length >= HISTORY_LIMIT) {
      break;
    }
  }
  return records;
}
