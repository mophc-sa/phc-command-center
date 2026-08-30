// =============================================================================
// What an opportunity is worth: one rule, one place.
//
// Counted on 2026-08-30, this app answered that question **five different
// ways** across thirteen call sites, while `opportunityValue()` sat exported
// and unused by any of them:
//
//   contract ?? quotation ?? estimated ?? 0    team-dashboard, sales-ai
//   contract ?? estimated ?? 0                 award-queue ×2, my-workspace
//   quotation ?? estimated ?? 0                targets-metrics  ← and named
//                                              `opportunityValue`, shadowing
//                                              the real one
//   estimated ?? 0                             RfqJihPanel ×2, projects,
//                                              accounts, my-workspace ×3
//   opportunityValue()                         everything else
//
// This is not a rounding difference. A deal with a **signed contract** worth
// SAR 14M and no estimate counted as **zero** on My Workspace and at full value
// on the Command Center — two dashboards, two totals, the same book, and
// nothing on either screen saying they disagreed.
//
// Worse, `targets-metrics` could not have been right even in principle: its row
// type had no `contract_value` field and the query never selected it, so a
// salesperson's `wonValue` — the number their achievement against target is
// measured by — was computed from quotations and understated for every deal
// that had reached contract.
//
// **The whole suite passed while all of this was true.** Nothing covered the
// divergence, which is exactly why it survived. This file is that cover.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/lib/source-under-test";
import { opportunityValue, sumOpportunityValue } from "@/lib/sales-kpis";

// ---- the rule itself --------------------------------------------------------

describe("opportunityValue reads most-committed first", () => {
  const row = (c: number | null, q: number | null, e: number | null) => ({
    contract_value: c,
    quotation_value: q,
    estimated_value_max: e,
  });

  it("a signed contract wins over a quotation and an estimate", () => {
    expect(opportunityValue(row(14_000_000, 9_000_000, 7_000_000))).toBe(14_000_000);
  });

  it("a quotation wins over an estimate", () => {
    expect(opportunityValue(row(null, 9_000_000, 7_000_000))).toBe(9_000_000);
  });

  it("an estimate is the last resort, not the first", () => {
    expect(opportunityValue(row(null, null, 7_000_000))).toBe(7_000_000);
  });

  it("no recorded value is null, never zero", () => {
    // The distinction the whole engine rests on: a deal with no value is not a
    // deal worth nothing, and a total that folds one into the other is wrong
    // while looking complete.
    expect(opportunityValue(row(null, null, null))).toBeNull();
  });

  it("a real zero is a real zero", () => {
    // Knowing a figure is zero is knowledge. Only *absence* is null.
    expect(opportunityValue(row(0, null, null))).toBe(0);
  });
});

describe("sumOpportunityValue reports what it could not add", () => {
  it("adds the readable rows and counts the rest", () => {
    const rows = [
      { contract_value: 14_000_000, quotation_value: null, estimated_value_max: null },
      { contract_value: null, quotation_value: 9_000_000, estimated_value_max: 1 },
      { contract_value: null, quotation_value: null, estimated_value_max: null },
      { contract_value: null, quotation_value: null, estimated_value_max: null },
    ];
    expect(sumOpportunityValue(rows)).toEqual({ total: 23_000_000, valued: 2, unvalued: 2 });
  });

  it("an unvalued row adds nothing rather than adding zero", () => {
    // Both produce the same total here; only one of them tells the caller the
    // total is partial, which is the difference between a figure a manager can
    // rely on and one they cannot.
    const none = [{ contract_value: null, quotation_value: null, estimated_value_max: null }];
    expect(sumOpportunityValue(none)).toEqual({ total: 0, valued: 0, unvalued: 1 });
  });

  it("an empty set is zero of nothing, not an error", () => {
    expect(sumOpportunityValue([])).toEqual({ total: 0, valued: 0, unvalued: 0 });
  });
});

// ---- nobody re-invents it ---------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const SRC = join(import.meta.dir, "..");
// The two files the rule is allowed to live in: its own module, and the engine
// that re-exports it. Named, not pattern-matched — an exemption a reader can
// check is worth more than one they have to infer.
const HOME = [join("lib", "opportunity-value.ts"), join("lib", "sales-kpis.ts")];
const FILES = walk(SRC)
  .filter((p) => !HOME.some((h) => p.endsWith(h)))
  .map((p) => [p.slice(SRC.length + 1), stripComments(readFileSync(p, "utf8"))] as const);

describe("no screen computes its own", () => {
  it("finds the source tree, so an empty pass cannot look like a pass", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("no file chains the value columns by hand", () => {
    // The signature of a hand-rolled formula: two or more of the money columns
    // joined by `??`. Reading ONE column is fine — that is a field on screen,
    // not a definition of worth.
    const CHAIN = /(contract_value|quotation_value|estimated_value_max)\s*\?\?\s*[\w.]*(contract_value|quotation_value|estimated_value_max)/;
    const offenders = FILES.filter(([, src]) => CHAIN.test(src)).map(([n]) => n);
    expect(offenders).toEqual([]);
  });

  it("no file defines a second function under the canonical name", () => {
    // `targets-metrics.ts` had `const opportunityValue = …` with a different
    // rule. A local shadowing an export under the same name is the worst
    // version of this defect: the reader sees the right name.
    const SHADOW = /(?:const|function)\s+opportunityValue\s*[=(]/;
    const offenders = FILES.filter(([, src]) => SHADOW.test(src)).map(([n]) => n);
    expect(offenders).toEqual([]);
  });

  it("the row type carries every column the rule reads", () => {
    // targets-metrics could not have been right even in principle: its type had
    // no contract_value, so the column was invisible to it and absent from the
    // query. A formula is only as correct as the fields it can see.
    const targets = readFileSync(join(SRC, "lib", "targets-metrics.ts"), "utf8");
    expect(targets).toMatch(/contract_value: number \| null;/);
    const page = readFileSync(join(SRC, "routes", "_authenticated", "targets.tsx"), "utf8");
    expect(page).toMatch(/select\("[^"]*contract_value/);
  });
});
