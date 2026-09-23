import { z } from "zod";

export interface DownloadItemSnapshot {
  id: number;
  state: string;
  filename: string;
  fileSize: number;
  mime: string;
  url?: string;
  finalUrl?: string;
  endTime?: string;
}

export interface DownloadCompletedEvent {
  downloadId: number;
  filename: string;
  extension: string | null;
  mime: string | null;
  sizeBytes: number | null;
  sourceHost: string | null;
  completedAt: number;
}

export const downloadCompletedEventSchema = z.strictObject({
  downloadId: z.number().int().nonnegative(),
  filename: z.string().min(1).max(255),
  extension: z.string().nullable(),
  mime: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sourceHost: z.string().nullable(),
  completedAt: z.number().int().nonnegative(),
});

export function downloadChangeOutcome(state: string | undefined): "complete" | "interrupted" | "pending" {
  if (state === "complete") {
    return "complete";
  }
  if (state === "interrupted") {
    return "interrupted";
  }
  return "pending";
}

export function toCompletedEvent(item: DownloadItemSnapshot, now: number): DownloadCompletedEvent | null {
  if (downloadChangeOutcome(item.state) !== "complete") {
    return null;
  }
  if (!Number.isInteger(item.id) || item.id < 0) {
    return null;
  }
  const parsedEnd = item.endTime ? Date.parse(item.endTime) : Number.NaN;
  const filename = sanitizeFilename(item.filename);
  return {
    downloadId: item.id,
    filename,
    extension: extractExtension(filename),
    mime: item.mime.trim().length > 0 ? item.mime : null,
    sizeBytes: normalizeSizeBytes(item.fileSize),
    sourceHost: extractSourceHost(item.finalUrl ?? item.url),
    completedAt: Number.isFinite(parsedEnd) ? parsedEnd : now,
  };
}

export function normalizeLegacyDownloadEvent(input: {
  downloadId: number;
  filename: string;
  fileSize?: number;
  mime: string | null;
  completedAt: number;
}): DownloadCompletedEvent {
  const filename = sanitizeFilename(input.filename);
  const legacySize = input.fileSize;
  const sizeBytes =
    legacySize !== undefined && Number.isFinite(legacySize) && legacySize > 0 ? Math.round(legacySize) : null;
  return {
    downloadId: input.downloadId,
    filename,
    extension: extractExtension(filename),
    mime: input.mime,
    sizeBytes,
    sourceHost: null,
    completedAt: input.completedAt,
  };
}

export function sanitizeFilename(filename: string): string {
  const normalized = filename.replaceAll("\\", "/");
  const base = normalized.split("/").pop()?.trim() ?? "";
  const withoutControls = Array.from(base)
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("");
  if (!withoutControls || withoutControls === "." || withoutControls === "..") {
    return "download";
  }
  return withoutControls.slice(0, 255);
}

export function extractExtension(filename: string): string | null {
  const lower = filename.toLowerCase();
  const lastDot = lower.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === lower.length - 1) {
    return null;
  }
  const extension = lower.slice(lastDot + 1);
  if (!extension || extension.length > 32) {
    return null;
  }
  return extension;
}

export function extractSourceHost(url: string | undefined): string | null {
  if (!url || url.trim().length === 0) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.trim().toLowerCase();
    return hostname.length > 0 ? hostname : null;
  } catch {
    return null;
  }
}

function normalizeSizeBytes(fileSize: number): number | null {
  if (!Number.isFinite(fileSize) || fileSize < 0 || fileSize === -1) {
    return null;
  }
  if (fileSize === 0) {
    return 0;
  }
  return Math.round(fileSize);
}
