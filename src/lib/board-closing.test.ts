import { describe, expect, it } from "bun:test";
import {
  attentionQueues,
  closingList,
  codeYear,
  pipelineByRoute,
  priorityKeyOf,
  redFlags2025,
  rfqIntake,
  targetYtd,
  toRec,
  verbalAwards,
  type ClosingOpp,
} from "./board-closing";

const TODAY = "2026-11-17";
let n = 0;
function opp(
  p: Partial<ClosingOpp> & { nov?: Record<string, unknown>; extra?: Record<string, unknown> },
): ClosingOpp {
  const { nov, extra, ...rest } = p;
  return {
    id: `o${++n}`,
    project_name: "P",
    owner_id: "u1",
    stage: "quotation",
    sales_stage: "jih",
    contract_value: null,
    quotation_value: 100,
    extra_data: { ...(nov ? { master_list_2026_11: nov } : {}), ...extra },
    ...rest,
  };
}

describe("board closing view", () => {
  it("reads column A and the code year", () => {
    expect(priorityKeyOf("PRIORITY - A (VERB-AWARDED)")).toBe("verbal_a");
    expect(priorityKeyOf("NEED FOLLOW-UP")).toBe("follow_up");
    expect(priorityKeyOf("ON-HOLD")).toBe("on_hold");
    expect(priorityKeyOf(null)).toBe("none");
    expect(codeYear("FA25106-B")).toBe(2025);
    expect(codeYear("OM")).toBeNull();
  });

  it("counts a secondary contractor quote once (on its primary), without calling it unvalued", () => {
    const r = toRec(
      opp({
        quotation_value: null,
        extra: { value_counted_on: "o1", contractor_quote_value: 500 },
      }),
    );
    expect(r.secondary).toBe(true);
    expect(r.value).toBeNull();
    expect(r.quoted).toBe(500);
  });

  it("verbal awards: E confirmed plus A to reconcile; a later Won is not reconciled or counted", () => {
    const recs = [
      opp({ sales_stage: "verbally_awarded", nov: { status: "Verbally Awarded" } }),
      opp({
        sales_stage: "jih",
        nov: { priority: "PRIORITY - A (VERB-AWARDED)", status: "Submitted - Original" },
      }),
      opp({
        sales_stage: "won",
        stage: "won",
        nov: { priority: "PRIORITY - A (VERB-AWARDED)", status: "Won" },
      }),
    ].map(toRec);
    const v = verbalAwards(recs);
    expect(v.confirmed.count).toBe(1);
    expect(v.reconcile.count).toBe(1);
    expect(v.all.count).toBe(2);
  });

  it("orders the closing list by group, value second, and keeps holds apart", () => {
    const recs = [
      opp({ quotation_value: 10, nov: { priority: "NEED FOLLOW-UP" } }),
      opp({ quotation_value: 5, sales_stage: "verbally_awarded" }),
      opp({
        quotation_value: 50,
        nov: { route: "JIH - Direct" },
        extra: { master_list: { received: "2026-03-01" } },
      }),
      opp({ quotation_value: 99, sales_stage: "on_hold", nov: { priority: "ON-HOLD" } }),
    ].map(toRec);
    const c = closingList(recs, 2026);
    expect(c.groups.map((g) => g.rows.map((r) => r.value))).toEqual([[5], [50], [10]]);
    expect(c.holds.count).toBe(1);
  });

  it("separates JIH and Tender, active and held", () => {
    const p = pipelineByRoute(
      [
        opp({ nov: { route: "JIH - Contractor" } }),
        opp({ sales_stage: "on_hold", nov: { route: "JIH - Direct" } }),
        opp({ nov: { route: "Tender" } }),
        opp({ sales_stage: "lost", stage: "lost", nov: { route: "JIH - Direct" } }),
      ].map(toRec),
    );
    expect([p.jih.active.count, p.jih.held.count, p.tender.active.count]).toEqual([1, 1, 1]);
  });

  it("places RFQs only by their received date and reports the missing ones", () => {
    const r = rfqIntake(
      [
        opp({ extra: { master_list: { received: "2026-11-01" } } }),
        opp({ nov: { last_update: "2026-11-10", next_action_date: "2026-11-12" } }),
      ].map(toRec),
      TODAY,
    );
    expect(r.last30.count).toBe(1);
    expect(r.missing.count).toBe(1);
    expect(r.months[10].count).toBe(1);
  });

  it("counts only Won toward the target, by award date", () => {
    const t = targetYtd(
      [
        opp({
          sales_stage: "won",
          stage: "won",
          won_at: "2026-02-10T00:00:00Z",
          quotation_value: 10,
        }),
        opp({ sales_stage: "verbally_awarded", quotation_value: 99 }),
        opp({
          sales_stage: "won",
          stage: "won",
          won_at: "2025-12-01T00:00:00Z",
          quotation_value: 7,
        }),
      ].map(toRec),
      TODAY,
      40,
    );
    expect(t.won.value).toBe(10);
    expect(t.ratio).toBe(0.25);
    expect(t.quarters[0].value).toBe(10);
    expect(t.listDated).toBe(1);
  });

  it("missing next-action dates are missing, not overdue", () => {
    const q = attentionQueues(
      [
        opp({ nov: { priority: "NEED FOLLOW-UP", next_action_date: "2026-11-01" } }),
        opp({ nov: { priority: "NEED FOLLOW-UP" }, next_action_due: null }),
      ].map(toRec),
      TODAY,
    );
    expect(q.overdue.count).toBe(1);
    expect(q.missingDate.count).toBe(1);
  });

  it("2025 red flags: received Jul–Dec 2025 confirmed; a 2025 code alone needs verification", () => {
    const f = redFlags2025(
      [
        opp({
          nov: {
            route: "JIH - Contractor",
            code: "FA25001",
            remarks: "Met the client, revised offer",
          },
          extra: { master_list: { received: "2025-08-01" } },
        }),
        opp({ nov: { route: "JIH - Contractor", code: "FA25002" } }),
        opp({
          nov: { route: "JIH - Contractor", code: "FA25003" },
          extra: { master_list: { received: "2025-03-01" } },
        }),
      ].map(toRec),
      TODAY,
    );
    expect(f.verified).toBe(1);
    expect(f.needsVerification).toBe(1);
    expect(f.rows[0].engagement).toBeGreaterThan(0);
  });
});
