// =============================================================================
// PHC Sales OS — the drilldown contract (Phase 5).
//
// "Every number explains itself" only holds if clicking a number lands on the
// exact records that produced it. That requires the KPI and the list page to
// agree on what a filter means — otherwise the count says 12 and the list shows
// 9, and the dashboard quietly loses its credibility.
//
// This module is the shared vocabulary. The KPI engine emits these filters; the
// opportunities list consumes them through `matchesStageFilter`. They cannot
// drift because there is one implementation.
//
// It extends the list's EXISTING query params (q / stage / tier / view) rather
// than introducing a parallel routing scheme — `owner`, `from` and `to` are
// added because a KPI scoped by salesperson or period cannot round-trip
// without them.
// =============================================================================

import { resolveCanonicalStage, type CanonicalStage } from "@/lib/stage-canonical";
import { LATE_STAGE_EXPOSURE, OPEN_STAGES, type Period } from "@/lib/sales-kpis";

/**
 * Group filters that are not themselves canonical stages. They exist because
 * several KPIs are defined over a SET of stages ("open pipeline"), and a
 * drilldown must be able to express that set in a URL.
 */
export const STAGE_GROUPS = {
  all: null,
  open: OPEN_STAGES,
  closed: ["won", "lost"] as CanonicalStage[],
  late_stage: LATE_STAGE_EXPOSURE,
} as const;

export type StageGroup = keyof typeof STAGE_GROUPS;

export function isStageGroup(v: string): v is StageGroup {
  return v in STAGE_GROUPS;
}

/**
 * The single predicate both the KPI engine and the list use.
 *
 * `filter` is either a group name ("open", "closed", "late_stage", "all") or a
 * single canonical stage ("jih_bafo"). Anything unrecognised matches nothing —
 * failing closed, so a typo shows an empty list rather than silently showing
 * everything.
 */
export function matchesStageFilter(
  row: { sales_stage?: string | null; stage?: string | null },
  filter: string,
): boolean {
  if (filter === "all") return true;
  const canonical = resolveCanonicalStage(row).stage;
  if (canonical === null) return false;

  if (isStageGroup(filter)) {
    const set = STAGE_GROUPS[filter];
    return set === null ? true : set.includes(canonical);
  }
  return canonical === filter;
}

// ---- URL round-tripping -----------------------------------------------------

export type OpportunitySearch = {
  q: string;
  stage: string;
  tier: string;
  view: "table" | "cards";
  owner: string;
  from: string;
  to: string;
};

export const DEFAULT_SEARCH: OpportunitySearch = {
  q: "",
  stage: "all",
  tier: "all",
  view: "table",
  owner: "all",
  from: "",
  to: "",
};

/** Parses raw search params, defaulting anything malformed rather than throwing. */
export function parseOpportunitySearch(s: Record<string, unknown>): OpportunitySearch {
  const str = (v: unknown, d: string) => (typeof v === "string" && v !== "" ? v : d);
  return {
    q: str(s.q, ""),
    stage: str(s.stage, "all"),
    tier: str(s.tier, "all"),
    view: s.view === "cards" ? "cards" : "table",
    owner: str(s.owner, "all"),
    from: str(s.from, ""),
    to: str(s.to, ""),
  };
}

/**
 * Builds the search object for a drilldown, carrying the dashboard's active
 * context through so the list opens filtered the same way the KPI was.
 *
 * Empty values are omitted, keeping URLs readable and bookmarks stable.
 */
export function buildDrilldown(input: {
  stage?: string;
  ownerId?: string | null;
  period?: Period | null;
  tier?: string;
  q?: string;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.stage && input.stage !== "all") out.stage = input.stage;
  if (input.ownerId) out.owner = input.ownerId;
  if (input.tier && input.tier !== "all") out.tier = input.tier;
  if (input.q) out.q = input.q;
  if (input.period) {
    out.from = input.period.from;
    out.to = input.period.to;
  }
  return out;
}

/** True when the incoming search actually narrows anything. */
export function hasActiveFilters(s: OpportunitySearch): boolean {
  return s.q !== "" || s.stage !== "all" || s.tier !== "all" || s.owner !== "all" || s.from !== "" || s.to !== "";
}

/** Short human summary of what is being filtered, for the list header. */
export function describeFilters(s: OpportunitySearch): string[] {
  const out: string[] = [];
  if (s.stage !== "all") out.push(`Stage: ${s.stage.replace(/_/g, " ")}`);
  if (s.tier !== "all") out.push(`Tier ${s.tier}`);
  if (s.owner !== "all") out.push("Owner: selected");
  if (s.from && s.to) out.push(`${s.from} → ${s.to}`);
  if (s.q) out.push(`Search: “${s.q}”`);
  return out;
}

/**
 * Applies owner and date narrowing on top of the stage filter.
 *
 * `dateField` is passed in rather than assumed: the caller knows whether the
 * active period should bound the won date, the lost date, or nothing at all —
 * a snapshot KPI must not be date-filtered just because a range is in the URL.
 */
export function applySearch<T extends { owner_id?: string | null; sales_stage?: string | null; stage?: string | null }>(
  rows: T[],
  s: OpportunitySearch,
  dateOf?: (row: T) => string | null,
): T[] {
  return rows.filter((r) => {
    if (!matchesStageFilter(r, s.stage)) return false;
    if (s.owner !== "all" && r.owner_id !== s.owner) return false;
    if (dateOf && (s.from || s.to)) {
      const d = dateOf(r);
      if (!d) return false;
      if (s.from && d < s.from) return false;
      if (s.to && d >= s.to) return false;
    }
    return true;
  });
}

/**
 * The opportunity list's row predicate.
 *
 * This lived inline inside `opportunities.index.tsx`'s `useMemo`, which is how
 * it drifted: the memo read `owner`, `from` and `to` off the search object but
 * listed neither in its dependency array, so a drilldown that changed only the
 * salesperson or the period re-rendered with the PREVIOUS filter's rows. The
 * page showed one owner's deals under another owner's URL.
 *
 * It is deliberately NOT `applySearch` above. The two differ on purpose:
 * `applySearch` expresses "this KPI is a snapshot" by having the caller omit
 * the date accessor, and drops rows whose accessor returns null. The list gets
 * one mixed set of rows and has to decide per row, because only won and lost
 * carry an event date — every other stage is a snapshot of current state and a
 * period must not narrow it. Collapsing them would change behaviour, so they
 * stay separate and both are tested.
 */
export function matchesOpportunitySearch(
  o: {
    owner_id?: string | null;
    sales_stage?: string | null;
    stage?: string | null;
    tier?: string | null;
    updated_at?: string | null;
    project_name?: string | null;
    client?: string | null;
    main_contractor?: string | null;
    location?: string | null;
    sector?: string | null;
  },
  s: OpportunitySearch,
): boolean {
  if (!matchesStageFilter(o, s.stage)) return false;
  if (s.tier !== "all" && o.tier !== s.tier) return false;
  if (s.owner && s.owner !== "all" && o.owner_id !== s.owner) return false;

  if (s.from || s.to) {
    // Won and lost are events, so they are bounded by the period. Everything
    // else is a current-state snapshot and must not be narrowed by a range.
    const canonical = resolveCanonicalStage(o).stage;
    const d = canonical === "won" || canonical === "lost" ? (o.updated_at ?? null) : null;
    if (d !== null) {
      if (s.from && d < s.from) return false;
      if (s.to && d >= s.to) return false;
    }
  }

  const q = s.q.trim().toLowerCase();
  if (!q) return true;
  return [o.project_name, o.client, o.main_contractor, o.location, o.sector]
    .filter(Boolean)
    .some((f) => (f as string).toLowerCase().includes(q));
}
