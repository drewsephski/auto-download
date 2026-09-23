import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { DRY_RUN_MESSAGES, EXTENSION_PERMISSIONS, NATIVE_HOST_NAME } from "./constants";

describe("shared constants", () => {
  test("requests only the permissions this slice uses", () => {
    expect([...EXTENSION_PERMISSIONS].sort()).toEqual(["downloads", "nativeMessaging", "storage"]);
  });

  test("host name matches the rust constant", () => {
    const rustLib = fileURLToPath(new URL("../../../crates/native-host/src/lib.rs", import.meta.url));
    const source = readFileSync(rustLib, "utf8");
    expect(source).toContain(`pub const HOST_NAME: &str = "${NATIVE_HOST_NAME}"`);
    for (const message of Object.values(DRY_RUN_MESSAGES)) {
      expect(source.includes(message) || readFileSync(fileURLToPath(new URL("../../../crates/native-host/src/os_adapter.rs", import.meta.url)), "utf8").includes(message)).toBe(true);
    }
  });
});
