import { describe, expect, test } from "vitest";
import { checkConnection } from "./connection";
import type { OneShotRequest } from "./protocol";

describe("connection check", () => {
  test("reports connected when the helper speaks protocol 2", async () => {
    const status = await checkConnection(async (request) => responseFor(request), () => "req-1");
    expect(status.state).toBe("connected");
    expect(status.realSleepSupported).toBe(true);
  });

  test("reports a missing host without treating it as a generic error", async () => {
    const status = await checkConnection(async () => {
      throw new Error("Specified native messaging host not found.");
    }, () => "req-1");
    expect(status.state).toBe("not_installed");
    expect(status.realSleepSupported).toBe(false);
  });

  test("asks for a helper update when the installed host is still version 1", async () => {
    const status = await checkConnection(async (request) => {
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        ok: false,
        error: { code: "unsupported_protocol_version", message: "old host" },
      };
    }, () => "req-1");
    expect(status.state).toBe("error");
    expect(status.message).toContain("updated");
  });
});

function responseFor(request: OneShotRequest) {
  if (request.type === "ping") {
    return {
      protocolVersion: 2,
      requestId: request.requestId,
      ok: true,
      result: { pong: true },
    };
  }
  return {
    protocolVersion: 2,
    requestId: request.requestId,
    ok: true,
    result: {
      platform: "macos",
      dryRunActions: ["sleep", "shutdown", "reboot"],
      realActions: ["sleep"],
      countdown: { required: true, minimumSeconds: 10 },
    },
  };
}
