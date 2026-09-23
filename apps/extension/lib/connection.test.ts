import { describe, expect, test } from "vitest";
import { checkConnection } from "./connection";
import type { NativeRequest } from "./protocol";

describe("connection check", () => {
  test("reports connected only when capabilities stay dry-run", async () => {
    const status = await checkConnection(async (request) => responseFor(request), () => "req-1");
    expect(status.state).toBe("connected");
  });

  test("reports a missing host without treating it as a generic error", async () => {
    const status = await checkConnection(async () => {
      throw new Error("Specified native messaging host not found.");
    }, () => "req-1");
    expect(status.state).toBe("not_installed");
  });
});

function responseFor(request: NativeRequest) {
  if (request.type === "ping") {
    return {
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: { pong: true },
    };
  }
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    result: {
      dryRunOnly: true,
      actions: ["sleep", "shutdown", "reboot"],
    },
  };
}
