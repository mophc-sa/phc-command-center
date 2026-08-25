import { describe, expect, it } from "bun:test";
import {
  applySearch,
  buildDrilldown,
  DEFAULT_SEARCH,
  describeFilters,
  hasActiveFilters,
  isStageGroup,
  matchesOpportunitySearch,
  matchesStageFilter,
  parseOpportunitySearch,
} from "@/lib/drilldown";
import { executiveKpis, thisMonth, type OppRow } from "@/lib/sales-kpis";

const TODAY = "2026-08-20";

describe("stage filter vocabulary", () => {
  it("matches a single canonical stage", () => {
    expect(matchesStageFilter({ sales_stage: "jih_bafo" }, "jih_bafo")).toBe(true);
    expect(matchesStageFilter({ sales_stage: "jih" }, "jih_bafo")).toBe(false);
  });

  it("matches the open group, including on_hold", () => {
    for (const s of ["rfq_received", "jih", "jih_bafo", "under_negotiation", "contract_signed", "on_hold"]) {
      expect(matchesStageFilter({ sales_stage: s }, "open")).toBe(true);
    }
    expect(matchesStageFilter({ sales_stage: "won" }, "open")).toBe(false);
    expect(matchesStageFilter({ sales_stage: "lost" }, "open")).toBe(false);
  });

  it("matches closed and late_stage groups", () => {
    expect(matchesStageFilter({ sales_stage: "won" }, "closed")).toBe(true);
    expect(matchesStageFilter({ sales_stage: "lost" }, "closed")).toBe(true);
    expect(matchesStageFilter({ sales_stage: "jih" }, "closed")).toBe(false);

    expect(matchesStageFilter({ sales_stage: "verbally_awarded" }, "late_stage")).toBe(true);
    expect(matchesStageFilter({ sales_stage: "contract_signed" }, "late_stage")).toBe(true);
    expect(matchesStageFilter({ sales_stage: "jih" }, "late_stage")).toBe(false);
  });

  it("resolves the canonical stage, so a legacy won row still matches", () => {
    expect(matchesStageFilter({ stage: "won" }, "won")).toBe(true);
    expect(matchesStageFilter({ stage: "won" }, "closed")).toBe(true);
  });

  it("sales_stage wins over the legacy column", () => {
    expect(matchesStageFilter({ sales_stage: "jih", stage: "won" }, "won")).toBe(false);
    expect(matchesStageFilter({ sales_stage: "jih", stage: "won" }, "open")).toBe(true);
  });

  // A typo must show nothing, not everything.
  it("fails closed on an unrecognised filter", () => {
    expect(matchesStageFilter({ sales_stage: "jih" }, "nonsense")).toBe(false);
  });

  it("excludes rows with no resolvable stage", () => {
    expect(matchesStageFilter({ stage: "archived" }, "open")).toBe(false);
    expect(matchesStageFilter({}, "open")).toBe(false);
  });

  it("'all' matches everything with a stage", () => {
    expect(matchesStageFilter({ sales_stage: "won" }, "all")).toBe(true);
    expect(matchesStageFilter({}, "all")).toBe(true);
  });

  it("knows which names are groups", () => {
    expect(isStageGroup("open")).toBe(true);
    expect(isStageGroup("jih")).toBe(false);
  });
});

describe("search params round-trip", () => {
  it("defaults anything missing or malformed", () => {
    expect(parseOpportunitySearch({})).toEqual(DEFAULT_SEARCH);
    expect(parseOpportunitySearch({ stage: 42, view: "weird" })).toEqual(DEFAULT_SEARCH);
  });

  it("preserves the existing q/stage/tier/view params", () => {
    const s = parseOpportunitySearch({ q: "tower", stage: "jih", tier: "A", view: "cards" });
    expect(s).toMatchObject({ q: "tower", stage: "jih", tier: "A", view: "cards" });
  });

  it("carries owner and date range added for drilldown", () => {
    const s = parseOpportunitySearch({ owner: "u1", from: "2026-08-01", to: "2026-09-01" });
    expect(s).toMatchObject({ owner: "u1", from: "2026-08-01", to: "2026-09-01" });
  });
});

describe("buildDrilldown preserves dashboard context", () => {
  it("carries stage, owner and period through", () => {
    const d = buildDrilldown({ stage: "won", ownerId: "u1", period: thisMonth(TODAY) });
    expect(d).toEqual({ stage: "won", owner: "u1", from: "2026-08-01", to: "2026-09-01" });
  });

  it("omits empty and default values so URLs stay readable", () => {
    expect(buildDrilldown({ stage: "all", ownerId: null, period: null })).toEqual({});
    expect(buildDrilldown({ tier: "all" })).toEqual({});
  });

  it("round-trips through the parser", () => {
    const built = buildDrilldown({ stage: "late_stage", ownerId: "u9", period: thisMonth(TODAY) });
    const parsed = parseOpportunitySearch(built);
    expect(parsed.stage).toBe("late_stage");
    expect(parsed.owner).toBe("u9");
    expect(parsed.from).toBe("2026-08-01");
  });
});

describe("applySearch", () => {
  const rows = [
    { id: "a", sales_stage: "jih", owner_id: "u1", d: "2026-08-05" },
    { id: "b", sales_stage: "won", owner_id: "u1", d: "2026-08-06" },
    { id: "c", sales_stage: "jih", owner_id: "u2", d: "2026-07-01" },
  ];

  it("filters by stage group", () => {
    const out = applySearch(rows, { ...DEFAULT_SEARCH, stage: "open" });
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("filters by owner", () => {
    const out = applySearch(rows, { ...DEFAULT_SEARCH, owner: "u1" });
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("filters by date only when a date accessor is supplied", () => {
    const withDate = applySearch(rows, { ...DEFAULT_SEARCH, from: "2026-08-01", to: "2026-09-01" }, (r) => r.d);
    expect(withDate.map((r) => r.id)).toEqual(["a", "b"]);

    // A snapshot KPI passes no accessor, so a range in the URL must not narrow it.
    const noAccessor = applySearch(rows, { ...DEFAULT_SEARCH, from: "2026-08-01", to: "2026-09-01" });
    expect(noAccessor).toHaveLength(3);
  });

  it("combines stage, owner and date", () => {
    const out = applySearch(
      rows,
      { ...DEFAULT_SEARCH, stage: "open", owner: "u1", from: "2026-08-01", to: "2026-09-01" },
      (r) => r.d,
    );
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });
});

// The whole point: the number and the list it opens must agree.
describe("KPI drilldown lands on exactly the records that made the number", () => {
  const opps: OppRow[] = [
    { id: "w1", sales_stage: "won", contract_value: 100, won_at: "2026-08-02" },
    { id: "w2", sales_stage: "won", contract_value: 200, won_at: "2026-08-03" },
    { id: "o1", sales_stage: "jih", estimated_value_max: 300 },
    { id: "o2", sales_stage: "on_hold", estimated_value_max: 400 },
    { id: "l1", sales_stage: "lost", contract_value: 500, lost_at: "2026-08-04" },
    { id: "v1", sales_stage: "verbally_awarded", contract_value: 600 },
  ];
  const ctx = { today: TODAY, period: thisMonth(TODAY) };
  const exec = executiveKpis(opps, ctx);

  function landedRows(kpiSearch: Record<string, string>, dateOf?: (r: OppRow) => string | null) {
    return applySearch(opps, parseOpportunitySearch(kpiSearch), dateOf).map((r) => r.id);
  }

  it("Won value → exactly the won records", () => {
    const landed = landedRows(exec.wonValue.drilldown!.search, (r) => r.won_at ?? null);
    expect(landed.sort()).toEqual([...exec.wonValue.recordIds].sort());
  });

  it("Open pipeline → exactly the open records", () => {
    expect(landedRows(exec.openPipeline.drilldown!.search).sort()).toEqual(
      [...exec.openPipeline.recordIds].sort(),
    );
  });

  it("Lost value → exactly the lost records", () => {
    const landed = landedRows(exec.lostValue.drilldown!.search, (r) => r.lost_at ?? null);
    expect(landed.sort()).toEqual([...exec.lostValue.recordIds].sort());
  });

  it("Late-stage exposure → exactly the exposure records", () => {
    expect(landedRows(exec.lateStageExposure.drilldown!.search).sort()).toEqual(
      [...exec.lateStageExposure.recordIds].sort(),
    );
  });

  it("a stage count → exactly that stage", () => {
    const jih = exec.byStage.find((k) => k.key === "stage_jih")!;
    expect(landedRows(jih.drilldown!.search)).toEqual(jih.recordIds);
  });
});

describe("filter description", () => {
  it("summarises what is active", () => {
    const d = describeFilters({ ...DEFAULT_SEARCH, stage: "late_stage", owner: "u1", from: "2026-08-01", to: "2026-09-01" });
    expect(d.join(" | ")).toContain("Stage: late stage");
    expect(d.join(" | ")).toContain("Owner: selected");
    expect(d.join(" | ")).toContain("2026-08-01 → 2026-09-01");
  });

  it("knows when nothing is filtered", () => {
    expect(hasActiveFilters(DEFAULT_SEARCH)).toBe(false);
    expect(describeFilters(DEFAULT_SEARCH)).toEqual([]);
    expect(hasActiveFilters({ ...DEFAULT_SEARCH, stage: "won" })).toBe(true);
  });
});

// =============================================================================
// The list page's own predicate.
//
// These replace a source-text contract test that asserted the string
// "routeSearch.owner" appeared in opportunities.index.tsx. That test passed
// while the page's useMemo omitted owner/from/to from its dependency array,
// so the filter never re-ran when a drilldown changed only those. Asserting on
// behaviour instead of on source text is the whole point.
// =============================================================================
describe("matchesOpportunitySearch — the opportunity list's predicate", () => {
  const row = (over: Partial<Parameters<typeof matchesOpportunitySearch>[0]> = {}) => ({
    sales_stage: "jih",
    owner_id: "u1",
    tier: "A",
    updated_at: "2026-08-05",
    project_name: "Riyadh Tower",
    client: "Acme",
    ...over,
  });

  it("narrows by owner", () => {
    const s = { ...DEFAULT_SEARCH, owner: "u1" };
    expect(matchesOpportunitySearch(row(), s)).toBe(true);
    expect(matchesOpportunitySearch(row({ owner_id: "u2" }), s)).toBe(false);
  });

  it("treats owner 'all' as no owner filter", () => {
    expect(matchesOpportunitySearch(row({ owner_id: "u9" }), DEFAULT_SEARCH)).toBe(true);
  });

  it("narrows by tier", () => {
    expect(matchesOpportunitySearch(row(), { ...DEFAULT_SEARCH, tier: "B" })).toBe(false);
    expect(matchesOpportunitySearch(row(), { ...DEFAULT_SEARCH, tier: "A" })).toBe(true);
  });

  it("searches the text fields case-insensitively", () => {
    expect(matchesOpportunitySearch(row(), { ...DEFAULT_SEARCH, q: "riyadh" })).toBe(true);
    expect(matchesOpportunitySearch(row(), { ...DEFAULT_SEARCH, q: "jeddah" })).toBe(false);
  });

  // Won and lost are events and carry a date; everything else is a snapshot of
  // current state, so a period from a drilldown must not narrow it.
  it("bounds won/lost rows by the period", () => {
    const s = { ...DEFAULT_SEARCH, stage: "won", from: "2026-08-01", to: "2026-09-01" };
    expect(matchesOpportunitySearch(row({ sales_stage: "won", updated_at: "2026-08-05" }), s)).toBe(true);
    expect(matchesOpportunitySearch(row({ sales_stage: "won", updated_at: "2026-07-05" }), s)).toBe(false);
  });

  it("does not bound a snapshot stage by the period", () => {
    const s = { ...DEFAULT_SEARCH, stage: "open", from: "2026-08-01", to: "2026-09-01" };
    expect(matchesOpportunitySearch(row({ sales_stage: "jih", updated_at: "2026-01-01" }), s)).toBe(true);
  });

  it("combines every filter", () => {
    const s = { ...DEFAULT_SEARCH, stage: "open", owner: "u1", tier: "A", q: "riyadh" };
    expect(matchesOpportunitySearch(row(), s)).toBe(true);
    expect(matchesOpportunitySearch(row({ owner_id: "u2" }), s)).toBe(false);
  });
});

describe("clearing filters escapes a drilldown completely", () => {
  // The empty-state's "clear filters" reset only q/stage/tier, leaving the
  // owner and date range a drilldown arrived with still applied — so the list
  // stayed empty and there was no way out of it from the page.
  it("DEFAULT_SEARCH clears owner and the date range too", () => {
    expect(hasActiveFilters(DEFAULT_SEARCH)).toBe(false);
    expect(DEFAULT_SEARCH.owner).toBe("all");
    expect(DEFAULT_SEARCH.from).toBe("");
    expect(DEFAULT_SEARCH.to).toBe("");
  });

  it("an owner-only drilldown still counts as filtered", () => {
    expect(hasActiveFilters({ ...DEFAULT_SEARCH, owner: "u1" })).toBe(true);
  });
});
