import { describe, expect, test } from "vitest";
import { describeNativeFailure } from "./native-status";

describe("native host errors", () => {
  test("classifies a missing host", () => {
    expect(describeNativeFailure(new Error("Specified native messaging host not found."))).toMatchObject({
      status: "not_installed",
    });
  });

  test("classifies a registered host that cannot start", () => {
    expect(describeNativeFailure(new Error("Native host has exited."))).toMatchObject({
      status: "error",
    });
    expect(describeNativeFailure(new Error("Access to the specified native messaging host is forbidden."))).toMatchObject({
      status: "error",
    });
  });
});
