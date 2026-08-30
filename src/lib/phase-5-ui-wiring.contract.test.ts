// =============================================================================
// Phase 5 — the engines are actually wired to UI.
//
// The failure this guards against is specific and was real at the end of the
// first Phase 5 pass: sales-kpis, opportunity-timeline and entry-presets all
// existed, were fully tested, and were referenced by nothing. Unit tests pass
// happily against a module no screen imports, so they cannot tell you the
// feature shipped.
//
// These are deliberately structural rather than behavioural — a render test
// would need the whole router, auth and Supabase stack. What they assert is the
// thing unit tests cannot: that the wiring exists at all.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { renderValue } from "@/components/phc/KpiTile";
import type { Kpi } from "@/lib/sales-kpis";

const BLANK_KPI: Kpi = {
  key: "t", value: null, kind: "currency", formula: "", source: "",
  dateField: null, filters: [], recordCount: 0, recordIds: [], drilldown: null,
};
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const MANAGEMENT = "src/routes/_authenticated/sales-management.tsx";
const OPP_DETAIL = "src/routes/_authenticated/opportunities.$id.tsx";
const OPP_LIST = "src/routes/_authenticated/opportunities.index.tsx";
const COMMAND_CENTER = "src/routes/_authenticated/command-center.tsx";
const STAGE_PANEL = "src/components/phc/pipeline/RfqJihPanel.tsx";

describe("the KPI engine reaches a screen", () => {
  it("Command Center renders canonical KPIs through KpiTile", () => {
    // The Command Center hands its KPIs to KpiGroup, which renders the ones
    // that have a value as KpiTiles and folds the rest into a line naming each
    // and why it cannot be computed. The assertion follows the chain rather
    // than loosening: the point of this test is that the engine's output
    // reaches a rendered tile instead of being computed and dropped, and one
    // more hop does not change that — but a page that stopped rendering tiles
    // altogether still has to fail here.
    const s = read(COMMAND_CENTER);
    expect(s).toContain("executiveKpis");
    expect(s).toContain("<KpiGroup");
    expect(read("src/components/phc/KpiGroup.tsx")).toContain("<KpiTile");
  });

  it("KpiGroup hides no metric — it only changes how much room an absent one takes", () => {
    // The reason this row exists at all. Fifteen of nineteen tiles on the
    // Command Center said "no data" or "needs setup" at full card size, which
    // pushed seven charts below the fold. Folding them must never become
    // dropping them: every entry is still classified, named and given its fix.
    const g = read("src/components/phc/KpiGroup.tsx");
    expect(g).toMatch(/metricStateOf/);
    // Both halves rendered — the ones with a number and the ones without.
    expect(g).toMatch(/live\.map/);
    expect(g).toMatch(/byReason/);
    // The count of what is folded is on the control, so the reader knows the
    // size of what they have not been shown.
    expect(g).toMatch(/blank\.length/);
    // And the way out survives the fold.
    expect(g).toMatch(/kpi\.fix/);
  });

  it("Sales Management renders them too", () => {
    const s = read(MANAGEMENT);
    expect(s).toContain("executiveKpis");
    expect(s).toContain("<KpiTile");
  });

  // If a page computed its own totals we would be back to three dashboards
  // disagreeing, which is the whole reason the engine exists.
  it("the management page computes no metric of its own", () => {
    const s = read(MANAGEMENT);
    expect(s).not.toMatch(/sales_stage\s*===\s*["']won["']/);
    expect(s).not.toMatch(/\.stage\s*===\s*["']won["']/);
  });

  it("KpiTile renders the explanation from the same object as the value", () => {
    const s = read("src/components/phc/KpiTile.tsx");
    for (const field of ["kpi.formula", "kpi.source", "kpi.filters", "kpi.recordCount", "kpi.caveat", "kpi.drilldown"]) {
      expect(s).toContain(field);
    }
  });

  // WHAT THIS USED TO ASSERT, AND WHY IT WAS WORSE
  // ---------------------------------------------
  // It grepped the component for the literal `if (k.value === null) return "—"`
  // — the MECHANISM, not the guarantee. Phase 5.1 §14 replaced the single dash
  // with four distinct empty labels precisely because one dash could not tell
  // "nobody set a target" from "45 deals have no probability". The old
  // assertion would have failed that improvement while still passing against
  // any component that rendered a dash and then, elsewhere, a zero.
  //
  // The guarantee is behavioural, so it is asserted behaviourally.
  it("an unknown value never renders as a number", () => {
    for (const state of ["no_data", "not_calculated", "not_configured", "not_applicable"] as const) {
      const out = renderValue(
        { ...BLANK_KPI, value: null, state, kind: "currency" }, "en");
      expect([state, /\d/.test(out)]).toEqual([state, false]);
    }
  });

  it("a real zero still renders as zero", () => {
    // The opposite error: hiding a known zero behind an empty state would make
    // "we won nothing this month" indistinguishable from "we do not know".
    expect(renderValue({ ...BLANK_KPI, value: 0, recordCount: 3, kind: "currency" }, "en")).toMatch(/0/);
  });

  it("each empty state reads differently, in both languages", () => {
    for (const lang of ["en", "ar"] as const) {
      const seen = (["no_data", "not_calculated", "not_configured", "not_applicable"] as const).map((state) =>
        renderValue({ ...BLANK_KPI, value: null, state, kind: "currency" }, lang));
      expect([lang, new Set(seen).size]).toEqual([lang, 4]);
    }
  });
});

describe("the three management views exist and are role-gated", () => {
  const s = read(MANAGEMENT);

  it("has a team, strategic and executive view", () => {
    expect(s).toContain("function TeamView");
    expect(s).toContain("function StrategicView");
    expect(s).toContain("function ExecutiveView");
  });

  it("gates each tab on a business role, not on a technical one", () => {
    expect(s).toContain("isSalesManager(roles)");
    expect(s).toContain("isBdOrSalesOps(roles)");
    expect(s).toContain("isExecutive(roles)");
    // A platform administrator must not appear anywhere in the visibility rule.
    // Comments are stripped first: the assertion is about what the gate DOES,
    // and a comment explaining why admins are excluded is the opposite of a
    // violation. Phase 7 added exactly such a comment and tripped this.
    const gate = s
      .slice(s.indexOf("const canTeam"), s.indexOf("const tab:"))
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(gate).not.toContain("isSystemAdmin");
    expect(gate).not.toContain("system_admin");
  });

  it("tells a viewer with no commercial role why they see nothing", () => {
    expect(s).toContain("No commercial management access");
    expect(s).toContain("لا تملك صلاحية إدارية تجارية");
  });

  it("the team view reports activity without scoring people", () => {
    expect(s).toContain("teamWorkload");
    expect(s).toContain("never by task count");
    expect(s).not.toMatch(/\bperformanceScore\b|\brankOf(Member|Person)\b/);
  });

  it("covers Team Today, Attention, Workload and Activity", () => {
    expect(s).toContain("teamDay");
    expect(s).toContain("needsAttention");
    expect(s).toContain("teamWorkload");
    expect(s).toContain("groupByRecency");
  });

  it("offers month / quarter / YTD ranges", () => {
    expect(s).toContain("thisMonth");
    expect(s).toContain("thisQuarter");
    expect(s).toContain("yearToDate");
  });
});

describe("the timeline reaches the opportunity page", () => {
  it("is mounted on the entity page, not only defined", () => {
    const s = read(OPP_DETAIL);
    expect(s).toContain("<OpportunityTimeline");
    expect(s).toContain('from "@/components/phc/OpportunityTimeline"');
  });

  it("the component uses the shared projection rather than its own query logic", () => {
    const s = read("src/components/phc/OpportunityTimeline.tsx");
    expect(s).toContain("buildTimeline");
    expect(s).toContain("groupByRecency");
  });

  it("offers every category filter", () => {
    const s = read("src/components/phc/OpportunityTimeline.tsx");
    for (const f of ["all", "sales", "approvals", "communication", "commercial"]) {
      expect(s).toContain(`"${f}"`);
    }
  });

  it("shows previous → new and names the source table", () => {
    const s = read("src/components/phc/OpportunityTimeline.tsx");
    expect(s).toContain("e.from");
    expect(s).toContain("e.to");
    expect(s).toContain("e.source");
  });

  it("reads the intake that became this opportunity, so lineage is visible", () => {
    expect(read("src/components/phc/OpportunityTimeline.tsx")).toContain("converted_record_id");
  });
});

describe("entry presets reach real forms", () => {
  const s = read(STAGE_PANEL);

  it("loss reason is a structured select, not a textarea", () => {
    expect(s).toContain("LOST_REASONS");
    expect(s).toMatch(/key: "loss_reason", type: "select"/);
    expect(s).not.toMatch(/key: "loss_reason", type: "textarea"/);
  });

  it("on-hold reason is a structured select too", () => {
    expect(s).toContain("ON_HOLD_REASONS");
    expect(s).toMatch(/key: "hold_reason", type: "select"/);
    expect(s).not.toMatch(/key: "hold_reason", type: "textarea"/);
  });

  it("captures the competitor when there is one", () => {
    expect(s).toContain("lost_to_competitor");
  });

  it("labels the options in the viewer's language", () => {
    expect(s).toContain("label(o, lang)");
    expect(s).toContain("fieldsForStage(advance.toStage, (k) => t(k as never), lang)");
  });
});

describe("drilldown is wired end to end", () => {
  it("the list parses the shared search contract", () => {
    const s = read(OPP_LIST);
    expect(s).toContain("parseOpportunitySearch");
  });

  // WHAT THIS USED TO ASSERT, AND WHY IT WAS WORSE
  // ---------------------------------------------
  // It asserted the strings "routeSearch.owner" / ".from" / ".to" appeared in
  // the file. They did — inside a useMemo that listed none of them in its
  // dependency array, so a drilldown changing only the salesperson or the
  // period rendered the PREVIOUS filter's rows under the new URL. A grep over
  // source text cannot see a dependency array, so it passed throughout.
  //
  // The filtering behaviour itself is now covered directly, over real rows, by
  // `matchesOpportunitySearch` in drilldown.test.ts. What is left here is the
  // one thing genuinely about wiring: the page must delegate to that shared
  // predicate and hand it the WHOLE search object, rather than re-implementing
  // the rules inline against a few hand-picked fields — which is exactly how
  // the two drifted apart in the first place.
  it("the list delegates filtering to the shared predicate", () => {
    const s = read(OPP_LIST);
    expect(s).toContain("matchesOpportunitySearch(o, routeSearch)");
  });

  it("the filter memo depends on the whole search object", () => {
    const s = read(OPP_LIST);
    expect(s).toContain("}, [data, routeSearch, sort]);");
  });

  // Clearing filters must escape the owner and date range a drilldown arrived
  // with, not just the three controls the toolbar renders.
  it("clearing filters resets every field", () => {
    const s = read(OPP_LIST);
    expect(s).toContain("...DEFAULT_SEARCH");
    expect(s).toContain("onClick={clearFilters}");
  });

  // A drilldown scopes the list by owner and period, neither of which has a
  // toolbar control. Without this the list just looked short.
  it("the list shows which filters are active", () => {
    const s = read(OPP_LIST);
    expect(s).toContain("hasActiveFilters(routeSearch)");
    expect(s).toContain("describeFilters(routeSearch)");
  });

  // Changing one filter must not silently drop the context a drilldown arrived
  // with — the old setters rebuilt the search object from four fixed fields.
  it("filter setters preserve the rest of the search", () => {
    expect(read(OPP_LIST)).toContain("...routeSearch");
  });

  it("the team workload row links to that person's open pipeline", () => {
    expect(read("src/lib/team-dashboard.ts")).toContain('search: { owner: userId, stage: "open" }');
  });
});

describe("automation health is surfaced", () => {
  const s = read(MANAGEMENT);

  it("reads the existing run log rather than adding infrastructure", () => {
    expect(s).toContain("automation_runs");
    expect(s).toContain("AutomationHealth");
  });

  it("distinguishes healthy, stale and failed", () => {
    expect(s).toContain("Automation: failed");
    expect(s).toContain("Automation: healthy");
    expect(s).toMatch(/last ran \$\{daysOld\}d ago/);
  });
});
