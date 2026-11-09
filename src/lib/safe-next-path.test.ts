import { describe, expect, it } from "bun:test";
import { safeNextPath } from "@/lib/safe-next-path";

const ORIGIN = "https://agent.phc-sa.com";

describe("safeNextPath", () => {
  it("keeps a same-origin path with its query and hash", () => {
    expect(safeNextPath("/x", ORIGIN)).toBe("/x");
    expect(safeNextPath("/supplier/abc?tab=1#top", ORIGIN)).toBe("/supplier/abc?tab=1#top");
  });

  it.each([
    ["//evil"],
    ["/\\evil"],
    ["/\t/evil"],
    ["/\n/evil"],
    ["/\r/evil"],
    ["https://evil"],
    ["javascript:alert(1)"],
    [""],
  ])("refuses %p", (next) => {
    expect(safeNextPath(next, ORIGIN)).toBeUndefined();
  });

  it("refuses non-strings", () => {
    expect(safeNextPath(undefined, ORIGIN)).toBeUndefined();
    expect(safeNextPath(42, ORIGIN)).toBeUndefined();
    expect(safeNextPath(["/x"], ORIGIN)).toBeUndefined();
  });
});
