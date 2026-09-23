import { browser } from "wxt/browser";
import { NATIVE_HOST_NAME } from "./constants";
import { nativeRequestSchema, type NativeRequest } from "./protocol";

export async function sendNativeRequest(request: NativeRequest): Promise<unknown> {
  const validated = nativeRequestSchema.parse(request);
  return browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, validated);
}
