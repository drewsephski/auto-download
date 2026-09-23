import { capabilitiesRequest, parseHostResponse, pingRequest, type NativeRequest } from "./protocol";
import { describeNativeFailure } from "./native-status";

export interface ConnectionStatus {
  state: "connected" | "not_installed" | "error";
  title: string;
  message: string;
}

export async function checkConnection(
  send: (request: NativeRequest) => Promise<unknown>,
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
  if (!capabilities.ok) {
    return errorStatus(capabilities.message);
  }

  return {
    state: "connected",
    title: "Connected",
    message: "The helper answered and will only simulate actions.",
  };
}

function fromFailure(error: unknown): ConnectionStatus {
  const failure = describeNativeFailure(error);
  if (failure.status === "not_installed") {
    return {
      state: "not_installed",
      title: "Not installed",
      message: failure.message,
    };
  }
  return errorStatus(failure.message);
}

function errorStatus(message: string): ConnectionStatus {
  return {
    state: "error",
    title: "Error",
    message,
  };
}
