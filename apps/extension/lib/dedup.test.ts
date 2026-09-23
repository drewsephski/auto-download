import { describe, expect, test } from "vitest";
import { claimDownload } from "./dedup";

describe("completion deduplication", () => {
  test("claims an id once and keeps a bounded window", () => {
    const first = claimDownload([], 7, 2);
    expect(first).toEqual({ claimed: true, nextIds: [7] });
    const second = claimDownload(first.nextIds, 7, 2);
    expect(second.claimed).toBe(false);
    const third = claimDownload(second.nextIds, 8, 2);
    const fourth = claimDownload(third.nextIds, 9, 2);
    expect(fourth.nextIds).toEqual([9, 8]);
    expect(claimDownload(fourth.nextIds, 7, 2).claimed).toBe(true);
  });
});
