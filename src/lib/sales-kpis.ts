// =============================================================================
// PHC Sales OS — canonical Sales KPI engine (Phase 5).
//
// WHY THIS EXISTS
// ---------------
// KPIs were computed in three places with three different ideas of what a deal's
// state is:
//
//   targets-metrics.ts   filtered on the LEGACY `stage` enum
//                        (discovery/qualification/preparation/quotation/follow_up)
//   dashboard-helpers.ts counted Won as `stage === 'won'`
//   command-center.tsx   selected both columns and mixed them
//
// Phase 1 made `sales_stage` the canonical source and shipped
// resolveCanonicalStage() to read it safely (it is nullable, so legacy rows must
// fall back to `stage` rather than vanish). The analytics layer never adopted
// it. This module is the single canonical implementation, and every KPI here
// resolves state through resolveCanonicalStage.
//
// EVERY NUMBER EXPLAINS ITSELF
// ----------------------------
// A bare number on a dashboard is unauditable: nobody can tell which records
// made it, which stages counted, or which date field was used. So a KPI here is
// never a number — it is a `Kpi` carrying its formula, its inputs, the ids of
// the records that produced it, and a drilldown target. The UI renders the
// explanation from the same object it renders the value from, so the two cannot
// drift apart.
//
// Everything is pure. No Supabase, no React. See sales-kpis.test.ts.
// =============================================================================

import { CANONICAL_ACTIVE_STAGES, resolveCanonicalStage, type CanonicalStage } from "@/lib/stage-canonical";
import { msg, type MessageRef } from "@/lib/messages";

// ---- Inputs -----------------------------------------------------------------

export type OppRow = {
  id: string;
  project_name?: string | null;
  owner_id?: string | null;
  sales_stage?: string | null;
  stage?: string | null;
  tier?: string | null;
  contract_value?: number | string | null;
  quotation_value?: number | string | null;
  estimated_value_max?: number | string | null;
  human_win_probability?: number | null;
  // AI-side score. `score` is 0-100 and is what the scoring engine writes.
  score?: number | null;
  loss_reason?: string | null;
  lost_to_competitor?: string | null;
  lost_at_stage?: string | null;
  expected_contract_date?: string | null;
  /** Set when the opportunity was converted from a tender (Phase 3). */
  source_tender_id?: string | null;
  last_activity_at?: string | null;
  next_action?: string | null;
  /** On the table since the beginning; missing from this type until Phase 5.1
   *  §20, which is why "Next Action AND Next Action Date" could not be checked. */
  next_action_due?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  // Stamped at the transition by trg_stamp_outcome_dates. NULL = undated.
  won_at?: string | null;
  lost_at?: string | null;
};

// ---- The self-explaining KPI ------------------------------------------------

export type KpiKind = "currency" | "count" | "percent";

export type Kpi = {
  key: string;
  /** The computed value. `null` means genuinely unknown — never silently 0. */
  value: number | null;
  kind: KpiKind;
  /** Plain-language formula, shown in the tooltip. */
  formula: string;
  /** Which table/column the number came from. */
  source: string;
  /** Which canonical stages were counted, when that is the defining filter. */
  stages?: CanonicalStage[];
  /** Which date field bounded the period, or null for a current-state snapshot. */
  dateField: string | null;
  /** Human-readable description of the active filters. */
  filters: string[];
  /** How many records produced the number. */
  recordCount: number;
  /** The exact record ids — this is what makes the number auditable. */
  recordIds: string[];
  /** Where a click should go. */
  drilldown: DrilldownTarget | null;
  /** Set when the number is incomplete or rests on an assumption. A structured
   *  fact, not a sentence — see messages.ts for why. */
  caveat?: MessageRef;
  /**
   * Why the value is what it is. Omit and `metricStateOf` derives it; set it
   * when the builder knows something the derivation cannot see — chiefly the
   * difference between "nobody configured a target" and "the inputs are
   * missing", which both arrive here as value === null.
   */
  state?: MetricState;
  /** Where the reader goes to make this number computable. See MetricFix. */
  fix?: MetricFix;
};

export type DrilldownTarget = {
  to: string;
  search: Record<string, string>;
};

// ---- Metric states (Phase 5.1 §14) -----------------------------------------
//
// Five states, because a dashboard that renders all five as "0" or "—" is
// lying in four of them. The distinctions are not cosmetic:
//
//   ok              a real number, INCLUDING a real zero. "We won nothing this
//                   month" is knowledge, and must not look like ignorance.
//   no_data         no records at all matched. Nothing to compute over.
//   not_calculated  records exist, but an input they depend on is missing —
//                   the 45 opportunities with no probability are this.
//   not_configured  someone has to set something up first (no target row).
//   not_applicable  the metric is meaningless in this context.
//
// The reason this matters here specifically: on 2026-08-25 the book held 49
// opportunities with no probability and no target row, so Weighted Pipeline,
// Forecast and Coverage were all unknowable at once. Rendering that as
// "SAR 0" told a manager the pipeline was worthless.

export type MetricState =
  | "ok"
  | "no_data"
  | "not_calculated"
  | "not_configured"
  | "not_applicable";

/**
 * Where the reader goes to MAKE this metric computable.
 *
 * An empty state that only describes itself is a dead end, and four of them
 * side by side read as a broken page rather than an unfinished one. Every
 * not_calculated / not_configured metric carries the link that fills the gap,
 * scoped to the exact records that are missing the input.
 */
export type MetricFix = {
  /** i18n key for the call to action. */
  labelKey: string;
  to: string;
  search: Record<string, string>;
};

/**
 * The state of a metric. Derivation covers the common cases so existing
 * builders need no change; an explicit `state` always wins.
 */
export function metricStateOf(k: Pick<Kpi, "value" | "recordCount" | "state">): MetricState {
  if (k.state) return k.state;
  if (k.value !== null) return "ok";
  return k.recordCount === 0 ? "no_data" : "not_calculated";
}

// ---- Value resolution -------------------------------------------------------

export {
  opportunityValue,
  sumOpportunityValue,
  type OppValueFields,
} from "@/lib/opportunity-value";
import { opportunityValue } from "@/lib/opportunity-value";

export function canonicalStageOf(o: OppRow): CanonicalStage | null {
  return resolveCanonicalStage({ sales_stage: o.sales_stage, stage: o.stage }).stage;
}

// ---- Stage sets (PRD Phase 5 §4) -------------------------------------------

/** Terminal outcomes. Only `won` is ever Actual. */
export const WON_STAGES: CanonicalStage[] = ["won"];
export const LOST_STAGES: CanonicalStage[] = ["lost"];

/**
 * Open pipeline: everything that is neither won nor lost.
 *
 * `on_hold` is included deliberately — a paused deal is still in the pipeline,
 * it has simply stopped moving. Excluding it would make the pipeline shrink
 * whenever someone parks a deal, which reads as progress and is the opposite of
 * the truth.
 */
export const OPEN_STAGES: CanonicalStage[] = [
  "rfq_received",
  "jih",
  "jih_bafo",
  "under_negotiation",
  "verbally_awarded",
  "contract_received",
  "contract_signed",
  "on_hold",
];

/**
 * Late-stage exposure (PRD §18). These are NOT revenue and NOT Won — a verbal
 * award can still be lost. They are reported as a separate layer so nobody
 * reads them as money in the bank.
 */
export const LATE_STAGE_EXPOSURE: CanonicalStage[] = [
  "verbally_awarded",
  "contract_received",
  "contract_signed",
];

/**
 * Awarded work — what the business calls "we won it", which is broader than the
 * `won` stage alone.
 *
 * Client feedback 2026-08-25: the Awarded Projects nav entry pointed at
 * `stage=won` and showed "No results", because a JIH marked awarded lands on
 * `verbally_awarded` and then walks through contract_received and
 * contract_signed. Only the final administrative step writes `won`. Someone
 * looking for the deals they had just won was told there weren't any.
 *
 * This set is deliberately NOT the same thing as revenue: LATE_STAGE_EXPOSURE
 * exists precisely because a verbal award can still be lost, and the KPIs that
 * report money keep using WON_STAGES. This is a *list filter* — "show me the
 * work we've been awarded" — not a revenue definition.
 */
export const AWARDED_STAGES: CanonicalStage[] = [...LATE_STAGE_EXPOSURE, ...WON_STAGES];

// ---- The five management buckets (Phase 5.1 §1) ----------------------------
//
// Presentation over the canonical stages. This adds no stage, renames no
// stage, and changes no existing set — CANONICAL_STAGES is untouched.
//
// ⚠ NAME COLLISION, READ THIS BEFORE USING EITHER:
//
//   LATE_STAGE_EXPOSURE  = verbally_awarded + contract_received + contract_signed
//                          "awarded but not yet Won" — the PRD §18 exposure
//                          layer. It answers "how much could still be lost
//                          after we were told we won?"
//
//   MGMT_LATE_STAGE      = jih_bafo + under_negotiation
//                          "still being competed for, but near the end" — the
//                          management bucket. It answers "what is in the final
//                          commercial round?"
//
// Two different questions that English calls the same thing. They are NOT
// interchangeable and neither is wrong; the exposure set keeps its PRD meaning
// and its `late_stage` drilldown group, and this one is new.
//
// The five buckets are mutually exclusive by construction — every canonical
// stage appears in at most one — which is what makes it safe to add them up.
// on_hold and lost sit outside deliberately: a paused deal is not a position
// in the commercial ladder, and a lost one has left it.

export const MGMT_OPEN_PIPELINE: CanonicalStage[] = ["rfq_received", "jih"];
export const MGMT_LATE_STAGE: CanonicalStage[] = ["jih_bafo", "under_negotiation"];
export const MGMT_PENDING_CONTRACT: CanonicalStage[] = ["verbally_awarded"];
export const MGMT_CONTRACTED: CanonicalStage[] = ["contract_received", "contract_signed"];

export const MANAGEMENT_BUCKETS = [
  { key: "open_pipeline", stages: MGMT_OPEN_PIPELINE },
  { key: "late_stage", stages: MGMT_LATE_STAGE },
  { key: "pending_contract", stages: MGMT_PENDING_CONTRACT },
  { key: "contracted", stages: MGMT_CONTRACTED },
  { key: "won", stages: WON_STAGES },
] as const;

export type ManagementBucketKey = (typeof MANAGEMENT_BUCKETS)[number]["key"];

const inStages = (o: OppRow, set: CanonicalStage[]) => {
  const s = canonicalStageOf(o);
  return s !== null && set.includes(s);
};

export const isWon = (o: OppRow) => inStages(o, WON_STAGES);
export const isLost = (o: OppRow) => inStages(o, LOST_STAGES);
export const isOpen = (o: OppRow) => inStages(o, OPEN_STAGES);

// ---- Period filtering (PRD §16) --------------------------------------------

export type Period = { from: string; to: string; label: string };

/**
 * The correct date field per KPI. Using created_at for everything — the failure
 * the PRD calls out — would attribute a deal won this month to the month it was
 * first entered.
 *
 * `won_at` / `lost_at` are stamped once at the moment of transition by
 * trg_stamp_outcome_dates (20260820110000) and are never moved by a later edit.
 * Rows closed before that tracking existed have NULL and are reported as
 * undated — see wonUndated() — rather than being assigned a guessed month.
 */
export const DATE_FIELD = {
  won: "opportunities.won_at (stamped at the transition to won)",
  lost: "opportunities.lost_at (stamped at the transition to lost)",
  snapshot: null,
} as const;

/**
 * The award date, or null.
 *
 * It deliberately does NOT fall back to `updated_at`. That column moves on any
 * edit, so a deal won in March and re-saved in August would report as an August
 * win — wrong in a way nobody can see. A row with no stamped date is undated,
 * and the KPIs below say so out loud instead of inventing a month for it.
 */
export function wonDate(o: OppRow): string | null {
  return o.won_at ?? null;
}
export function lostDate(o: OppRow): string | null {
  return o.lost_at ?? null;
}

/** Half-open [from, to). ISO string compare — no Date parsing, no TZ drift. */
export function inPeriod(iso: string | null | undefined, p: Period | null): boolean {
  if (!p) return true;
  if (!iso) return false;
  return iso >= p.from && iso < p.to;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** `today` is YYYY-MM-DD so these are deterministic and testable. */
export function thisMonth(today: string): Period {
  const [y, m] = today.split("-").map(Number);
  return { from: ymd(y, m, 1), to: m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1), label: "This month" };
}

export function thisQuarter(today: string): Period {
  const [y, m] = today.split("-").map(Number);
  const qStart = Math.floor((m - 1) / 3) * 3 + 1;
  const qEnd = qStart + 3;
  return {
    from: ymd(y, qStart, 1),
    to: qEnd > 12 ? ymd(y + 1, 1, 1) : ymd(y, qEnd, 1),
    label: "This quarter",
  };
}

export function yearToDate(today: string): Period {
  const [y] = today.split("-").map(Number);
  return { from: ymd(y, 1, 1), to: ymd(y + 1, 1, 1), label: "Year to date" };
}

export function customRange(from: string, to: string): Period {
  return { from, to, label: `${from} → ${to}` };
}

// ---- Probability (PRD §5, §38) ---------------------------------------------

export type ProbabilitySource = "human" | "ai" | "none";

export type ResolvedProbability = {
  /** 0-1, or null when nothing is known. Never defaulted. */
  value: number | null;
  source: ProbabilitySource;
  label: string;
  human: number | null;
  ai: number | null;
  /** human - ai in percentage points, when both exist. */
  delta: number | null;
};

/**
 * Phase 3 deliberately split AI probability from the human/manager number.
 * Management Forecast prefers the human judgement and shows AI alongside it;
 * it never averages them, and it never invents a number when neither exists.
 *
 * The previous implementation applied a flat 0.2 weight to unscored deals. That
 * is worse than reporting nothing: it manufactures forecast out of ignorance and
 * is indistinguishable, downstream, from a real 20% estimate.
 */
export function resolveProbability(o: OppRow): ResolvedProbability {
  const human = typeof o.human_win_probability === "number" ? o.human_win_probability : null;
  const ai = typeof o.score === "number" ? o.score : null;
  const delta = human !== null && ai !== null ? human - ai : null;

  if (human !== null) {
    return { value: human / 100, source: "human", label: "Manager probability", human, ai, delta };
  }
  if (ai !== null) {
    return { value: ai / 100, source: "ai", label: "AI-estimated probability", human, ai, delta };
  }
  return { value: null, source: "none", label: "Unscored", human: null, ai: null, delta: null };
}

// ---- KPI builders -----------------------------------------------------------

function kpi(base: Omit<Kpi, "recordCount">): Kpi {
  const recordCount = base.recordIds.length;
  // A SUM over zero rows is not zero money — there is nothing to add up.
  //
  // Found on screen, 2026-08-26: "WON (OFFICIAL) SAR 0 · 0 records" sat a
  // hundred pixels from "WON · No data yet · 0 records". Same fact, two
  // renderings, because bucketKpi set its state explicitly and the older
  // builders let the derivation see a 0 and call it real. §14 says these five
  // states are standard; two spellings of one state is the defect it names.
  //
  // Counts are deliberately untouched: zero open deals IS a count of zero.
  const state =
    base.state ?? (base.kind === "currency" && recordCount === 0 ? "no_data" : undefined);
  return { ...base, recordCount, ...(state ? { state } : {}) };
}

const sumValues = (rows: OppRow[]) =>
  rows.reduce((s, o) => s + (opportunityValue(o) ?? 0), 0);

const OPP_LIST = "/opportunities";

export type KpiContext = {
  today: string;
  period: Period | null;
  /** Restricts every KPI to one owner. Null = whole team (role-gated upstream). */
  ownerId?: string | null;
};

function ownerFiltered(opps: OppRow[], ctx: KpiContext): OppRow[] {
  return ctx.ownerId ? opps.filter((o) => o.owner_id === ctx.ownerId) : opps;
}

function filterLabels(ctx: KpiContext, extra: string[] = []): string[] {
  const f = [...extra];
  if (ctx.period) f.push(`Period: ${ctx.period.label}`);
  else f.push("Current snapshot (no period filter)");
  if (ctx.ownerId) f.push("Owner: selected salesperson");
  return f;
}

/** Official Won. Only sales_stage = won. Nothing earlier counts. */
export function wonValue(opps: OppRow[], ctx: KpiContext): Kpi {
  const allWon = ownerFiltered(opps, ctx).filter(isWon);
  const undated = allWon.filter((o) => wonDate(o) === null);
  // With no period this is the lifetime total, so undated deals belong in it.
  // With a period they cannot be placed in time, so they are held out of the
  // window and reported separately — never dropped, never assigned a month.
  const rows = ctx.period ? allWon.filter((o) => inPeriod(wonDate(o), ctx.period)) : allWon;

  return kpi({
    key: "won_value",
    value: sumValues(rows),
    kind: "currency",
    formula: "Σ value of opportunities where canonical stage = won",
    source: "opportunities (contract_value → quotation_value → estimated_value_max)",
    stages: WON_STAGES,
    dateField: ctx.period ? DATE_FIELD.won : null,
    filters: filterLabels(ctx, ["Stage: won only — verbal award / contract received / contract signed excluded"]),
    recordIds: rows.map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage: "won" } },
    caveat:
      undated.length > 0
        ? ctx.period
          ? msg("cav_won_undated_outside_period", { count: undated.length })
          : msg("cav_won_undated", { count: undated.length })
        : undefined,
  });
}

/**
 * The Won that a date range cannot place. Surfaced as its own KPI so a manager
 * comparing months can see what is missing from the comparison rather than
 * wondering why the months do not add up to the total.
 */
export function wonUndated(opps: OppRow[], ctx: KpiContext): Kpi {
  const rows = ownerFiltered(opps, ctx).filter((o) => isWon(o) && wonDate(o) === null);
  return kpi({
    key: "won_undated",
    value: sumValues(rows),
    kind: "currency",
    formula: "Σ value of won opportunities with no recorded award date",
    source: "opportunities.won_at IS NULL",
    stages: WON_STAGES,
    dateField: null,
    filters: filterLabels({ ...ctx, period: null }, [
      "Counted in the lifetime total, excluded from any date range — the date is unknown, not zero",
    ]),
    recordIds: rows.map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage: "won" } },
    caveat: rows.length > 0 ? msg("cav_predate_outcome_tracking") : undefined,
  });
}

export function lostValue(opps: OppRow[], ctx: KpiContext): Kpi {
  const allLost = ownerFiltered(opps, ctx).filter(isLost);
  const undated = allLost.filter((o) => lostDate(o) === null);
  const rows = ctx.period ? allLost.filter((o) => inPeriod(lostDate(o), ctx.period)) : allLost;
  return kpi({
    key: "lost_value",
    value: sumValues(rows),
    kind: "currency",
    formula: "Σ value of opportunities where canonical stage = lost",
    source: "opportunities",
    stages: LOST_STAGES,
    dateField: ctx.period ? DATE_FIELD.lost : null,
    filters: filterLabels(ctx),
    recordIds: rows.map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage: "lost" } },
    caveat: undated.length > 0 ? msg("cav_lost_undated", { count: undated.length }) : undefined,
  });
}

/** Open pipeline is a snapshot of now — never period-bounded. */
export function openPipeline(opps: OppRow[], ctx: KpiContext): Kpi {
  const rows = ownerFiltered(opps, ctx).filter(isOpen);
  const unvalued = rows.filter((o) => opportunityValue(o) === null).length;
  return kpi({
    key: "open_pipeline",
    value: sumValues(rows),
    kind: "currency",
    formula: "Σ value of opportunities that are neither won nor lost",
    source: "opportunities",
    stages: OPEN_STAGES,
    dateField: null,
    filters: filterLabels({ ...ctx, period: null }, ["On-hold deals are included — paused is still in the pipeline"]),
    recordIds: rows.map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage: "open" } },
    caveat: unvalued > 0 ? msg("cav_unvalued_contribute_zero", { count: unvalued, total: rows.length }) : undefined,
  });
}

/**
 * Weighted pipeline. Unscored deals are EXCLUDED from the total and reported in
 * the caveat rather than weighted at some invented default.
 */
export function weightedPipeline(opps: OppRow[], ctx: KpiContext): Kpi {
  const open = ownerFiltered(opps, ctx).filter(isOpen);
  const scored = open.filter((o) => resolveProbability(o).value !== null);
  const unscored = open.length - scored.length;
  const humanCount = scored.filter((o) => resolveProbability(o).source === "human").length;

  const total = scored.reduce((s, o) => {
    const p = resolveProbability(o).value ?? 0;
    return s + (opportunityValue(o) ?? 0) * p;
  }, 0);

  // "SAR 0" is only honest when zero is what we KNOW. One deal scored at 0%
  // beside 48 unscored ones sums to 0 and renders as a confident nothing —
  // which is the exact figure the 2026-08-25 review flagged as making the
  // pipeline look worthless. A zero total that rests on a minority of the book
  // is not a zero, it is an absence.
  const zeroRestingOnIgnorance = scored.length > 0 && total === 0 && unscored > 0;
  const computable = scored.length > 0 && !zeroRestingOnIgnorance;

  return kpi({
    key: "weighted_pipeline",
    value: computable ? total : null,
    kind: "currency",
    formula: "Σ (open opportunity value × probability), manager probability preferred over AI",
    source: "opportunities.human_win_probability, else opportunities.score",
    stages: OPEN_STAGES,
    dateField: null,
    filters: filterLabels({ ...ctx, period: null }, [
      `${humanCount} weighted on manager probability, ${scored.length - humanCount} on AI-estimated probability`,
    ]),
    recordIds: scored.map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage: "open" } },
    state: open.length === 0 ? "no_data" : computable ? "ok" : "not_calculated",
    caveat: unscored > 0 ? msg("cav_probability_missing", { count: unscored }) : undefined,
    ...(unscored > 0
      ? { fix: { labelKey: "fix_add_probability", to: OPP_LIST, search: { stage: "open", missing: "probability" } } }
      : {}),
  });
}

/** Late-stage exposure — explicitly NOT revenue and NOT Won. */
export function lateStageExposure(opps: OppRow[], ctx: KpiContext): Kpi {
  const rows = ownerFiltered(opps, ctx).filter((o) => inStages(o, LATE_STAGE_EXPOSURE));
  return kpi({
    key: "late_stage_exposure",
    value: sumValues(rows),
    kind: "currency",
    formula: "Σ value at verbally_awarded + contract_received + contract_signed",
    source: "opportunities",
    stages: LATE_STAGE_EXPOSURE,
    dateField: null,
    filters: filterLabels({ ...ctx, period: null }, [
      "Exposure, not revenue — these deals can still be lost and do not count toward target",
    ]),
    recordIds: rows.map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage: "late_stage" } },
  });
}

/**
 * Win rate = Won / (Won + Lost). Open deals are NOT in the denominator, and it
 * is never computed from quotations.
 *
 * Returns null when nothing has closed — 0% would claim every deal was lost.
 */
export function winRate(opps: OppRow[], ctx: KpiContext): Kpi {
  const scope = ownerFiltered(opps, ctx);
  // Undated closures are excluded from a period rate for the same reason they
  // are excluded from period Won: they cannot be placed in time. The caveat
  // reports them so the denominator is never silently short.
  const won = scope.filter((o) => isWon(o) && (ctx.period ? inPeriod(wonDate(o), ctx.period) : true));
  const lost = scope.filter((o) => isLost(o) && (ctx.period ? inPeriod(lostDate(o), ctx.period) : true));
  const undatedClosed = ctx.period
    ? scope.filter((o) => (isWon(o) && wonDate(o) === null) || (isLost(o) && lostDate(o) === null)).length
    : 0;
  const closed = won.length + lost.length;
  return kpi({
    key: "win_rate",
    value: closed > 0 ? Math.round((won.length / closed) * 100) : null,
    kind: "percent",
    formula: "Won ÷ (Won + Lost) — open opportunities are excluded from the denominator",
    source: "opportunities canonical stage",
    stages: [...WON_STAGES, ...LOST_STAGES],
    dateField: ctx.period ? DATE_FIELD.won : null,
    filters: filterLabels(ctx, ["Not derived from quotations"]),
    recordIds: [...won, ...lost].map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage: "closed" } },
    caveat:
      closed === 0
        ? msg("cav_nothing_closed")
        : undatedClosed > 0
          ? msg("cav_closed_undated", { count: undatedClosed })
          : undefined,
  });
}

export function lossRate(opps: OppRow[], ctx: KpiContext): Kpi {
  const w = winRate(opps, ctx);
  return kpi({
    key: "loss_rate",
    value: w.value === null ? null : 100 - w.value,
    kind: "percent",
    formula: "Lost ÷ (Won + Lost)",
    source: w.source,
    stages: w.stages,
    dateField: w.dateField,
    filters: w.filters,
    recordIds: w.recordIds,
    drilldown: { to: OPP_LIST, search: { stage: "lost" } },
    caveat: w.caveat,
  });
}

/** Count of open opportunities sitting at one canonical stage. */
export function stageCount(opps: OppRow[], ctx: KpiContext, stage: CanonicalStage): Kpi {
  const rows = ownerFiltered(opps, ctx).filter((o) => canonicalStageOf(o) === stage);
  return kpi({
    key: `stage_${stage}`,
    value: rows.length,
    kind: "count",
    formula: `Count of opportunities whose canonical stage is ${stage}`,
    source: "opportunities.sales_stage (legacy stage used only as documented fallback)",
    stages: [stage],
    dateField: null,
    filters: filterLabels({ ...ctx, period: null }),
    recordIds: rows.map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage } },
  });
}

// ---- Target achievement (PRD §17) ------------------------------------------

export type TargetKpis = {
  target: Kpi;
  actual: Kpi;
  achievement: Kpi;
  gap: Kpi;
};

/**
 * Actual is Won only. Late-stage exposure is reported separately and never
 * folded in — that is the difference between "sold" and "probably sold".
 */
export function targetKpis(opps: OppRow[], ctx: KpiContext, targetAmount: number | null): TargetKpis {
  const actual = wonValue(opps, ctx);
  const actualValue = actual.value ?? 0;
  const hasTarget = typeof targetAmount === "number" && targetAmount > 0;

  const base = {
    kind: "currency" as const,
    source: "sales_targets",
    dateField: ctx.period ? DATE_FIELD.won : null,
    filters: filterLabels(ctx),
    recordIds: [] as string[],
    drilldown: null,
  };

  return {
    target: kpi({
      ...base,
      key: "target",
      value: hasTarget ? targetAmount : null,
      formula: "Sales target for the selected period and owner",
      caveat: hasTarget ? undefined : msg("cav_no_target"),
    }),
    actual: { ...actual, key: "target_actual" },
    achievement: kpi({
      ...base,
      key: "target_achievement",
      value: hasTarget ? Math.round((actualValue / targetAmount) * 100) : null,
      kind: "percent",
      formula: "Won value ÷ target — Won only, excluding verbal award and contract stages",
      caveat: hasTarget ? undefined : msg("cav_no_target_achievement"),
    }),
    gap: kpi({
      ...base,
      key: "target_gap",
      value: hasTarget ? Math.max(0, targetAmount - actualValue) : null,
      formula: "max(0, target − won value)",
      caveat: hasTarget ? undefined : msg("cav_no_target_gap"),
    }),
  };
}

// ---- Lost analysis (PRD §20) -----------------------------------------------

export type LostBreakdown = {
  key: string;
  label: string;
  count: number;
  value: number;
  recordIds: string[];
};

function groupLost(
  opps: OppRow[],
  ctx: KpiContext,
  pick: (o: OppRow) => string | null,
  unknownLabel: string,
): LostBreakdown[] {
  const rows = ownerFiltered(opps, ctx).filter((o) => isLost(o) && inPeriod(lostDate(o), ctx.period));
  const map = new Map<string, LostBreakdown>();
  for (const o of rows) {
    // Missing stays "Unknown" — never folded into an existing bucket, which
    // would overstate whichever reason happened to be first.
    const raw = pick(o);
    const key = raw && raw.trim() !== "" ? raw : "__unknown__";
    const label = key === "__unknown__" ? unknownLabel : key;
    const b = map.get(key) ?? { key, label, count: 0, value: 0, recordIds: [] };
    b.count += 1;
    b.value += opportunityValue(o) ?? 0;
    b.recordIds.push(o.id);
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => b.value - a.value || b.count - a.count);
}

export const lostByReason = (o: OppRow[], c: KpiContext) =>
  groupLost(o, c, (x) => x.loss_reason ?? null, "Reason not recorded");

export const lostByStage = (o: OppRow[], c: KpiContext) =>
  groupLost(o, c, (x) => x.lost_at_stage ?? null, "Stage not recorded");

export const lostByOwner = (o: OppRow[], c: KpiContext) =>
  groupLost(o, c, (x) => x.owner_id ?? null, "Unassigned");

/**
 * Competitors are only reported where a name was actually recorded. Nothing is
 * inferred — an unnamed loss is not evidence that a competitor won it.
 */
export const lostToCompetitor = (o: OppRow[], c: KpiContext) =>
  groupLost(o, c, (x) => x.lost_to_competitor ?? null, "No competitor recorded")
    .filter((b) => b.key !== "__unknown__");

// ---- Pipeline health (PRD §19) ---------------------------------------------

export type HealthIssue =
  | "no_next_action"
  | "no_next_action_date"
  | "no_recent_crm_activity"
  | "expected_close_overdue"
  | "high_value_low_probability"
  | "unscored";

export type HealthFinding = {
  issue: HealthIssue;
  opportunityId: string;
  label: string;
  detail: string;
  value: number | null;
};

export type HealthThresholds = {
  stalledDays: number;
  highValue: number;
  lowProbabilityPct: number;
};

export const DEFAULT_HEALTH: HealthThresholds = {
  stalledDays: 14,
  highValue: 500_000,
  lowProbabilityPct: 30,
};

function daysBetween(fromIso: string, today: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Deterministic only. Every finding is a fact about the record, so a manager can
 * verify it by opening the deal — no scoring, no inference, nothing an AI
 * produced.
 */
export function pipelineHealth(
  opps: OppRow[],
  ctx: KpiContext,
  t: HealthThresholds = DEFAULT_HEALTH,
): HealthFinding[] {
  const out: HealthFinding[] = [];
  for (const o of ownerFiltered(opps, ctx).filter(isOpen)) {
    // on_hold is open pipeline (it still counts as money in play) but it is not
    // ACTIVE, and demanding a next action on a deliberately parked deal is how
    // a hygiene queue teaches people to ignore it.
    const active = CANONICAL_ACTIVE_STAGES.includes(canonicalStageOf(o) as CanonicalStage);
    const label = o.project_name ?? o.id.slice(0, 8);
    const value = opportunityValue(o);
    const prob = resolveProbability(o);

    // §20 — an action with no date is not a plan, it is a wish. Both halves are
    // checked, and they are separate findings because they need different fixes.
    if (active && (!o.next_action || o.next_action.trim() === "")) {
      out.push({ issue: "no_next_action", opportunityId: o.id, label, detail: "No next action set", value });
    } else if (active && !o.next_action_due || String(o.next_action_due).trim() === "") {
      out.push({
        issue: "no_next_action_date",
        opportunityId: o.id,
        label,
        detail: "Next action has no date",
        value,
      });
    }
    // NOT "stalled". This reads `last_activity_at`, which is stamped by any
    // logged activity — internal notes and unsent drafts included — so it
    // measures how long since anyone TOUCHED THE RECORD, not how long since
    // anyone spoke to the client.
    //
    // It used to be reported as `stalled`, against a 14-day threshold this
    // codebase chose. On 2026-08-26 that had the brief announcing "46 stalled"
    // three inches above a roll-up reading 0, because the attention engine had
    // been corrected and this had not. Stalled has ONE owner now — the
    // attention engine, which requires verified client contact and an approved
    // SLA — and this reports the weaker fact under its own honest name.
    if (o.last_activity_at) {
      const d = daysBetween(o.last_activity_at, ctx.today);
      if (d >= t.stalledDays) {
        out.push({
          issue: "no_recent_crm_activity",
          opportunityId: o.id,
          label,
          detail: `No CRM activity logged for ${d} days`,
          value,
        });
      }
    }
    if (o.expected_contract_date && o.expected_contract_date < ctx.today) {
      out.push({
        issue: "expected_close_overdue",
        opportunityId: o.id,
        label,
        detail: `Expected close ${o.expected_contract_date} has passed`,
        value,
      });
    }
    if (prob.value === null) {
      out.push({ issue: "unscored", opportunityId: o.id, label, detail: "No probability recorded", value });
    } else if (value !== null && value >= t.highValue && prob.value * 100 <= t.lowProbabilityPct) {
      out.push({
        issue: "high_value_low_probability",
        opportunityId: o.id,
        label,
        detail: `High value at ${Math.round(prob.value * 100)}% (${prob.label})`,
        value,
      });
    }
  }
  return out;
}

/** Concentration — how much of the pipeline sits in one place. */
export type Concentration = { key: string; label: string; value: number; sharePct: number; recordIds: string[] };

export function concentrationBy(
  opps: OppRow[],
  ctx: KpiContext,
  pick: (o: OppRow) => string | null,
  unknownLabel = "Unassigned",
): Concentration[] {
  const rows = ownerFiltered(opps, ctx).filter(isOpen);
  const total = sumValues(rows);
  const map = new Map<string, Concentration>();
  for (const o of rows) {
    const raw = pick(o);
    const key = raw && raw.trim() !== "" ? raw : "__unknown__";
    const c = map.get(key) ?? {
      key,
      label: key === "__unknown__" ? unknownLabel : key,
      value: 0,
      sharePct: 0,
      recordIds: [],
    };
    c.value += opportunityValue(o) ?? 0;
    c.recordIds.push(o.id);
    map.set(key, c);
  }
  const list = [...map.values()];
  for (const c of list) c.sharePct = total > 0 ? Math.round((c.value / total) * 100) : 0;
  return list.sort((a, b) => b.value - a.value);
}

// ---- Executive rollup -------------------------------------------------------

export type ExecutiveKpis = {
  openPipeline: Kpi;
  wonUndated: Kpi;
  weightedPipeline: Kpi;
  wonValue: Kpi;
  lostValue: Kpi;
  winRate: Kpi;
  lossRate: Kpi;
  lateStageExposure: Kpi;
  byStage: Kpi[];
};

const EXEC_STAGES: CanonicalStage[] = [
  "rfq_received",
  "jih",
  "jih_bafo",
  "under_negotiation",
  "verbally_awarded",
  "contract_received",
  "contract_signed",
  "on_hold",
];

export function executiveKpis(opps: OppRow[], ctx: KpiContext): ExecutiveKpis {
  return {
    openPipeline: openPipeline(opps, ctx),
    wonUndated: wonUndated(opps, ctx),
    weightedPipeline: weightedPipeline(opps, ctx),
    wonValue: wonValue(opps, ctx),
    lostValue: lostValue(opps, ctx),
    winRate: winRate(opps, ctx),
    lossRate: lossRate(opps, ctx),
    lateStageExposure: lateStageExposure(opps, ctx),
    byStage: EXEC_STAGES.map((s) => stageCount(opps, ctx, s)),
  };
}

// ---- The commercial book, as the sales team describes it --------------------
//
// Client feedback 2026-08-25 (slide 4). The Opportunities page led with Open
// Value / Tier A / Win Rate / Showing. Two of those were structurally stuck —
// Tier A read 0 because tiers are unset, Win Rate read 0% because nothing has
// been closed in the system yet — so the strip spent half its width telling a
// manager nothing, twice. What was asked for instead is the number set the
// team actually runs on: the target, what has been won against it, what is
// still owed, and what is sitting unsubmitted.
//
// These read two things the KPI engine did not previously touch: the RFQ's
// JIH/Tender classification and whether a quotation has gone out. Both are
// PostgREST embeds the Opportunities list already fetches; the shapes below
// mirror that query rather than inventing a second one.

export type ClassifiedRow = OppRow & {
  rfqs?: Array<{ classification?: string | null; created_at?: string | null }> | null;
  quotations?: Array<{ status?: string | null }> | null;
};

export type Classification = "jih" | "tender" | "other";

/**
 * The newest RFQ wins. An opportunity can accumulate more than one — a tender
 * that was re-issued, an RFQ superseded by a revision — and the current answer
 * is the latest one, which is the same rule the detail page's card uses.
 */
export function classificationOf(o: ClassifiedRow): Classification | null {
  const rfqs = (o.rfqs ?? []).filter((r) => r?.classification);
  if (rfqs.length === 0) return null;
  const newest = rfqs.reduce((a, b) => ((b.created_at ?? "") > (a.created_at ?? "") ? b : a));
  const c = newest.classification;
  return c === "jih" || c === "tender" || c === "other" ? c : null;
}

/**
 * Statuses that mean the quotation has left the building. Everything before
 * `submitted` — draft, internal review, approved-for-submission — is work we
 * still owe the client, which is what "pending for submission" names.
 *
 * `lost` and `expired` are included deliberately: they are outcomes OF a
 * submission. A lost quotation is not a quotation still to be sent.
 */
const SUBMITTED_QUOTATION_STATUSES = [
  "submitted",
  "follow_up",
  "negotiation",
  "revised",
  "won",
  "lost",
  "expired",
];

export function hasSubmittedQuotation(o: ClassifiedRow): boolean {
  return (o.quotations ?? []).some((q) => q?.status != null && SUBMITTED_QUOTATION_STATUSES.includes(q.status));
}

/** Open opportunities where a quotation has not yet gone out. */
export function pendingSubmissionRows(opps: ClassifiedRow[], ctx: KpiContext): ClassifiedRow[] {
  return ownerFiltered(opps, ctx).filter((o) => isOpen(o) && !hasSubmittedQuotation(o));
}

function classificationCount(
  opps: ClassifiedRow[],
  ctx: KpiContext,
  which: Classification,
): Kpi {
  const rows = ownerFiltered(opps, ctx).filter((o) => isOpen(o) && classificationOf(o) === which);
  const unclassified = ownerFiltered(opps, ctx).filter((o) => isOpen(o) && classificationOf(o) === null);
  return kpi({
    key: `classification_${which}`,
    value: rows.length,
    kind: "count",
    formula: `Count of open opportunities classified ${which}`,
    source: "rfqs.classification (newest RFQ per opportunity)",
    stages: OPEN_STAGES,
    dateField: null,
    filters: filterLabels({ ...ctx, period: null }, [`Classification: ${which}`]),
    recordIds: rows.map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage: "open" } },
    // Not cosmetic. JIH + Tender only add up to the open book when every
    // opportunity has been classified, and on 2026-08-25 most had not — the
    // list's JIH/Tender column was a column of dashes. Saying so is the
    // difference between "we have 9 JIHs" and "we have at least 9".
    caveat:
      unclassified.length > 0 ? msg("cav_unclassified_neither", { count: unclassified.length }) : undefined,
  });
}

function pendingCount(opps: ClassifiedRow[], ctx: KpiContext, which: Classification | null): Kpi {
  const all = pendingSubmissionRows(opps, ctx);
  const rows = which === null ? all : all.filter((o) => classificationOf(o) === which);
  const unclassified = all.filter((o) => classificationOf(o) === null);
  return kpi({
    key: which === null ? "pending_submission" : `pending_submission_${which}`,
    value: rows.length,
    kind: "count",
    formula:
      which === null
        ? "Count of open opportunities with no quotation at submitted or beyond"
        : `Count of open ${which} opportunities with no quotation at submitted or beyond`,
    source: "opportunities × quotations.status, rfqs.classification",
    stages: OPEN_STAGES,
    dateField: null,
    filters: filterLabels({ ...ctx, period: null }, ["Quotation: not yet submitted"]),
    recordIds: rows.map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage: "open" } },
    caveat:
      which === null && unclassified.length > 0
        ? msg("cav_unclassified_do_not_sum", { count: unclassified.length })
        : undefined,
  });
}

export type CommercialBookKpis = {
  /** Sales target for the period. Null when nobody has set one. */
  target: Kpi;
  /** Won value — what has been achieved against the target. */
  achievement: Kpi;
  /** Target minus achievement. */
  needToClose: Kpi;
  verballyAwarded: Kpi;
  jih: Kpi;
  tenders: Kpi;
  jihPending: Kpi;
  tenderPending: Kpi;
  pendingForSubmission: Kpi;
};

export function commercialBookKpis(
  opps: ClassifiedRow[],
  ctx: KpiContext,
  targetAmount: number | null,
): CommercialBookKpis {
  const targets = targetKpis(opps, ctx, targetAmount);
  return {
    target: targets.target,
    achievement: { ...targets.actual, key: "sales_achievement" },
    needToClose: { ...targets.gap, key: "need_to_close" },
    verballyAwarded: stageCount(opps, ctx, "verbally_awarded"),
    jih: classificationCount(opps, ctx, "jih"),
    tenders: classificationCount(opps, ctx, "tender"),
    jihPending: pendingCount(opps, ctx, "jih"),
    tenderPending: pendingCount(opps, ctx, "tender"),
    pendingForSubmission: pendingCount(opps, ctx, null),
  };
}

// ---- Management view of the book (Phase 5.1 §1, §2, §4, §5) ----------------

const FIX_PROBABILITY: MetricFix = {
  labelKey: "fix_add_probability",
  to: "/opportunities",
  search: { stage: "open", missing: "probability" },
};

const FIX_TARGET: MetricFix = { labelKey: "fix_set_target", to: "/targets", search: {} };

/** Value and count for one management bucket. */
export function bucketKpi(opps: OppRow[], ctx: KpiContext, bucket: ManagementBucketKey): Kpi {
  const def = MANAGEMENT_BUCKETS.find((b) => b.key === bucket)!;
  const rows = ownerFiltered(opps, ctx).filter((o) => inStages(o, def.stages as CanonicalStage[]));
  const priced = rows.filter((o) => opportunityValue(o) !== null);
  return kpi({
    key: `bucket_${bucket}`,
    // A bucket with rows but no priced row is not worth zero — it is unpriced.
    value: rows.length === 0 ? 0 : priced.length === 0 ? null : sumValues(priced),
    kind: "currency",
    formula: `Σ value of opportunities in ${def.stages.join(" / ")}`,
    source: "opportunities (contract_value → quotation_value → estimated_value_max)",
    stages: def.stages as CanonicalStage[],
    dateField: null,
    filters: filterLabels({ ...ctx, period: null }, [`Bucket: ${bucket}`]),
    recordIds: rows.map((o) => o.id),
    drilldown: { to: OPP_LIST, search: { stage: def.stages.join(",") } },
    state: rows.length === 0 ? "no_data" : priced.length === 0 ? "not_calculated" : "ok",
    ...(rows.length > 0 && priced.length < rows.length
      ? {
          caveat: msg("cav_counted_not_summed", { count: rows.length - priced.length, total: rows.length }),
          fix: { labelKey: "fix_add_value", to: OPP_LIST, search: { stage: "open", missing: "value" } },
        }
      : {}),
  });
}

/**
 * Pipeline coverage — weighted pipeline ÷ target.
 *
 * Reported as a multiple (2.0x), not a percentage, because that is how sales
 * management reads it: "how many times over could the qualified pipeline cover
 * what we promised?" Below 1.0x the target cannot be met even if every open
 * deal closes at its stated probability.
 */
export function pipelineCoverage(opps: OppRow[], ctx: KpiContext, targetAmount: number | null): Kpi {
  const weighted = weightedPipeline(opps, ctx);
  const hasTarget = typeof targetAmount === "number" && targetAmount > 0;
  const computable = hasTarget && weighted.value !== null;

  return kpi({
    key: "pipeline_coverage",
    value: computable ? Math.round((weighted.value! / targetAmount!) * 100) / 100 : null,
    kind: "count",
    formula: "Weighted pipeline ÷ sales target, as a multiple",
    source: "opportunities × probability, sales_targets.sales_target",
    stages: OPEN_STAGES,
    dateField: null,
    filters: filterLabels(ctx),
    recordIds: weighted.recordIds,
    drilldown: { to: OPP_LIST, search: { stage: "open" } },
    // Two different cures, so two different states. Telling a manager to "set a
    // target" when the real gap is 45 unscored deals wastes the one action
    // they were willing to take.
    state: !hasTarget ? "not_configured" : weighted.value === null ? "not_calculated" : "ok",
    caveat: !hasTarget ? msg("cav_no_target") : weighted.value === null ? weighted.caveat : undefined,
    ...(!hasTarget ? { fix: FIX_TARGET } : weighted.value === null ? { fix: FIX_PROBABILITY } : {}),
  });
}

export type ForecastVsTarget = {
  target: Kpi;
  won: Kpi;
  forecast: Kpi;
  achievement: Kpi;
  gap: Kpi;
  coverage: Kpi;
};

/**
 * The six numbers a sales manager runs the month on.
 *
 * Forecast is the WEIGHTED pipeline, not the gross — a forecast that ignores
 * probability is just the pipeline again under a more confident name. Won is
 * Won only; late-stage exposure is reported separately and never folded in.
 */
export function forecastVsTarget(
  opps: OppRow[],
  ctx: KpiContext,
  targetAmount: number | null,
): ForecastVsTarget {
  const t = targetKpis(opps, ctx, targetAmount);
  const weighted = weightedPipeline(opps, ctx);
  const hasTarget = typeof targetAmount === "number" && targetAmount > 0;

  return {
    target: {
      ...t.target,
      state: hasTarget ? "ok" : "not_configured",
      ...(hasTarget ? {} : { fix: FIX_TARGET }),
    },
    won: { ...t.actual, key: "forecast_won" },
    forecast: {
      ...weighted,
      key: "forecast_value",
      ...(weighted.value === null ? { fix: FIX_PROBABILITY } : {}),
    },
    achievement: {
      ...t.achievement,
      state: hasTarget ? "ok" : "not_configured",
      ...(hasTarget ? {} : { fix: FIX_TARGET }),
    },
    gap: {
      ...t.gap,
      state: hasTarget ? "ok" : "not_configured",
      ...(hasTarget ? {} : { fix: FIX_TARGET }),
    },
    coverage: pipelineCoverage(opps, ctx, targetAmount),
  };
}
