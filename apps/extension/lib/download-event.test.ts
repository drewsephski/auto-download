import { describe, expect, test } from "vitest";
import { downloadChangeOutcome, sanitizeFilename, toCompletedEvent } from "./download-event";

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
      fileSize: 2048,
      mime: "application/zip",
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
});
