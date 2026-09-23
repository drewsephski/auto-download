import { z } from "zod";
import { HISTORY_LIMIT } from "./constants";
import type { DownloadCompletedEvent } from "./download-event";
import { powerActionSchema } from "./settings";

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
  executed: z.literal(false),
  dryRun: z.literal(true),
  errorCode: z.string().min(1).max(64).optional(),
});

export type ExecutionRecord = z.infer<typeof executionRecordSchema>;

export function normalizeDownloadHistory(input: unknown): DownloadCompletedEvent[] {
  return normalizeRecords(input, downloadRecordSchema);
}

export function normalizeExecutionHistory(input: unknown): ExecutionRecord[] {
  return normalizeRecords(input, executionRecordSchema);
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
