export type NativeFailureStatus = "not_installed" | "error";

export interface NativeFailure {
  status: NativeFailureStatus;
  message: string;
}

export function describeNativeFailure(error: unknown): NativeFailure {
  const text = errorText(error).toLowerCase();
  if (text.includes("specified native messaging host not found") || text.includes("not found")) {
    return {
      status: "not_installed",
      message: "The Download Automations helper is not installed on this Mac.",
    };
  }
  if (text.includes("forbidden")) {
    return {
      status: "error",
      message: "Chrome blocked the helper because this extension is not on its allow list. Reinstall the helper with this extension's ID.",
    };
  }
  if (text.includes("failed to start") || text.includes("has exited") || text.includes("exited")) {
    return {
      status: "error",
      message: "The helper is registered, but it did not start. Reinstall it, then try the connection test again.",
    };
  }
  return {
    status: "error",
    message: "Could not reach the helper. Check that it is installed, then try again.",
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}
