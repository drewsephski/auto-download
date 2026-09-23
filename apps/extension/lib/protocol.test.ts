import { describe, expect, test } from "vitest";
import { executeActionRequest, nativeRequestSchema, parseHostResponse } from "./protocol";

describe("protocol validation", () => {
  test("builds a dry-run execute request", () => {
    expect(
      executeActionRequest({
        requestId: "req-1",
        action: "sleep",
        downloadId: 12,
        filename: "example.zip",
      }),
    ).toMatchObject({
      protocolVersion: 1,
      type: "execute_action",
      dryRun: true,
      action: "sleep",
    });
  });

  test("rejects a command smuggled beside an action", () => {
    const parsed = nativeRequestSchema.safeParse({
      protocolVersion: 1,
      requestId: "req-1",
      type: "execute_action",
      action: "sleep",
      dryRun: true,
      command: "shutdown -h now",
      context: { downloadId: 1, filename: "example.zip" },
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects dryRun false", () => {
    const parsed = nativeRequestSchema.safeParse({
      protocolVersion: 1,
      requestId: "req-1",
      type: "execute_action",
      action: "reboot",
      dryRun: false,
      context: { downloadId: 1, filename: "example.zip" },
    });
    expect(parsed.success).toBe(false);
  });

  test("accepts the dry-run success shape and rejects a claimed execution", () => {
    const success = parseHostResponse("req-1", "execute_action", {
      protocolVersion: 1,
      requestId: "req-1",
      ok: true,
      result: {
        executed: false,
        dryRun: true,
        action: "sleep",
        message: "Would put this computer to sleep",
      },
    });
    expect(success).toEqual({
      ok: true,
      type: "execute_action",
      action: "sleep",
      message: "Would put this computer to sleep",
    });

    const claimed = parseHostResponse("req-1", "execute_action", {
      protocolVersion: 1,
      requestId: "req-1",
      ok: true,
      result: {
        executed: true,
        dryRun: true,
        action: "sleep",
        message: "Would put this computer to sleep",
      },
    });
    expect(claimed.ok).toBe(false);
  });

  test("maps a dry-run refusal to a safe message", () => {
    const parsed = parseHostResponse("req-1", "execute_action", {
      protocolVersion: 1,
      requestId: "req-1",
      ok: false,
      error: { code: "dry_run_required", message: "stack trace /Users/secret" },
    });
    expect(parsed).toEqual({
      ok: false,
      code: "dry_run_required",
      message: "The helper refused the request because it was not a dry run.",
    });
  });
});
