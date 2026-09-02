// =============================================================================
// The number the board's forecast is made of.
//
// `setHumanWinProbability` has been complete in workflow-actions.ts since Phase
// 3 — range check, reason, who and when, an audit row, and it deliberately
// keeps a manager's estimate apart from the model's score (migration
// 20260818140000, so that "where does the desk disagree with the model" stays
// an answerable question).
//
// Nothing called it. Zero call sites outside a contract test, which is why the
// board reported "no probability entered on any of 739 deals" and refused all
// three of its 30/60/90 horizons. The same shape as `next_action`, empty on
// every row because no field set it.
//
// What is pinned here is that it stays reachable, and that nobody writes the
// column around it.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { readSource } from "@/lib/source-under-test";

const { code: PAGE } = readSource(
  join(import.meta.dir, "..", "routes", "_authenticated", "opportunities.$id.tsx"),
);
const { code: ACTIONS } = readSource(join(import.meta.dir, "opportunity-collab-actions.ts"));

describe("the probability is reachable", () => {
  it("is offered on the opportunity page", () => {
    expect(PAGE).toContain('key: "winProbability"');
    expect(PAGE).toContain("label_win_probability");
  });

  it("is set through the function, not around it", () => {
    // That function records the reason, who set it, when, and writes the audit
    // row. Writing the column directly keeps the number and loses every
    // question anyone would later ask about it.
    expect(PAGE).toContain("setHumanWinProbability(id, Number(rawProb)");
    expect(PAGE).not.toMatch(/human_win_probability\s*:/);
  });

  it("is not written by the plain figures update either", () => {
    // updateOpportunityFigures is a direct table write with no audit. It must
    // never learn about this column.
    expect(ACTIONS).not.toContain("human_win_probability");
  });
});

describe("who may set it", () => {
  it("follows the pipeline permission, not the money one", () => {
    // It is a sales judgement. Gating it behind canEditTotalValue — Finance and
    // BD only — is precisely how next_action stayed null on all 739 rows.
    const at = PAGE.indexOf('key: "winProbability"');
    expect(at).toBeGreaterThan(-1);
    // The money fields are inside the canEditValues branch; this one is not.
    const moneyBranch = PAGE.indexOf("...(canEditValues");
    const branchEnd = PAGE.indexOf("] as const)", moneyBranch);
    expect(at > branchEnd).toBe(true);
  });
});

describe("what it refuses", () => {
  it("validates the range in the page as well as the action", () => {
    // The action throws; a thrown error surfaces as a toast with an English
    // exception in it. Saying it here names the field instead.
    expect(PAGE).toContain("probability_bad");
    expect(PAGE).toMatch(/\/\^\\d\{1,3\}\$\//);
  });

  it("does not resend an unchanged value", () => {
    // Every call writes an audit row. Re-saving the dialog without touching the
    // number would file a decision nobody made.
    expect(PAGE).toContain('rawProb !== prevProb');
  });
});
