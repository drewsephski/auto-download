import { describe, expect, test } from "vitest";
import type { DownloadCompletedEvent } from "./download-event";
import {
  matchesDownload,
  matchesExtensionList,
  matchesSourceHost,
  wildcardMatch,
} from "./rule-conditions";

const baseEvent = (overrides: Partial<DownloadCompletedEvent> = {}): DownloadCompletedEvent => ({
  downloadId: 1,
  filename: "backup-2026.zip",
  extension: "zip",
  mime: null,
  sizeBytes: 1024,
  sourceHost: "downloads.example.com",
  completedAt: 1,
  ...overrides,
});

describe("rule conditions", () => {
  test("matches filename wildcards case-insensitively", () => {
    expect(wildcardMatch("BACKUP.ZIP", "*.zip")).toBe(true);
    expect(wildcardMatch("backup-01.tar.gz", "backup-??.tar.gz")).toBe(true);
    expect(wildcardMatch("backup-001.tar.gz", "backup-??.tar.gz")).toBe(false);
  });

  test("matches extensions including compound suffixes", () => {
    expect(matchesExtensionList("archive.tar.gz", ["tar.gz"])).toBe(true);
    expect(matchesExtensionList("photo.JPG", ["jpg"])).toBe(true);
    expect(matchesExtensionList("readme", ["txt"])).toBe(false);
  });

  test("matches source hosts with wildcard semantics", () => {
    expect(matchesSourceHost("downloads.example.com", "*.example.com")).toBe(true);
    expect(matchesSourceHost("example.com", "*.example.com")).toBe(false);
    expect(matchesSourceHost("example.com", "example.com")).toBe(true);
    expect(matchesSourceHost("badexample.com", "*.example.com")).toBe(false);
  });

  test("uses AND across categories and OR within lists", () => {
    const event = baseEvent();
    expect(
      matchesDownload(event, {
        filenamePattern: "*.zip",
        extensions: ["zip", "dmg"],
        sourceHosts: ["*.example.com"],
        minSizeBytes: 500,
        maxSizeBytes: null,
      }).matched,
    ).toBe(true);
    expect(
      matchesDownload(event, {
        filenamePattern: "*.zip",
        extensions: ["dmg"],
        sourceHosts: [],
        minSizeBytes: null,
        maxSizeBytes: null,
      }),
    ).toEqual({ matched: false, reason: "extension" });
  });

  test("does not match size conditions when size is unknown", () => {
    const event = baseEvent({ sizeBytes: null });
    expect(
      matchesDownload(event, {
        filenamePattern: null,
        extensions: [],
        sourceHosts: [],
        minSizeBytes: 1,
        maxSizeBytes: null,
      }),
    ).toEqual({ matched: false, reason: "minSize" });
  });

  test("handles long wildcard combinations without hanging", () => {
    const pattern = `${"*?".repeat(40)}.zip`;
    const filename = `${"a".repeat(80)}.txt`;
    const started = performance.now();
    expect(wildcardMatch(filename, pattern)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
