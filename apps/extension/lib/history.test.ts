import { describe, expect, test } from "vitest";
import { prependBounded } from "./history";

describe("bounded history", () => {
  test("keeps the newest records up to the limit", () => {
    const first = prependBounded([], "a", 2);
    const second = prependBounded(first, "b", 2);
    const third = prependBounded(second, "c", 2);
    expect(third).toEqual(["c", "b"]);
  });
});
