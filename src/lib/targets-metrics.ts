// PHC Sales OS — Sprint 9: Targets & Performance metric calculations.
// Pure functions only (no Supabase/React) so they stay unit-testable in
// isolation from data fetching. Consumed by src/routes/_authenticated/targets.tsx
// and src/lib/sales-actions.ts.

import { computeQuotationWinRatePct } from "@/lib/dashboard-helpers";

// target_period enum: 'monthly' | 'quarterly' | 'annual'.
// The 'annual' value was added in migration 20260716100000_salesperson_dashboard.sql.
export type PeriodType = "monthly" | "quarterly" | "annual";

export type SalesTargetRow = {
  id: string;
  user_id: string;
  period_type: PeriodType;
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
  tender_stage: "tender_identified" | "tender_under_process" | "tender_bafo" | "award_negotiation" | "awarded_to_contractor" | "converted_to_jih" | "tender_lost_or_archived";
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
const OPEN_ACTION_STATUSES = new Set<ActionFlagRow["status"]>(["open", "in_progress", "escalated", "blocked"]);

const opportunityValue = (o: OpportunityRow) => o.quotation_value ?? o.estimated_value_max ?? 0;

// ---------------------------------------------------------------------------
// Period windows (Required Fix 1)
// ---------------------------------------------------------------------------

const PERIOD_MONTHS: Record<PeriodType, number> = { monthly: 1, quarterly: 3, annual: 12 };
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

export type PeriodWindow = { periodStart: string; periodEnd: string };

/**
 * Computes a half-open [periodStart, periodEnd) window as YYYY-MM-DD date
 * strings: periodEnd = periodStart + N months (N=1 monthly, N=3 quarterly).
 *
 * Uses Date.UTC purely to add whole calendar months — it never parses a
 * wall-clock/local Date — so this is immune to the host machine's local
 * timezone. Month/year overflow (e.g. December + 1 month, Q4 + 1 quarter)
 * is handled automatically by Date.UTC's normal carry behavior.
 */
export function periodWindow(periodType: PeriodType, periodStart: string): PeriodWindow {
  const [y, m, d] = periodStart.split("-").map(Number);
  const months = PERIOD_MONTHS[periodType] ?? 1;
  const end = new Date(Date.UTC(y, m - 1 + months, d));
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const periodEnd = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
  return { periodStart, periodEnd };
}

/**
 * Half-open window membership: periodStart <= iso < periodEnd, via plain
 * ISO string comparison. This is safe without ever parsing `iso` into a
 * Date: a YYYY-MM-DD boundary sorts correctly against any full
 * YYYY-MM-DDTHH:mm:ssZ timestamp on or after that date, because a string
 * that is a strict prefix of another always sorts before it.
 *
 * Invalid or missing dates are always excluded rather than risking a wrong
 * comparison against malformed input.
 */
export function inPeriod(iso: string | null | undefined, window: PeriodWindow): boolean {
  if (!iso || !ISO_DATE_RE.test(iso)) return false;
  return iso >= window.periodStart && iso < window.periodEnd;
}

// ---------------------------------------------------------------------------
// conversion_target validation (Required Fix 2)
// ---------------------------------------------------------------------------

export type ConversionTargetValidation = { ok: true; value: number } | { ok: false; error: string };

/**
 * Validates a conversion-rate target as a 0-100 percentage. Never silently
 * coerces bad input to 0 — blank/NaN/out-of-range input is rejected with an
 * explicit reason so the caller can surface it, while an explicit "0" is
 * accepted as a real value (distinct from "not provided").
 */
export function validateConversionTarget(raw: string | number | null | undefined): ConversionTargetValidation {
  const trimmed = typeof raw === "number" ? String(raw) : (raw ?? "").trim();
  if (trimmed === "") return { ok: false, error: "Conversion target is required." };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, error: "Conversion target must be a valid number." };
  if (value < 0) return { ok: false, error: "Conversion target cannot be below 0%." };
  if (value > 100) return { ok: false, error: "Conversion target cannot exceed 100%." };
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// period_start normalization (Required Fix 3)
// ---------------------------------------------------------------------------

export type NormalizeResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Normalizes a period_start to the first day of its containing period:
 * monthly -> YYYY-MM-01, quarterly -> first day of Jan/Apr/Jul/Oct. Every
 * consumer of sales_targets filters by an exact period_start match (see
 * targets.tsx: `.eq("period_start", monthStart())`), so an un-normalized
 * date (e.g. a mid-month pick from a free date picker) would create a row
 * no query ever looks up again.
 */
export function normalizePeriodStart(periodType: PeriodType, rawDate: string): NormalizeResult {
  if (!ISO_DATE_RE.test(rawDate)) {
    return { ok: false, error: "Period start must be a valid date (YYYY-MM-DD)." };
  }
  const [y, m] = rawDate.split("-").map(Number);
  if (m < 1 || m > 12) {
    return { ok: false, error: "Period start must be a valid date (YYYY-MM-DD)." };
  }
  if (periodType === "quarterly") {
    const quarterStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    return { ok: true, value: `${y}-${String(quarterStartMonth).padStart(2, "0")}-01` };
  }
  return { ok: true, value: `${y}-${String(m).padStart(2, "0")}-01` };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export function achievementPct(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((actual / target) * 100);
}

// win_confidence -> probability weight, used only for the forecast rollup.
//
// Phase-1 business assumption, NOT statistically calibrated against actual
// historical win/loss outcomes (there isn't enough closed-deal history yet
// to calibrate against). These are reasonable starting weights chosen for
// launch; they should be reviewed and replaced with data-derived weights
// once enough won/lost history exists to compute real conversion rates per
// confidence tier. Do not change these percentages without explicit product
// approval — this list is the single source of truth other code should
// import rather than re-guessing weights locally.
export const FORECAST_CONFIDENCE_WEIGHTS: Record<NonNullable<OpportunityRow["win_confidence"]>, number> = {
  low: 0.1,
  possible: 0.35,
  strong: 0.65,
  sure_win: 0.9,
};
const DEFAULT_FORECAST_WEIGHT = 0.2; // no confidence set yet — Phase-1 assumption, see above.

// Forecast is a snapshot of currently-open pipeline, not an event that
// "happened during" any particular period — so it is intentionally NOT
// period-bounded (same reasoning as openPipeline below).
export function forecastValue(opportunities: OpportunityRow[]): number {
  return opportunities
    .filter((o) => OPEN_PIPELINE_STAGES.has(o.stage))
    .reduce(
      (sum, o) => sum + opportunityValue(o) * (o.win_confidence ? FORECAST_CONFIDENCE_WEIGHTS[o.win_confidence] : DEFAULT_FORECAST_WEIGHT),
      0,
    );
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
  const window = periodWindow(target.period_type, target.period_start);

  const myOpps = data.opportunities.filter((o) => o.owner_id === userId);
  // "Won this period" / "lost this period" / activity counts below are all
  // events attributed to the period they occurred in, so they use the full
  // half-open [periodStart, periodEnd) window.
  const wonValue = myOpps
    .filter((o) => o.stage === "won" && inPeriod(o.updated_at, window))
    .reduce((s, o) => s + opportunityValue(o), 0);
  const lostCount = myOpps.filter((o) => o.stage === "lost" && inPeriod(o.updated_at, window)).length;
  const wonCount = myOpps.filter((o) => o.stage === "won" && inPeriod(o.updated_at, window)).length;

  // Open pipeline is current state ("what's open right now"), not a
  // period-scoped event — intentionally unbounded, same as forecastValue.
  const openPipeline = myOpps.filter((o) => OPEN_PIPELINE_STAGES.has(o.stage)).reduce((s, o) => s + opportunityValue(o), 0);

  const myRfqs = data.rfqs.filter((r) => r.sales_owner_id === userId);
  const rfqsReviewed = myRfqs.filter((r) => r.status !== "open" && inPeriod(r.updated_at, window)).length;

  const myTenders = data.tenders.filter((tt) => tt.tender_owner_id === userId);
  const tendersFollowed = myTenders.filter((tt) => inPeriod(tt.updated_at, window)).length;

  const myQuotes = data.quotations.filter((q) => q.owner_id === userId);
  const quotationsSent = myQuotes.filter((q) => SENT_QUOTATION_STATUSES.has(q.status) && inPeriod(q.updated_at, window)).length;

  const myFollowUps = data.followUps.filter((f) => f.owner_id === userId);
  const completedFollowUps = myFollowUps.filter((f) => f.status === "completed" && inPeriod(f.last_contact_at, window)).length;

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
  // teamActual is period-bounded because it is the sum of each salesperson's
  // (period-bounded) wonValue — see computeSalespersonMetrics.
  const perSalesperson = targets.map((t) =>
    computeSalespersonMetrics(t, { opportunities: data.opportunities, rfqs: data.rfqs, tenders: data.tenders, quotations: data.quotations, followUps: [] }),
  );
  const teamActual = perSalesperson.reduce((s, m) => s + m.wonValue, 0);

  // Pipeline by owner is current state, not period-scoped — same reasoning
  // as openPipeline/forecastValue above.
  const pipelineByOwner: Record<string, number> = {};
  for (const o of data.opportunities) {
    if (!o.owner_id || !OPEN_PIPELINE_STAGES.has(o.stage)) continue;
    pipelineByOwner[o.owner_id] = (pipelineByOwner[o.owner_id] ?? 0) + opportunityValue(o);
  }

  // Overdue is inherently a "right now" concept (due_date < today), not
  // scoped to any target period — intentionally unbounded.
  const overdueActionsByOwner: Record<string, number> = {};
  for (const f of data.actionFlags) {
    if (!f.action_owner_id || !f.due_date) continue;
    if (!OPEN_ACTION_STATUSES.has(f.status)) continue;
    if (f.due_date >= today) continue;
    overdueActionsByOwner[f.action_owner_id] = (overdueActionsByOwner[f.action_owner_id] ?? 0) + 1;
  }

  // Open Tier A opportunities is a current-state snapshot — unbounded.
  const tierAOpen = data.opportunities.filter((o) => o.tier === "A" && OPEN_PIPELINE_STAGES.has(o.stage));

  // RFQ / tender / quotation conversion rates are lifetime (company-wide,
  // all-time) ratios, not scoped to the current target period — this
  // matches the explicit Fix-1 scope, which does not list these three among
  // the metrics to bound. If a period-scoped version of these is wanted
  // later, it should be a distinct, separately-named metric rather than
  // changing what "RFQ conversion" means today.
  const closedRfqs = data.rfqs.filter((r) => r.status === "converted" || r.status === "lost");
  const rfqConversionPct =
    closedRfqs.length > 0 ? Math.round((closedRfqs.filter((r) => r.status === "converted").length / closedRfqs.length) * 100) : 0;

  const closedTenders = data.tenders.filter((tt) => tt.tender_stage === "converted_to_jih" || tt.tender_stage === "tender_lost_or_archived");
  const tenderConversionPct =
    closedTenders.length > 0
      ? Math.round((closedTenders.filter((tt) => tt.tender_stage === "converted_to_jih").length / closedTenders.length) * 100)
      : 0;

  const quotationWinRatePct = computeQuotationWinRatePct(data.quotations, 0) ?? 0;

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
