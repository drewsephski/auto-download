import { describe, expect, test } from "vitest";
import { downloadChangeOutcome, extractExtension, extractSourceHost, sanitizeFilename, toCompletedEvent } from "./download-event";

describe("download events", () => {
  test("recognizes completion and interruption", () => {
    expect(downloadChangeOutcome("complete")).toBe("complete");
    expect(downloadChangeOutcome("interrupted")).toBe("interrupted");
    expect(downloadChangeOutcome("in_progress")).toBe("pending");
  });

  test("normalizes a completed download and ignores other states", () => {
    expect(
      toCompletedEvent(
        {
          id: 9,
          state: "complete",
          filename: "/Users/example/Downloads/report.zip",
          fileSize: 2048,
          mime: "application/zip",
          endTime: "2026-09-23T15:00:00.000Z",
        },
        1,
      ),
    ).toEqual({
      downloadId: 9,
      filename: "report.zip",
      extension: "zip",
      mime: "application/zip",
      sizeBytes: 2048,
      sourceHost: null,
      completedAt: Date.parse("2026-09-23T15:00:00.000Z"),
    });
    expect(
      toCompletedEvent(
        { id: 9, state: "interrupted", filename: "report.zip", fileSize: 10, mime: "" },
        1,
      ),
    ).toBeNull();
  });

  test("uses only the file name", () => {
    expect(sanitizeFilename("C:\\Users\\example\\file.txt")).toBe("file.txt");
    expect(sanitizeFilename("..")).toBe("download");
  });

  test("derives extension, host, and unknown size safely", () => {
    expect(extractExtension("photo.JPG")).toBe("jpg");
    expect(extractExtension("archive.tar.gz")).toBe("gz");
    expect(extractExtension("README")).toBeNull();
    expect(extractSourceHost("https://releases.example.com/a.zip?token=secret")).toBe("releases.example.com");
    expect(
      toCompletedEvent(
        {
          id: 1,
          state: "complete",
          filename: "big.bin",
          fileSize: -1,
          mime: "",
          finalUrl: "https://cdn.example.com/big.bin",
        },
        5,
      ),
    ).toMatchObject({ sizeBytes: null, sourceHost: "cdn.example.com" });
  });
});
