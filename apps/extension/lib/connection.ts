import { capabilitiesRequest, parseHostResponse, pingRequest, type OneShotRequest } from "./protocol";
import { describeNativeFailure } from "./native-status";

export interface ConnectionStatus {
  state: "connected" | "not_installed" | "error";
  title: string;
  message: string;
  realSleepSupported: boolean;
}

export async function checkConnection(
  send: (request: OneShotRequest) => Promise<unknown>,
  createRequestId: () => string,
): Promise<ConnectionStatus> {
  const pingId = createRequestId();
  let pingPayload: unknown;
  try {
    pingPayload = await send(pingRequest(pingId));
  } catch (error) {
    return fromFailure(error);
  }

  const ping = parseHostResponse(pingId, "ping", pingPayload);
  if (!ping.ok) {
    return errorStatus(ping.message);
  }

  const capabilitiesId = createRequestId();
  let capabilitiesPayload: unknown;
  try {
    capabilitiesPayload = await send(capabilitiesRequest(capabilitiesId));
  } catch (error) {
    return fromFailure(error);
  }

  const capabilities = parseHostResponse(capabilitiesId, "get_capabilities", capabilitiesPayload);
  if (!capabilities.ok || capabilities.type !== "get_capabilities") {
    return errorStatus(capabilities.ok ? "The helper returned an unexpected result." : capabilities.message);
  }

  return {
    state: "connected",
    title: "Connected",
    message: capabilities.realSleepSupported
      ? "The helper is connected. Real sleep can be armed after setup."
      : "The helper is connected. Only dry-run actions are available.",
    realSleepSupported: capabilities.realSleepSupported,
  };
}

function fromFailure(error: unknown): ConnectionStatus {
  const failure = describeNativeFailure(error);
  if (failure.status === "not_installed") {
    return {
      state: "not_installed",
      title: "Not installed",
      message: failure.message,
      realSleepSupported: false,
    };
  }
  return errorStatus(failure.message);
}

function errorStatus(message: string): ConnectionStatus {
  return {
    state: "error",
    title: "Error",
    message,
    realSleepSupported: false,
  };
}
