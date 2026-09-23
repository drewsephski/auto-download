import { describe, expect, test } from "vitest";
import { actionIdFromNotification, notificationIdForAction } from "./notifications";
import {
  applyTerminalStatus,
  createPendingAction,
  interruptStalePending,
  shouldCoalesce,
  type PendingAction,
} from "./pending";

describe("pending sleep", () => {
  test("maps a notification id to the pending action", () => {
    const actionId = "11111111-1111-4111-8111-111111111111";
    const notificationId = notificationIdForAction(actionId);
    expect(actionIdFromNotification(notificationId)).toBe(actionId);
    expect(actionIdFromNotification("other")).toBeNull();
  });

  test("interrupts a stale pending action instead of replaying it", () => {
    const pending = samplePending();
    const next = interruptStalePending(pending, false);
    expect(next.changed).toBe(true);
    expect(next.pending?.status).toBe("connection_lost");
    expect(interruptStalePending(pending, true)).toEqual({ pending, changed: false });
  });

  test("coalesces only while a live session already has sleep pending", () => {
    const pending = samplePending();
    expect(shouldCoalesce(pending, true)).toBe(true);
    expect(shouldCoalesce(pending, false)).toBe(false);
    expect(shouldCoalesce(applyTerminalStatus(pending, "cancelled"), true)).toBe(false);
    expect(shouldCoalesce(null, true)).toBe(false);
  });

  test("does not move a terminal action back to scheduled", () => {
    const cancelled = applyTerminalStatus(samplePending(), "cancelled");
    expect(applyTerminalStatus(cancelled, "executing").status).toBe("cancelled");
  });
});

function samplePending(): PendingAction {
  return createPendingAction({
    actionId: "act-1",
    requestId: "req-1",
    downloadId: 4,
    filename: "example.zip",
    scheduledAt: 1_000,
    countdownSeconds: 30,
  });
}
