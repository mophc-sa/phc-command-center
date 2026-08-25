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
    const s = read(COMMAND_CENTER);
    expect(s).toContain("executiveKpis");
    expect(s).toContain("<KpiTile");
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

  it("an unknown value renders as a dash, never as zero", () => {
    expect(read("src/components/phc/KpiTile.tsx")).toContain('if (k.value === null) return "—"');
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
    expect(s).toContain("matchesStageFilter");
  });

  it("the list honours owner and date range from a KPI link", () => {
    const s = read(OPP_LIST);
    expect(s).toContain("routeSearch.owner");
    expect(s).toContain("routeSearch.from");
    expect(s).toContain("routeSearch.to");
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
