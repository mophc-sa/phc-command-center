import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, formatRate, rate, riyadhDay } from "./daily-tasks";

describe("daily tasks helpers", () => {
  it("uses the Riyadh calendar day", () => {
    expect(riyadhDay(new Date("2026-10-05T21:30:00Z"))).toBe("2026-10-06"); // 00:30 in Riyadh
    expect(riyadhDay(new Date("2026-10-06T20:59:00Z"))).toBe("2026-10-06");
  });
  it("steps days across month ends", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });
  it("no items is no rate, not zero", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(6, 2)).toBe(75);
    expect(rate(1, 2)).toBe(33);
    expect(formatRate(null, "en")).toBe("—");
    expect(formatRate(75, "en")).toBe("75%");
  });
});

describe("the wall never shows task titles", () => {
  it("board reads counts only", () => {
    const board = readFileSync(join(import.meta.dir, "..", "routes", "_authenticated", "board.tsx"), "utf8");
    expect(board).not.toMatch(/from\("tasks"\)/);
    expect(board).not.toContain("myDay(");
    expect(board).toContain("teamDay(");
  });
});
