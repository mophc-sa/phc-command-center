// =============================================================================
// A delta pill is the easiest place on a dashboard to publish a lie.
//
// It is small, it is green, and nobody audits it — so a "+0%" on a card whose
// previous value was never recorded reads as "steady" when the truth is "we do
// not know". Every case below is about refusing to produce a number rather
// than producing a comfortable one.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { monthOverMonth, monthWindows } from "@/lib/period-delta";

const NOW = new Date(Date.UTC(2026, 7, 30)); // 2026-08-30
const inAug = (n: number) => Array(n).fill("2026-08-14T09:00:00Z");
const inJul = (n: number) => Array(n).fill("2026-07-14T09:00:00Z");

describe("the windows", () => {
  it("are the current month and the one before, half-open", () => {
    expect(monthWindows(NOW)).toEqual({
      current: { start: "2026-08-01", end: "2026-09-01" },
      previous: { start: "2026-07-01", end: "2026-08-01" },
    });
  });

  it("cross a year boundary without losing a month", () => {
    expect(monthWindows(new Date(Date.UTC(2026, 0, 15))).previous).toEqual({
      start: "2025-12-01",
      end: "2026-01-01",
    });
  });

  it("the boundary belongs to the later window, not both", () => {
    // Half-open [start, end). A record stamped exactly at midnight on the 1st
    // counted twice would inflate both months at once.
    const d = monthOverMonth(["2026-08-01T00:00:00Z"], NOW);
    expect(d).toEqual({ current: 1, previous: 0, ratio: null, direction: "up" });
  });
});

describe("it refuses to invent a comparison", () => {
  it("returns nothing when neither month holds a record", () => {
    // Not zero. A delta between two absences is unanswerable, and "0%" would
    // read as "no change" — a claim nobody is in a position to make.
    expect(monthOverMonth([], NOW)).toBeNull();
    expect(monthOverMonth(["2026-01-05T00:00:00Z"], NOW)).toBeNull();
  });

  it("gives no ratio when the previous month was empty", () => {
    // Going from 0 to 5 is not "+500%", it is a start. The card shows five.
    const d = monthOverMonth(inAug(5), NOW);
    expect(d).toEqual({ current: 5, previous: 0, ratio: null, direction: "up" });
  });

  it("ignores rows with no date at all rather than bucketing them", () => {
    const d = monthOverMonth([...inAug(2), null, undefined, ""], NOW);
    expect(d?.current).toBe(2);
  });
});

describe("when there is something to compare", () => {
  it("computes the change as a fraction of the previous month", () => {
    const d = monthOverMonth([...inAug(13), ...inJul(12)], NOW);
    expect(d?.current).toBe(13);
    expect(d?.previous).toBe(12);
    expect(d?.ratio).toBeCloseTo(1 / 12, 6);
    expect(d?.direction).toBe("up");
  });

  it("reports a fall as a fall", () => {
    const d = monthOverMonth([...inAug(6), ...inJul(12)], NOW);
    expect(d?.ratio).toBeCloseTo(-0.5, 6);
    expect(d?.direction).toBe("down");
  });

  it("equal months are flat, and flat is a real answer", () => {
    // Distinct from "unknown": the pill renders, in neutral, saying nothing
    // moved. That is information.
    const d = monthOverMonth([...inAug(4), ...inJul(4)], NOW);
    expect(d).toEqual({ current: 4, previous: 4, ratio: 0, direction: "flat" });
  });

  it("reads a bare date as readily as a timestamp", () => {
    expect(monthOverMonth(["2026-08-03", "2026-07-03"], NOW)?.direction).toBe("flat");
  });
});

describe("no clock is read inside the module", () => {
  it("the caller owns 'now', so a test can ask about any month", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "./period-delta.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });
});
