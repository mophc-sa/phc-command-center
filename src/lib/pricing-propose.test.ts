import { describe, expect, it } from "bun:test";
import { buildProposePayload, canBuild, canPropose, type ProposeInput, type ProposeTotals } from "@/lib/pricing-propose";

const totals: ProposeTotals = {
  line_count: 3, unpriced_lines: 0, non_sar_lines: 0, multi_quote_lines: 0, screen_price_missing_lines: 0,
  total_selling: 1000, total_cost: 700, below_floor: false,
};
const ok: ProposeInput = {
  isGm: true, canReadCost: true, state: "selling_build", inputsPending: false, fresh: true,
  totals, suggestSettled: true, openFailed: false, openCount: 0,
};
const reason = (over: Partial<ProposeInput>) => {
  const r = canPropose({ ...ok, ...over });
  return r.ok ? "ok" : r.reason;
};

describe("canPropose", () => {
  it("allows the happy path", () => {
    expect(canPropose(ok)).toEqual({ ok: true });
  });
  it("blocks until the suggestion check has settled", () => {
    expect(reason({ suggestSettled: false })).toBe("suggest_not_settled");
  });
  it("blocks while inputs are unsaved", () => {
    expect(reason({ inputsPending: true })).toBe("inputs_pending");
  });
  it("blocks while anything is refetching", () => {
    expect(reason({ fresh: false })).toBe("not_fresh");
  });
  it("blocks on open extras, an unknown count and a failed count", () => {
    expect(reason({ openCount: 1 })).toBe("open_extras");
    expect(reason({ openCount: undefined })).toBe("open_unknown");
    expect(reason({ openCount: 0, openFailed: true })).toBe("open_unknown");
  });
  it("blocks an incomplete price", () => {
    expect(reason({ totals: { ...totals, unpriced_lines: 1 } })).toBe("unpriced");
    expect(reason({ totals: { ...totals, non_sar_lines: 1 } })).toBe("non_sar");
    expect(reason({ totals: { ...totals, multi_quote_lines: 1 } })).toBe("multi_quote");
    expect(reason({ totals: { ...totals, screen_price_missing_lines: 1 } })).toBe("screen_missing");
    expect(reason({ totals: { ...totals, line_count: 0 } })).toBe("no_lines");
    expect(reason({ totals: { ...totals, total_selling: 0 } })).toBe("no_selling");
    expect(reason({ totals: { ...totals, total_selling: null } })).toBe("no_selling");
    expect(reason({ totals: null })).toBe("no_totals");
  });
  it("is the GM's alone, in the selling build, with cost access", () => {
    expect(reason({ isGm: false })).toBe("not_gm");
    expect(reason({ canReadCost: false })).toBe("no_cost_access");
    expect(reason({ state: "cost_review" })).toBe("wrong_state");
  });
});

describe("canBuild", () => {
  it("does not wait for the suggestion check or open extras", () => {
    expect(canBuild({ ...ok, suggestSettled: false, openCount: 5 })).toEqual({ ok: true });
  });
  it("shares the priced, inputs, freshness and role rules", () => {
    expect(canBuild({ ...ok, totals: { ...totals, unpriced_lines: 2 } })).toEqual({ ok: false, reason: "unpriced" });
    expect(canBuild({ ...ok, inputsPending: true })).toEqual({ ok: false, reason: "inputs_pending" });
    expect(canBuild({ ...ok, fresh: false })).toEqual({ ok: false, reason: "not_fresh" });
    expect(canBuild({ ...ok, isGm: false })).toEqual({ ok: false, reason: "not_gm" });
    expect(canBuild({ ...ok, state: "boq_frozen" })).toEqual({ ok: false, reason: "wrong_state" });
  });
});

describe("buildProposePayload", () => {
  it("sends exactly the snapshot's total and cost, no justification above the floor", () => {
    const r = buildProposePayload({ total_selling: 1234.5, total_cost: 800.25, below_floor: false }, "  ignored  ");
    expect(r).toEqual({ ok: true, payload: { expectedTotal: 1234.5, expectedTotalCost: 800.25, justification: undefined } });
  });
  it("sends a trimmed justification below the floor", () => {
    const r = buildProposePayload({ total_selling: 900, total_cost: 800, below_floor: true }, "  keep the client  ");
    expect(r).toEqual({ ok: true, payload: { expectedTotal: 900, expectedTotalCost: 800, justification: "keep the client" } });
  });
  it("refuses a blank justification below the floor", () => {
    expect(buildProposePayload({ total_selling: 900, total_cost: 800, below_floor: true }, " \n\t ")).toEqual({ ok: false, reason: "justification_blank" });
  });
  it("sends no justification when the floor status is unknown", () => {
    const r = buildProposePayload({ total_selling: 900, total_cost: 800, below_floor: null }, "x");
    expect(r.ok && r.payload.justification).toBe(undefined);
  });
  it("refuses a snapshot without a total", () => {
    expect(buildProposePayload({ total_selling: null, total_cost: 1, below_floor: false }, "")).toEqual({ ok: false, reason: "no_total" });
  });
});
