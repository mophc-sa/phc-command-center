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

import { resolveCanonicalStage, type CanonicalStage } from "@/lib/stage-canonical";

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
  /** Set when the number is incomplete or rests on an assumption. */
  caveat?: string;
};

export type DrilldownTarget = {
  to: string;
  search: Record<string, string>;
};

// ---- Value resolution -------------------------------------------------------

/** Just the three money columns — see opportunityValue. */
export type OppValueFields = Pick<OppRow, "contract_value" | "quotation_value" | "estimated_value_max">;

/**
 * The money figure for an opportunity, most-committed first.
 *
 * contract_value is what was actually contracted; quotation_value is what was
 * quoted; estimated_value_max is a guess. Returning null (not 0) when all three
 * are absent matters: a deal with no value is not a deal worth nothing, and
 * summing it as 0 silently understates the pipeline.
 *
 * Takes only those three fields rather than a whole OppRow. Every caller that
 * merely wants the money — computeJihPipelineTotal among them — would otherwise
 * have to fetch and pass an `id` it has no use for.
 */
export function opportunityValue(o: OppValueFields): number | null {
  for (const v of [o.contract_value, o.quotation_value, o.estimated_value_max]) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

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
  return { ...base, recordCount: base.recordIds.length };
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
          ? `${undated.length} won ${undated.length === 1 ? "deal has" : "deals have"} no recorded award date and sit outside this period — see Won (undated)`
          : `${undated.length} won ${undated.length === 1 ? "deal has" : "deals have"} no recorded award date`
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
    caveat: rows.length > 0 ? "These pre-date outcome-date tracking; no date was invented for them" : undefined,
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
    caveat: undated.length > 0 ? `${undated.length} lost ${undated.length === 1 ? "deal has" : "deals have"} no recorded close date` : undefined,
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
    caveat: unvalued > 0 ? `${unvalued} of ${rows.length} have no value recorded and contribute 0` : undefined,
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

  return kpi({
    key: "weighted_pipeline",
    value: scored.length > 0 ? total : null,
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
    caveat:
      unscored > 0
        ? `${unscored} open ${unscored === 1 ? "deal has" : "deals have"} no probability and are excluded rather than assumed`
        : undefined,
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
        ? "Nothing has closed in this period — a rate cannot be computed"
        : undatedClosed > 0
          ? `${undatedClosed} closed ${undatedClosed === 1 ? "deal has" : "deals have"} no recorded date and are not in this rate`
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
      caveat: hasTarget ? undefined : "No target has been set for this period",
    }),
    actual: { ...actual, key: "target_actual" },
    achievement: kpi({
      ...base,
      key: "target_achievement",
      value: hasTarget ? Math.round((actualValue / targetAmount) * 100) : null,
      kind: "percent",
      formula: "Won value ÷ target — Won only, excluding verbal award and contract stages",
      caveat: hasTarget ? undefined : "Cannot compute achievement without a target",
    }),
    gap: kpi({
      ...base,
      key: "target_gap",
      value: hasTarget ? Math.max(0, targetAmount - actualValue) : null,
      formula: "max(0, target − won value)",
      caveat: hasTarget ? undefined : "Cannot compute a gap without a target",
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
  | "stalled"
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
    const label = o.project_name ?? o.id.slice(0, 8);
    const value = opportunityValue(o);
    const prob = resolveProbability(o);

    if (!o.next_action || o.next_action.trim() === "") {
      out.push({ issue: "no_next_action", opportunityId: o.id, label, detail: "No next action set", value });
    }
    if (o.last_activity_at) {
      const d = daysBetween(o.last_activity_at, ctx.today);
      if (d >= t.stalledDays) {
        out.push({ issue: "stalled", opportunityId: o.id, label, detail: `No activity for ${d} days`, value });
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
