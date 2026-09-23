export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
  };
}

export interface LiveHostSessionOptions {
  connect: () => NativePort;
  timeoutMs?: number;
  onDisconnect?: () => void;
  onEvent?: (payload: unknown) => void;
}

interface Waiter {
  accept: (payload: unknown) => boolean;
  resume: (payload: unknown) => void;
}

const CONNECTION_LOST = { connectionLost: true };

export class LiveHostSession {
  private port: NativePort | null = null;
  private epoch = 0;
  private waiters = new Map<string, Waiter>();

  constructor(private readonly options: LiveHostSessionOptions) {}

  connected(): boolean {
    return this.port !== null;
  }

  post(request: { requestId: string }, accept: (payload: unknown) => boolean): Promise<unknown> {
    const port = this.ensurePort();
    const epoch = this.epoch;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiters.has(request.requestId)) {
          this.discard("local");
        }
      }, this.options.timeoutMs ?? 5_000);

      this.waiters.set(request.requestId, {
        accept,
        resume: (payload) => {
          clearTimeout(timer);
          if (epoch !== this.epoch || isConnectionLost(payload)) {
            reject(new Error("The helper connection closed."));
            return;
          }
          resolve(payload);
        },
      });

      try {
        port.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.waiters.delete(request.requestId);
        this.discard("local");
        reject(error instanceof Error ? error : new Error("The helper connection closed."));
      }
    });
  }

  close(): void {
    this.discard("local");
  }

  private ensurePort(): NativePort {
    if (this.port) {
      return this.port;
    }
    const port = this.options.connect();
    port.onMessage.addListener((payload) => {
      this.handleMessage(payload);
    });
    port.onDisconnect.addListener(() => {
      this.discard("remote");
    });
    this.port = port;
    return port;
  }

  private handleMessage(payload: unknown): void {
    const requestId = readRequestId(payload);
    const waiter = requestId ? this.waiters.get(requestId) : undefined;
    if (waiter && waiter.accept(payload)) {
      this.waiters.delete(requestId);
      waiter.resume(payload);
      return;
    }
    this.options.onEvent?.(payload);
  }

  private discard(reason: "local" | "remote"): void {
    if (this.port === null && this.waiters.size === 0) {
      return;
    }
    const port = this.port;
    this.port = null;
    this.epoch += 1;
    const waiters = [...this.waiters.values()];
    this.waiters.clear();
    for (const waiter of waiters) {
      waiter.resume(CONNECTION_LOST);
    }
    if (reason === "local" && port) {
      try {
        port.disconnect();
      } catch {
        // The port is already gone. The pending action is still discarded.
      }
    }
    this.options.onDisconnect?.();
  }
}

function readRequestId(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("requestId" in payload)) {
    return "";
  }
  const requestId = payload.requestId;
  return typeof requestId === "string" ? requestId : "";
}

function isConnectionLost(payload: unknown): boolean {
  return payload === CONNECTION_LOST;
}
