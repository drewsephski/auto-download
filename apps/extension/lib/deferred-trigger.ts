import { z } from "zod";
import type { DownloadCompletedEvent } from "./download-event";
import { downloadCompletedEventSchema } from "./download-event";
import type { Settings } from "./settings";

export const deferredTriggerSchema = z.strictObject({
  version: z.literal(1),
  ruleId: z.string().min(1).max(64),
  ruleRevision: z.number().int().positive(),
  representativeDownload: downloadCompletedEventSchema,
  matchedDownloadCount: z.number().int().positive(),
  deferredAt: z.number().int().nonnegative(),
});

export type DeferredTrigger = z.infer<typeof deferredTriggerSchema>;

export function normalizeDeferredTrigger(input: unknown): DeferredTrigger | null {
  const parsed = deferredTriggerSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function createDeferredTrigger(input: {
  ruleId: string;
  ruleRevision: number;
  representativeDownload: DownloadCompletedEvent;
  matchedDownloadCount: number;
  deferredAt: number;
}): DeferredTrigger {
  return deferredTriggerSchema.parse({
    version: 1,
    ruleId: input.ruleId,
    ruleRevision: input.ruleRevision,
    representativeDownload: input.representativeDownload,
    matchedDownloadCount: input.matchedDownloadCount,
    deferredAt: input.deferredAt,
  });
}

export function mergeDeferredTrigger(
  current: DeferredTrigger | null,
  candidate: {
    ruleId: string;
    ruleRevision: number;
    representativeDownload: DownloadCompletedEvent;
    deferredAt: number;
  },
  settings: Settings,
): DeferredTrigger {
  if (!current) {
    return createDeferredTrigger({
      ruleId: candidate.ruleId,
      ruleRevision: candidate.ruleRevision,
      representativeDownload: candidate.representativeDownload,
      matchedDownloadCount: 1,
      deferredAt: candidate.deferredAt,
    });
  }
  if (current.ruleId === candidate.ruleId) {
    return createDeferredTrigger({
      ruleId: candidate.ruleId,
      ruleRevision: candidate.ruleRevision,
      representativeDownload: candidate.representativeDownload,
      matchedDownloadCount: current.matchedDownloadCount + 1,
      deferredAt: current.deferredAt,
    });
  }
  const currentIndex = settings.rules.findIndex((rule) => rule.id === current.ruleId);
  const candidateIndex = settings.rules.findIndex((rule) => rule.id === candidate.ruleId);
  if (candidateIndex >= 0 && (currentIndex < 0 || candidateIndex < currentIndex)) {
    return createDeferredTrigger({
      ruleId: candidate.ruleId,
      ruleRevision: candidate.ruleRevision,
      representativeDownload: candidate.representativeDownload,
      matchedDownloadCount: 1,
      deferredAt: candidate.deferredAt,
    });
  }
  return current;
}

export function deferredFromPendingMetadata(input: {
  ruleId: string;
  ruleRevision: number;
  downloadId: number;
  filename: string;
  deferredAt: number;
}): DeferredTrigger {
  return createDeferredTrigger({
    ruleId: input.ruleId,
    ruleRevision: input.ruleRevision,
    representativeDownload: {
      downloadId: input.downloadId,
      filename: input.filename,
      extension: null,
      mime: null,
      sizeBytes: null,
      sourceHost: null,
      completedAt: input.deferredAt,
    },
    matchedDownloadCount: 1,
    deferredAt: input.deferredAt,
  });
}
