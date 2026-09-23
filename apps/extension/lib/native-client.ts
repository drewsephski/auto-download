import { browser } from "wxt/browser";
import { NATIVE_HOST_NAME } from "./constants";
import { oneShotRequestSchema, type OneShotRequest } from "./protocol";
import type { NativePort } from "./live-host-session";

export async function sendNativeRequest(request: OneShotRequest): Promise<unknown> {
  const validated = oneShotRequestSchema.parse(request);
  return browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, validated);
}

export function connectNativeHost(): NativePort {
  return browser.runtime.connectNative(NATIVE_HOST_NAME);
}
