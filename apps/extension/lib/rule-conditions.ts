import type { DownloadCompletedEvent } from "./download-event";

export const MAX_FILENAME_PATTERN_LENGTH = 128;
export const MAX_EXTENSION_ENTRIES = 20;
export const MAX_SOURCE_HOST_ENTRIES = 20;
export const MAX_SIZE_BYTES = 1024 ** 5;

export interface RuleConditions {
  filenamePattern: string | null;
  extensions: string[];
  sourceHosts: string[];
  minSizeBytes: number | null;
  maxSizeBytes: number | null;
}

export type MatchFailureReason =
  | "filename"
  | "extension"
  | "sourceHost"
  | "minSize"
  | "maxSize";

export type MatchResult =
  | { matched: true }
  | { matched: false; reason: MatchFailureReason };

export function matchesDownload(event: DownloadCompletedEvent, conditions: RuleConditions): MatchResult {
  if (conditions.filenamePattern) {
    if (!wildcardMatch(event.filename, conditions.filenamePattern)) {
      return { matched: false, reason: "filename" };
    }
  }
  if (conditions.extensions.length > 0) {
    if (!matchesExtensionList(event.filename, conditions.extensions)) {
      return { matched: false, reason: "extension" };
    }
  }
  if (conditions.sourceHosts.length > 0) {
    if (!matchesSourceHostList(event.sourceHost, conditions.sourceHosts)) {
      return { matched: false, reason: "sourceHost" };
    }
  }
  if (conditions.minSizeBytes !== null) {
    if (event.sizeBytes === null || event.sizeBytes < conditions.minSizeBytes) {
      return { matched: false, reason: "minSize" };
    }
  }
  if (conditions.maxSizeBytes !== null) {
    if (event.sizeBytes === null || event.sizeBytes > conditions.maxSizeBytes) {
      return { matched: false, reason: "maxSize" };
    }
  }
  return { matched: true };
}

export function wildcardMatch(filename: string, pattern: string): boolean {
  const normalizedName = filename.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  return wildcardMatchCore(normalizedName, normalizedPattern);
}

function wildcardMatchCore(text: string, pattern: string): boolean {
  if (pattern.length > MAX_FILENAME_PATTERN_LENGTH) {
    return false;
  }
  const textLen = text.length;
  const patternLen = pattern.length;
  const memo = new Map<string, boolean>();

  function dp(textIndex: number, patternIndex: number): boolean {
    const key = `${textIndex}:${patternIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    let result: boolean;
    if (patternIndex === patternLen) {
      result = textIndex === textLen;
    } else if (pattern[patternIndex] === "*") {
      result = false;
      for (let skip = 0; skip <= textLen - textIndex; skip += 1) {
        if (dp(textIndex + skip, patternIndex + 1)) {
          result = true;
          break;
        }
      }
    } else if (pattern[patternIndex] === "?") {
      result = textIndex < textLen && dp(textIndex + 1, patternIndex + 1);
    } else {
      result =
        textIndex < textLen &&
        text[textIndex] === pattern[patternIndex] &&
        dp(textIndex + 1, patternIndex + 1);
    }
    memo.set(key, result);
    return result;
  }

  return dp(0, 0);
}

export function matchesExtensionList(filename: string, extensions: readonly string[]): boolean {
  const lower = filename.toLowerCase();
  for (const extension of extensions) {
    const token = normalizeExtensionToken(extension);
    if (!token) {
      continue;
    }
    const suffix = `.${token}`;
    if (lower === token || lower.endsWith(suffix)) {
      return true;
    }
  }
  return false;
}

export function normalizeExtensionToken(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/^\.+/, "");
  if (!trimmed || trimmed.length > 32) {
    return null;
  }
  if (!/^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function parseExtensionList(input: string): { extensions: string[]; error: string | null } {
  const parts = input
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const extensions: string[] = [];
  for (const part of parts) {
    const token = normalizeExtensionToken(part);
    if (!token) {
      return { extensions: [], error: `Invalid file type: ${part}` };
    }
    if (!extensions.includes(token)) {
      extensions.push(token);
    }
  }
  if (extensions.length > MAX_EXTENSION_ENTRIES) {
    return { extensions: [], error: `At most ${MAX_EXTENSION_ENTRIES} file types are allowed.` };
  }
  return { extensions, error: null };
}

export function normalizeSourceHostPattern(input: string): string | null {
  let value = input.trim().toLowerCase();
  while (value.endsWith(".")) {
    value = value.slice(0, -1);
  }
  if (!value) {
    return null;
  }
  if (value.includes("/") || value.includes(":") || value.includes(" ")) {
    return null;
  }
  const wildcard = value.startsWith("*.");
  const host = wildcard ? value.slice(2) : value;
  if (!host || host.startsWith(".") || host.endsWith(".")) {
    return null;
  }
  if (!/^[a-z0-9.-]+$/.test(host)) {
    return null;
  }
  const labels = host.split(".");
  if (labels.some((label) => !label || label.length > 63)) {
    return null;
  }
  return wildcard ? `*.${host}` : host;
}

export function matchesSourceHost(hostname: string | null, pattern: string): boolean {
  if (!hostname) {
    return false;
  }
  const normalizedHost = hostname.toLowerCase();
  const normalizedPattern = normalizeSourceHostPattern(pattern);
  if (!normalizedPattern) {
    return false;
  }
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(1);
    return normalizedHost.endsWith(suffix) && normalizedHost !== normalizedPattern.slice(2);
  }
  return normalizedHost === normalizedPattern;
}

export function matchesSourceHostList(hostname: string | null, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (matchesSourceHost(hostname, pattern)) {
      return true;
    }
  }
  return false;
}

export function parseSourceHostList(input: string): { hosts: string[]; error: string | null } {
  const parts = input
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const hosts: string[] = [];
  for (const part of parts) {
    const normalized = normalizeSourceHostPattern(part);
    if (!normalized) {
      return { hosts: [], error: `Invalid source domain: ${part}` };
    }
    if (!hosts.includes(normalized)) {
      hosts.push(normalized);
    }
  }
  if (hosts.length > MAX_SOURCE_HOST_ENTRIES) {
    return { hosts: [], error: `At most ${MAX_SOURCE_HOST_ENTRIES} source domains are allowed.` };
  }
  return { hosts, error: null };
}

export function parseFilenamePattern(input: string): { pattern: string | null; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { pattern: null, error: null };
  }
  if (trimmed.length > MAX_FILENAME_PATTERN_LENGTH) {
    return { pattern: null, error: `Filename pattern must be at most ${MAX_FILENAME_PATTERN_LENGTH} characters.` };
  }
  if (Array.from(trimmed).some((character) => character.charCodeAt(0) < 32)) {
    return { pattern: null, error: "Filename pattern contains invalid characters." };
  }
  return { pattern: trimmed, error: null };
}

export function parseSizeMegabytes(input: string): { bytes: number | null; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { bytes: null, error: null };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return { bytes: null, error: "Size must be a non-negative number." };
  }
  const bytes = value * 1024 * 1024;
  if (!Number.isFinite(bytes) || bytes > MAX_SIZE_BYTES) {
    return { bytes: null, error: "Size is too large." };
  }
  return { bytes: Math.round(bytes), error: null };
}

export function countActiveConditions(conditions: RuleConditions, waitForAllDownloads: boolean): number {
  let count = 0;
  if (conditions.filenamePattern) {
    count += 1;
  }
  if (conditions.extensions.length > 0) {
    count += 1;
  }
  if (conditions.sourceHosts.length > 0) {
    count += 1;
  }
  if (conditions.minSizeBytes !== null || conditions.maxSizeBytes !== null) {
    count += 1;
  }
  if (waitForAllDownloads) {
    count += 1;
  }
  return count;
}
