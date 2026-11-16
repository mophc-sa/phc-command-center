// =============================================================================
// One business "today": the Riyadh calendar day.
//
// `new Date().toISOString().slice(0, 10)` is the UTC date. Between 00:00 and
// 03:00 in Riyadh it is still yesterday, so a follow-up due today read as not
// yet due, "overdue" counts lagged a day, and the month rolled over three hours
// late. Browser-local dates (getFullYear/getDate) were wrong the other way for
// anyone travelling. riyadhDay() (src/lib/riyadh-day.ts) is the one answer.
//
// Storage timestamps are fine — this only forbids deriving a calendar DAY from
// the UTC clock.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripComments } from "@/lib/source-under-test";
import { addDays, riyadhDay } from "@/lib/riyadh-day";

const ROOT = join(import.meta.dir, "..");

const ALLOW = new Set<string>([]);

// UTC "today" (or now ± n) cut down to a day.
const UTC_TODAY =
  /new Date\((?:Date\.now\(\)[^)]*)?\)\.toISOString\(\)\.(?:slice\(0,\s*10\)|split\(["']T["']\)\[0\])/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("business today is the Riyadh day", () => {
  it("no source derives today from the UTC clock", () => {
    const offenders = walk(ROOT)
      .map((p) => relative(ROOT, p))
      .filter((rel) => !ALLOW.has(rel))
      .filter((rel) => UTC_TODAY.test(stripComments(readFileSync(join(ROOT, rel), "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("riyadhDay is ahead of UTC between 21:00 and 24:00 UTC", () => {
    expect(riyadhDay(new Date("2026-11-15T21:30:00Z"))).toBe("2026-11-16");
    expect(riyadhDay(new Date("2026-11-15T20:59:00Z"))).toBe("2026-11-15");
  });

  it("addDays is calendar arithmetic across month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
