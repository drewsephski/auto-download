import { describe, expect, test } from "vitest";
import { LiveHostSession, type NativePort } from "./live-host-session";

describe("live host session", () => {
  test("keeps one port open for schedule and cancel", async () => {
    const ports: FakePort[] = [];
    const session = new LiveHostSession({
      connect: () => {
        const port = createFakePort();
        ports.push(port);
        return port;
      },
    });

    const schedule = session.post({ requestId: "req-1" }, (payload) => readStatus(payload) === "scheduled");
    ports[0]?.emit({ requestId: "req-1", ok: true, result: { status: "scheduled" } });
    await expect(schedule).resolves.toMatchObject({ requestId: "req-1" });

    const cancel = session.post({ requestId: "req-2" }, (payload) => readStatus(payload) === "cancelled");
    expect(ports).toHaveLength(1);
    ports[0]?.emit({ requestId: "req-2", ok: true, result: { status: "cancelled" } });
    await expect(cancel).resolves.toMatchObject({ requestId: "req-2" });
    expect(ports[0]?.posted).toHaveLength(2);
  });

  test("rejects an in-flight request when the port disconnects", async () => {
    const ports: FakePort[] = [];
    let disconnected = 0;
    const session = new LiveHostSession({
      connect: () => {
        const created = createFakePort();
        ports.push(created);
        return created;
      },
      onDisconnect: () => {
        disconnected += 1;
      },
    });

    const pending = session.post({ requestId: "req-1" }, () => true);
    ports[0]?.disconnect();
    await expect(pending).rejects.toThrow(/connection closed/i);
    expect(disconnected).toBe(1);
    expect(session.connected()).toBe(false);
  });

  test("opens a new port after the previous connection closed", async () => {
    const ports: FakePort[] = [];
    const session = new LiveHostSession({
      connect: () => {
        const port = createFakePort();
        ports.push(port);
        return port;
      },
    });
    const first = session.post({ requestId: "req-1" }, () => true);
    ports[0]?.disconnect();
    await expect(first).rejects.toThrow(/connection closed/i);

    const second = session.post({ requestId: "req-2" }, (payload) => readStatus(payload) === "scheduled");
    expect(ports).toHaveLength(2);
    ports[1]?.emit({ requestId: "req-2", result: { status: "scheduled" } });
    await expect(second).resolves.toMatchObject({ requestId: "req-2" });
  });
});

interface FakePort extends NativePort {
  posted: unknown[];
  emit(message: unknown): void;
  disconnect(): void;
}

function createFakePort(): FakePort {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const port: FakePort = {
    posted: [],
    postMessage(message) {
      port.posted.push(message);
    },
    disconnect() {
      for (const listener of disconnectListeners) {
        listener();
      }
    },
    onMessage: {
      addListener(listener) {
        messageListeners.push(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.push(listener);
      },
    },
    emit(message) {
      for (const listener of messageListeners) {
        listener(message);
      }
    },
  };
  return port;
}

function readStatus(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("result" in payload)) {
    return "";
  }
  const result = payload.result;
  if (typeof result !== "object" || result === null || !("status" in result)) {
    return "";
  }
  return typeof result.status === "string" ? result.status : "";
}
