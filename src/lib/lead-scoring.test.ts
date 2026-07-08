// Lead Scoring Engine. Run with `bun test src`.
import { test, expect } from "bun:test";
import { scoreLead, type LeadInput } from "../../supabase/functions/_shared/lead-scoring";

const strong: LeadInput = {
  project_name: "Riyadh Metro Depot",
  main_contractor_guess: "Al Rajhi Construction",
  project_stage_estimate: "awarded",
  signage_potential: "high",
  estimated_value: 750000,
  location: "Riyadh",
};

test("a strong lead scores hot with supporting evidence", () => {
  const r = scoreLead(strong);
  expect(r.score).toBeGreaterThanOrEqual(75);
  expect(r.band).toBe("hot");
  expect(r.evidence.length).toBeGreaterThan(0);
  expect(r.reason_codes).toContain("strong_signage_fit");
  expect(r.reason_codes).toContain("value_above_threshold");
  expect(r.missing_information).toEqual([]);
});

test("an empty lead scores cold and lists missing information", () => {
  const r = scoreLead({ project_name: "Unknown project" });
  expect(r.band).toBe("cold");
  expect(r.missing_information).toContain("main_contractor_guess");
  expect(r.missing_information).toContain("signage_potential");
  expect(r.next_best_action).toMatch(/main contractor/i);
});

test("below-threshold value earns partial value points, not full", () => {
  const full = scoreLead(strong).score;
  const half = scoreLead({ ...strong, estimated_value: 150000 }).score;
  expect(half).toBeLessThan(full);
  expect(scoreLead({ ...strong, estimated_value: 150000 }).reason_codes).toContain("value_below_threshold");
});

test("score is always clamped to 0..100", () => {
  const r = scoreLead(strong);
  expect(r.score).toBeGreaterThanOrEqual(0);
  expect(r.score).toBeLessThanOrEqual(100);
});

test("every returned evidence item ties to a field and weight", () => {
  for (const e of scoreLead(strong).evidence) {
    expect(e.field.length).toBeGreaterThan(0);
    expect(typeof e.weight).toBe("number");
  }
});
