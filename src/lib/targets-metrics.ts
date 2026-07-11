// PHC Sales OS — Sprint 8: Targets & Performance metric calculations.
// Pure functions only (no Supabase/React) so they stay unit-testable in
// isolation from data fetching. Consumed by src/routes/_authenticated/targets.tsx.

export type SalesTargetRow = {
  id: string;
  user_id: string;
  period_start: string;
  sales_target: number | string;
  pipeline_target: number | string;
  quotation_target: number | string;
  activity_target: number | string;
  conversion_target: number | string;
  notes: string | null;
};

export type OpportunityRow = {
  id: string;
  owner_id: string | null;
  stage: "discovery" | "qualification" | "preparation" | "quotation" | "follow_up" | "won" | "lost" | "archived";
  tier: "A" | "B" | "C";
  estimated_value_max: number | null;
  quotation_value: number | null;
  win_confidence: "low" | "possible" | "strong" | "sure_win" | null;
  updated_at: string;
};

export type RfqRow = {
  id: string;
  sales_owner_id: string | null;
  status: "open" | "converted" | "lost" | "on_hold";
  updated_at: string;
};

export type TenderRow = {
  id: string;
  tender_owner_id: string | null;
  tender_stage: "tender_identified" | "tender_under_process" | "award_negotiation" | "awarded_to_contractor" | "converted_to_jih" | "tender_lost_or_archived";
  updated_at: string;
};

export type QuotationRow = {
  id: string;
  owner_id: string | null;
  status: "draft" | "under_internal_review" | "approved_for_submission" | "submitted" | "follow_up" | "negotiation" | "revised" | "won" | "lost" | "expired";
  value: number | null;
  updated_at: string;
};

export type FollowUpRow = {
  id: string;
  owner_id: string | null;
  status: string;
  last_contact_at: string | null;
};

export type ActionFlagRow = {
  id: string;
  action_owner_id: string | null;
  status: "open" | "resolved" | "in_progress" | "completed" | "dismissed" | "escalated" | "blocked";
  due_date: string | null;
};

const OPEN_PIPELINE_STAGES = new Set(["discovery", "qualification", "preparation", "quotation", "follow_up"]);
const SENT_QUOTATION_STATUSES = new Set(["submitted", "follow_up", "negotiation", "revised", "won", "lost"]);
const CLOSED_QUOTATION_STATUSES = new Set(["won", "lost"]);
const OPEN_ACTION_STATUSES = new Set<ActionFlagRow["status"]>(["open", "in_progress", "escalated", "blocked"]);

const opportunityValue = (o: OpportunityRow) => o.quotation_value ?? o.estimated_value_max ?? 0;

const inPeriod = (iso: string | null, periodStart: string) => !!iso && iso >= periodStart;

const owner = <T extends { [k: string]: unknown }>(rows: T[], key: keyof T, userId: string) =>
  rows.filter((r) => r[key] === userId);

export function achievementPct(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((actual / target) * 100);
}

// win_confidence -> probability weight, used only for the forecast rollup.
export const FORECAST_WEIGHTS: Record<NonNullable<OpportunityRow["win_confidence"]>, number> = {
  low: 0.1,
  possible: 0.35,
  strong: 0.65,
  sure_win: 0.9,
};
const DEFAULT_FORECAST_WEIGHT = 0.2; // no confidence set yet

export function forecastValue(opportunities: OpportunityRow[]): number {
  return opportunities
    .filter((o) => OPEN_PIPELINE_STAGES.has(o.stage))
    .reduce((sum, o) => sum + opportunityValue(o) * (o.win_confidence ? FORECAST_WEIGHTS[o.win_confidence] : DEFAULT_FORECAST_WEIGHT), 0);
}

export type SalespersonMetrics = {
  userId: string;
  target: SalesTargetRow;
  wonValue: number;
  remaining: number;
  achievement: number;
  openPipeline: number;
  completedFollowUps: number;
  rfqsReviewed: number;
  tendersFollowed: number;
  quotationsSent: number;
  conversionRate: number;
};

export function computeSalespersonMetrics(
  target: SalesTargetRow,
  data: {
    opportunities: OpportunityRow[];
    rfqs: RfqRow[];
    tenders: TenderRow[];
    quotations: QuotationRow[];
    followUps: FollowUpRow[];
  },
): SalespersonMetrics {
  const userId = target.user_id;
  const periodStart = target.period_start;

  const myOpps = owner(data.opportunities, "owner_id", userId);
  const wonValue = myOpps
    .filter((o) => o.stage === "won" && inPeriod(o.updated_at, periodStart))
    .reduce((s, o) => s + opportunityValue(o), 0);
  const lostCount = myOpps.filter((o) => o.stage === "lost" && inPeriod(o.updated_at, periodStart)).length;
  const wonCount = myOpps.filter((o) => o.stage === "won" && inPeriod(o.updated_at, periodStart)).length;
  const openPipeline = myOpps
    .filter((o) => OPEN_PIPELINE_STAGES.has(o.stage))
    .reduce((s, o) => s + opportunityValue(o), 0);

  const myRfqs = owner(data.rfqs, "sales_owner_id", userId);
  const rfqsReviewed = myRfqs.filter((r) => r.status !== "open" && inPeriod(r.updated_at, periodStart)).length;

  const myTenders = owner(data.tenders, "tender_owner_id", userId);
  const tendersFollowed = myTenders.filter((tt) => inPeriod(tt.updated_at, periodStart)).length;

  const myQuotes = owner(data.quotations, "owner_id", userId);
  const quotationsSent = myQuotes.filter(
    (q) => SENT_QUOTATION_STATUSES.has(q.status) && inPeriod(q.updated_at, periodStart),
  ).length;

  const myFollowUps = owner(data.followUps, "owner_id", userId);
  const completedFollowUps = myFollowUps.filter(
    (f) => f.status === "completed" && inPeriod(f.last_contact_at, periodStart),
  ).length;

  const closed = wonCount + lostCount;
  const conversionRate = closed > 0 ? Math.round((wonCount / closed) * 100) : 0;

  const salesTarget = Number(target.sales_target);
  return {
    userId,
    target,
    wonValue,
    remaining: Math.max(0, salesTarget - wonValue),
    achievement: achievementPct(wonValue, salesTarget),
    openPipeline,
    completedFollowUps,
    rfqsReviewed,
    tendersFollowed,
    quotationsSent,
    conversionRate,
  };
}

export type ManagerMetrics = {
  teamTarget: number;
  teamActual: number;
  teamAchievement: number;
  pipelineByOwner: Record<string, number>;
  overdueActionsByOwner: Record<string, number>;
  tierAOpenCount: number;
  tierAOpenValue: number;
  rfqConversionPct: number;
  tenderConversionPct: number;
  quotationWinRatePct: number;
  forecast: number;
};

export function computeManagerMetrics(
  targets: SalesTargetRow[],
  data: {
    opportunities: OpportunityRow[];
    rfqs: RfqRow[];
    tenders: TenderRow[];
    quotations: QuotationRow[];
    actionFlags: ActionFlagRow[];
  },
  today: string,
): ManagerMetrics {
  const teamTarget = targets.reduce((s, t) => s + Number(t.sales_target), 0);
  const perSalesperson = targets.map((t) =>
    computeSalespersonMetrics(t, { opportunities: data.opportunities, rfqs: data.rfqs, tenders: data.tenders, quotations: data.quotations, followUps: [] }),
  );
  const teamActual = perSalesperson.reduce((s, m) => s + m.wonValue, 0);

  const pipelineByOwner: Record<string, number> = {};
  for (const o of data.opportunities) {
    if (!o.owner_id || !OPEN_PIPELINE_STAGES.has(o.stage)) continue;
    pipelineByOwner[o.owner_id] = (pipelineByOwner[o.owner_id] ?? 0) + opportunityValue(o);
  }

  const overdueActionsByOwner: Record<string, number> = {};
  for (const f of data.actionFlags) {
    if (!f.action_owner_id || !f.due_date) continue;
    if (!OPEN_ACTION_STATUSES.has(f.status)) continue;
    if (f.due_date >= today) continue;
    overdueActionsByOwner[f.action_owner_id] = (overdueActionsByOwner[f.action_owner_id] ?? 0) + 1;
  }

  const tierAOpen = data.opportunities.filter((o) => o.tier === "A" && OPEN_PIPELINE_STAGES.has(o.stage));

  const closedRfqs = data.rfqs.filter((r) => r.status === "converted" || r.status === "lost");
  const rfqConversionPct =
    closedRfqs.length > 0 ? Math.round((closedRfqs.filter((r) => r.status === "converted").length / closedRfqs.length) * 100) : 0;

  const closedTenders = data.tenders.filter((tt) => tt.tender_stage === "converted_to_jih" || tt.tender_stage === "tender_lost_or_archived");
  const tenderConversionPct =
    closedTenders.length > 0
      ? Math.round((closedTenders.filter((tt) => tt.tender_stage === "converted_to_jih").length / closedTenders.length) * 100)
      : 0;

  const closedQuotes = data.quotations.filter((q) => CLOSED_QUOTATION_STATUSES.has(q.status));
  const quotationWinRatePct =
    closedQuotes.length > 0 ? Math.round((closedQuotes.filter((q) => q.status === "won").length / closedQuotes.length) * 100) : 0;

  return {
    teamTarget,
    teamActual,
    teamAchievement: achievementPct(teamActual, teamTarget),
    pipelineByOwner,
    overdueActionsByOwner,
    tierAOpenCount: tierAOpen.length,
    tierAOpenValue: tierAOpen.reduce((s, o) => s + opportunityValue(o), 0),
    rfqConversionPct,
    tenderConversionPct,
    quotationWinRatePct,
    forecast: forecastValue(data.opportunities),
  };
}
