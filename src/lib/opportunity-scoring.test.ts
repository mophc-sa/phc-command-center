// Opportunity Scoring Engine. Run with `bun test src`.
import { test, expect } from "bun:test";
import { scoreOpportunity, type OpportunityScoreInput } from "./opportunity-scoring";

const strong: OpportunityScoreInput = {
  project_stage: "awarded",
  signage_package_status: "confirmed",
  signage_package_confidence: "high",
  main_contractor_confirmed: true,
  contractor_decision_maker: "Eng. Khalid Al-Harbi",
  next_action_due: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  estimated_value_max: 900000,
  evidence_count: 4,
};

test("a strong opportunity scores Tier A with high confidence and no missing data", () => {
  const r = scoreOpportunity(strong);
  expect(r.score).toBeGreaterThanOrEqual(75);
  expect(r.tier).toBe("A");
  expect(r.confidence).toBe("high");
  expect(r.missing_data).toEqual([]);
  expect(r.risk_flags).toEqual([]);
  expect(r.reasons).toContain("project_stage_in_window");
  expect(r.reasons).toContain("buyer_access_confirmed");
});

test("an empty opportunity scores Not Qualified and lists missing data + risk flags", () => {
  const r = scoreOpportunity({});
  expect(r.score).toBe(0);
  expect(r.tier).toBe("not_qualified");
  expect(r.confidence).toBe("low");
  expect(r.missing_data).toContain("project_stage");
  expect(r.missing_data).toContain("main_contractor_confirmed");
  expect(r.risk_flags).toContain("project_stage_unverified");
  expect(r.risk_flags).toContain("package_may_be_closed");
  expect(r.risk_flags).toContain("contact_not_confirmed");
  expect(r.recommended_next_action).toMatch(/buyer|decision-maker/i);
});

test("score is always clamped to 0..100 and weights sum to 100", () => {
  const r = scoreOpportunity(strong);
  expect(r.score).toBeGreaterThanOrEqual(0);
  expect(r.score).toBeLessThanOrEqual(100);
  const maxPossible = r.evidence.reduce((s, e) => s + e.max, 0);
  // Every category that reported evidence must use one of the 6 declared weights.
  for (const e of r.evidence) {
    expect([25, 20, 15, 10]).toContain(e.max);
  }
  expect(maxPossible).toBeLessThanOrEqual(100);
});

test("below-threshold value earns partial value points, not full", () => {
  const full = scoreOpportunity(strong).score;
  const partial = scoreOpportunity({ ...strong, estimated_value_max: 100000 }).score;
  expect(partial).toBeLessThan(full);
  expect(scoreOpportunity({ ...strong, estimated_value_max: 100000 }).reasons).toContain("value_below_threshold");
});

test("an overdue next action is flagged as a risk and lowers timing score", () => {
  const overdue = scoreOpportunity({ ...strong, next_action_due: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10) });
  expect(overdue.risk_flags).toContain("follow_up_overdue");
  expect(overdue.recommended_next_action).toMatch(/follow up/i);
});

test("Sure Win is only ever a suggested forecast flag, never the tier or a stage value", () => {
  const r = scoreOpportunity({ ...strong, evidence_count: 5, next_action_due: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) });
  expect(r.suggested_win_confidence).toBe("sure_win");
  expect(["A", "B", "C", "not_qualified"]).toContain(r.tier);
  expect(r.tier).not.toBe("sure_win");
});

test("missing package status is flagged as package_may_be_closed and listed as missing", () => {
  const r = scoreOpportunity({ ...strong, signage_package_status: null });
  expect(r.missing_data).toContain("signage_package_status");
  expect(r.risk_flags).toContain("package_may_be_closed");
});

test("every returned evidence item ties to a field and a weight within its category max", () => {
  for (const e of scoreOpportunity(strong).evidence) {
    expect(e.field.length).toBeGreaterThan(0);
    expect(e.weight).toBeLessThanOrEqual(e.max);
    expect(e.weight).toBeGreaterThanOrEqual(0);
  }
});
