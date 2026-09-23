import { describe, expect, test } from "vitest";
import { executeActionRequest, nativeRequestSchema, parseHostResponse, scheduleActionRequest } from "./protocol";

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
      protocolVersion: 2,
      type: "execute_action",
      executionMode: "dry_run",
      action: "sleep",
    });
  });

  test("builds a real sleep schedule and cannot express real shutdown", () => {
    expect(
      scheduleActionRequest({
        requestId: "req-1",
        actionId: "act-1",
        downloadId: 12,
        filename: "example.zip",
      }),
    ).toMatchObject({
      type: "schedule_action",
      action: "sleep",
      executionMode: "real",
      countdownSeconds: 30,
    });
    expect(
      nativeRequestSchema.safeParse({
        protocolVersion: 2,
        requestId: "req-1",
        type: "schedule_action",
        actionId: "act-1",
        action: "shutdown",
        executionMode: "real",
        countdownSeconds: 30,
        context: { downloadId: 1, filename: "example.zip" },
      }).success,
    ).toBe(false);
  });

  test("rejects a command smuggled beside an action", () => {
    const parsed = nativeRequestSchema.safeParse({
      protocolVersion: 2,
      requestId: "req-1",
      type: "execute_action",
      action: "sleep",
      executionMode: "dry_run",
      command: "shutdown -h now",
      context: { downloadId: 1, filename: "example.zip" },
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects a one-shot real execution", () => {
    const parsed = nativeRequestSchema.safeParse({
      protocolVersion: 2,
      requestId: "req-1",
      type: "execute_action",
      action: "reboot",
      executionMode: "real",
      context: { downloadId: 1, filename: "example.zip" },
    });
    expect(parsed.success).toBe(false);
  });

  test("accepts the dry-run success shape and rejects a claimed execution", () => {
    const success = parseHostResponse("req-1", "execute_action", {
      protocolVersion: 2,
      requestId: "req-1",
      ok: true,
      result: {
        executed: false,
        executionMode: "dry_run",
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
      protocolVersion: 2,
      requestId: "req-1",
      ok: true,
      result: {
        executed: true,
        executionMode: "dry_run",
        action: "sleep",
        message: "Would put this computer to sleep",
      },
    });
    expect(claimed.ok).toBe(false);
  });

  test("tells the user to update a version 1 helper", () => {
    const parsed = parseHostResponse("req-1", "ping", {
      protocolVersion: 1,
      requestId: "req-1",
      ok: false,
      error: { code: "unsupported_protocol_version", message: "This host only accepts protocol version 1." },
    });
    expect(parsed).toEqual({
      ok: false,
      code: "unsupported_protocol_version",
      message: "The helper must be updated before Download Automations can run.",
    });
  });

  test("maps a real-action refusal to a safe message", () => {
    const parsed = parseHostResponse("req-1", "schedule_action", {
      protocolVersion: 2,
      requestId: "req-1",
      ok: false,
      error: { code: "real_action_not_enabled", message: "stack trace /Users/secret" },
    });
    expect(parsed).toEqual({
      ok: false,
      code: "real_action_not_enabled",
      message: "The helper refused real execution for that action.",
    });
  });
});
