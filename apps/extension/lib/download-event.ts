export interface DownloadItemSnapshot {
  id: number;
  state: string;
  filename: string;
  fileSize: number;
  mime: string;
  endTime?: string;
}

export interface DownloadCompletedEvent {
  downloadId: number;
  filename: string;
  fileSize: number;
  mime: string | null;
  completedAt: number;
}

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
  return {
    downloadId: item.id,
    filename: sanitizeFilename(item.filename),
    fileSize: Number.isFinite(item.fileSize) && item.fileSize > 0 ? Math.round(item.fileSize) : 0,
    mime: item.mime.trim().length > 0 ? item.mime : null,
    completedAt: Number.isFinite(parsedEnd) ? parsedEnd : now,
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
