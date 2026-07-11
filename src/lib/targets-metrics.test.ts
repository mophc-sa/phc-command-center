// PHC Sales OS — Sprint 8 Targets & Performance metric calculations. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  achievementPct,
  forecastValue,
  computeSalespersonMetrics,
  computeManagerMetrics,
  type SalesTargetRow,
  type OpportunityRow,
  type RfqRow,
  type TenderRow,
  type QuotationRow,
  type FollowUpRow,
  type ActionFlagRow,
} from "./targets-metrics";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

function target(over: Partial<SalesTargetRow> = {}): SalesTargetRow {
  return {
    id: "t1",
    user_id: U1,
    period_start: "2026-07-01",
    sales_target: 100000,
    pipeline_target: 200000,
    quotation_target: 5,
    activity_target: 10,
    conversion_target: 30,
    notes: null,
    ...over,
  };
}

function opp(over: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    id: "o1",
    owner_id: U1,
    stage: "won",
    tier: "B",
    estimated_value_max: 50000,
    quotation_value: null,
    win_confidence: null,
    updated_at: "2026-07-05",
    ...over,
  };
}

test("achievementPct handles zero target without dividing by zero", () => {
  expect(achievementPct(500, 0)).toBe(0);
});

test("achievementPct rounds to nearest percent", () => {
  expect(achievementPct(33, 100)).toBe(33);
  expect(achievementPct(150, 100)).toBe(150); // can exceed 100, callers decide how to display it
});

test("forecastValue weights open opportunities by win_confidence, skips closed ones", () => {
  const opps: OpportunityRow[] = [
    opp({ stage: "discovery", estimated_value_max: 100000, win_confidence: "sure_win" }), // 90,000
    opp({ stage: "quotation", estimated_value_max: 100000, win_confidence: "low" }), // 10,000
    opp({ stage: "quotation", estimated_value_max: 100000, win_confidence: null }), // 20,000 (default weight)
    opp({ stage: "won", estimated_value_max: 999999, win_confidence: "sure_win" }), // excluded (closed)
    opp({ stage: "lost", estimated_value_max: 999999, win_confidence: "sure_win" }), // excluded (closed)
  ];
  expect(forecastValue(opps)).toBe(90000 + 10000 + 20000);
});

test("computeSalespersonMetrics rolls up won value, pipeline, and conversion rate for one owner only", () => {
  const opps: OpportunityRow[] = [
    opp({ id: "o1", stage: "won", estimated_value_max: 60000 }),
    opp({ id: "o2", stage: "lost", estimated_value_max: 40000 }),
    opp({ id: "o3", stage: "quotation", estimated_value_max: 30000 }),
    opp({ id: "o4", owner_id: U2, stage: "won", estimated_value_max: 999999 }), // other owner, excluded
  ];
  const rfqs: RfqRow[] = [
    { id: "r1", sales_owner_id: U1, status: "converted", updated_at: "2026-07-10" },
    { id: "r2", sales_owner_id: U1, status: "open", updated_at: "2026-07-10" }, // not yet reviewed
  ];
  const tenders: TenderRow[] = [{ id: "tn1", tender_owner_id: U1, tender_stage: "tender_under_process", updated_at: "2026-07-08" }];
  const quotations: QuotationRow[] = [
    { id: "q1", owner_id: U1, status: "submitted", value: 30000, updated_at: "2026-07-09" },
    { id: "q2", owner_id: U1, status: "draft", value: 30000, updated_at: "2026-07-09" }, // not sent yet
  ];
  const followUps: FollowUpRow[] = [
    { id: "f1", owner_id: U1, status: "completed", last_contact_at: "2026-07-06" },
    { id: "f2", owner_id: U1, status: "scheduled", last_contact_at: null },
  ];

  const m = computeSalespersonMetrics(target(), { opportunities: opps, rfqs, tenders, quotations, followUps });

  expect(m.wonValue).toBe(60000);
  expect(m.remaining).toBe(40000);
  expect(m.achievement).toBe(60);
  expect(m.openPipeline).toBe(30000);
  expect(m.rfqsReviewed).toBe(1);
  expect(m.tendersFollowed).toBe(1);
  expect(m.quotationsSent).toBe(1);
  expect(m.completedFollowUps).toBe(1);
  expect(m.conversionRate).toBe(50); // 1 won / (1 won + 1 lost)
});

test("computeSalespersonMetrics: remaining never goes negative once target is exceeded", () => {
  const opps: OpportunityRow[] = [opp({ stage: "won", estimated_value_max: 150000 })];
  const m = computeSalespersonMetrics(target({ sales_target: 100000 }), {
    opportunities: opps,
    rfqs: [],
    tenders: [],
    quotations: [],
    followUps: [],
  });
  expect(m.remaining).toBe(0);
  expect(m.achievement).toBe(150);
});

test("computeManagerMetrics aggregates team target/actual, pipeline by owner, and conversion rates", () => {
  const targets = [target({ user_id: U1, sales_target: 100000 }), target({ id: "t2", user_id: U2, sales_target: 50000 })];
  const opportunities: OpportunityRow[] = [
    opp({ id: "o1", owner_id: U1, stage: "won", estimated_value_max: 80000 }),
    opp({ id: "o2", owner_id: U2, stage: "won", estimated_value_max: 20000 }),
    opp({ id: "o3", owner_id: U1, stage: "quotation", tier: "A", estimated_value_max: 40000 }),
    opp({ id: "o4", owner_id: U2, stage: "discovery", tier: "B", estimated_value_max: 15000 }),
  ];
  const rfqs: RfqRow[] = [
    { id: "r1", sales_owner_id: U1, status: "converted", updated_at: "2026-07-10" },
    { id: "r2", sales_owner_id: U2, status: "lost", updated_at: "2026-07-10" },
  ];
  const tenders: TenderRow[] = [
    { id: "tn1", tender_owner_id: U1, tender_stage: "converted_to_jih", updated_at: "2026-07-10" },
    { id: "tn2", tender_owner_id: U2, tender_stage: "tender_lost_or_archived", updated_at: "2026-07-10" },
  ];
  const quotations: QuotationRow[] = [
    { id: "q1", owner_id: U1, status: "won", value: 80000, updated_at: "2026-07-10" },
    { id: "q2", owner_id: U2, status: "lost", value: 20000, updated_at: "2026-07-10" },
  ];
  const actionFlags: ActionFlagRow[] = [
    { id: "a1", action_owner_id: U1, status: "open", due_date: "2026-07-01" }, // overdue
    { id: "a2", action_owner_id: U1, status: "open", due_date: "2026-07-20" }, // not yet due
    { id: "a3", action_owner_id: U2, status: "resolved", due_date: "2026-07-01" }, // resolved, excluded
  ];

  const m = computeManagerMetrics(targets, { opportunities, rfqs, tenders, quotations, actionFlags }, "2026-07-11");

  expect(m.teamTarget).toBe(150000);
  expect(m.teamActual).toBe(100000);
  expect(m.teamAchievement).toBe(67);
  expect(m.pipelineByOwner[U1]).toBe(40000);
  expect(m.pipelineByOwner[U2]).toBe(15000);
  expect(m.overdueActionsByOwner[U1]).toBe(1);
  expect(m.overdueActionsByOwner[U2]).toBeUndefined();
  expect(m.tierAOpenCount).toBe(1);
  expect(m.tierAOpenValue).toBe(40000);
  expect(m.rfqConversionPct).toBe(50);
  expect(m.tenderConversionPct).toBe(50);
  expect(m.quotationWinRatePct).toBe(50);
});
