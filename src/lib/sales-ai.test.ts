import { describe, expect, it } from "bun:test";
import {
  AI_FORBIDDEN_ACTIONS,
  buildManagementBrief,
  checkRecommendation,
  compareProbabilities,
  filterRecommendations,
  isAiGenerated,
  PROVENANCE_LABEL,
  withAiCommentary,
  type AiRecommendation,
} from "@/lib/sales-ai";
import { thisMonth, type OppRow } from "@/lib/sales-kpis";

const TODAY = "2026-08-20";
const CTX = { today: TODAY, period: thisMonth(TODAY) };
const rec = (text: string, proposedAction = ""): AiRecommendation => ({ id: "r1", text, proposedAction });

// §37 — every one of these must be refused, whatever wording the model picks.
describe("AI cannot propose a forbidden action", () => {
  const cases: Array<[string, string]> = [
    ["change_sales_stage", "Move the sales stage to jih_bafo"],
    ["change_tender_stage", "Update the tender stage to award negotiation"],
    ["change_owner", "Reassign this deal to Marie"],
    ["change_human_probability", "Override the manager probability to 80%"],
    ["approve_bafo", "Approve the BAFO request for this opportunity"],
    ["record_won", "Mark this opportunity as won"],
    ["record_lost", "Record the deal as lost"],
    ["close_action", "Close the overdue action on this record"],
    ["change_target", "Adjust the target down to SAR 2M"],
    ["issue_project_number", "Issue a project number for this job"],
    ["validate_boq", "Confirm the BOQ is valid"],
    ["send_email", "Send an email to the client today"],
    ["send_whatsapp", "Send a WhatsApp message to the consultant"],
    ["create_commercial_commitment", "Offer a discount of 10% to close it"],
  ];

  for (const [action, text] of cases) {
    it(`refuses: ${action}`, () => {
      const c = checkRecommendation(rec(text));
      expect(c.allowed).toBe(false);
      if (!c.allowed) {
        expect(c.violated).toBe(action as never);
        expect(c.reason).toContain("advisory only");
      }
    });
  }

  it("covers every action in the forbidden list", () => {
    const covered = new Set(cases.map(([a]) => a));
    for (const a of AI_FORBIDDEN_ACTIONS) expect(covered.has(a)).toBe(true);
  });

  it("also catches the proposal when it is in the action field, not the prose", () => {
    expect(checkRecommendation({ id: "r", text: "This deal looks ready.", proposedAction: "mark as won" }).allowed).toBe(false);
  });
});

describe("advisory recommendations are allowed", () => {
  for (const text of [
    "Sales Manager should review the next action on this deal.",
    "Consider scheduling a site visit with the consultant.",
    "Worth checking why this has not moved in three weeks.",
    "Ask the client whether the budget has been approved.",
  ]) {
    it(`allows: ${text.slice(0, 40)}…`, () => {
      expect(checkRecommendation(rec(text)).allowed).toBe(true);
    });
  }

  it("splits a mixed batch into allowed and refused", () => {
    const { allowed, refused } = filterRecommendations([
      rec("Review the next action."),
      rec("Mark this opportunity as won"),
      rec("Consider a follow-up call."),
    ]);
    expect(allowed).toHaveLength(2);
    expect(refused).toHaveLength(1);
    expect(refused[0].violated).toBe("record_won");
  });
});

// §36 — a reader must be able to tell a fact from an opinion at a glance.
describe("provenance", () => {
  it("labels all four kinds in both languages", () => {
    for (const p of ["fact", "calculated", "inference", "recommendation"] as const) {
      expect(PROVENANCE_LABEL[p].en.length).toBeGreaterThan(0);
      expect(PROVENANCE_LABEL[p].ar.length).toBeGreaterThan(0);
    }
  });

  it("knows which lines came from a model", () => {
    expect(isAiGenerated({ provenance: "fact", text: "", basis: "" })).toBe(false);
    expect(isAiGenerated({ provenance: "calculated", text: "", basis: "" })).toBe(false);
    expect(isAiGenerated({ provenance: "inference", text: "", basis: "" })).toBe(true);
    expect(isAiGenerated({ provenance: "recommendation", text: "", basis: "" })).toBe(true);
  });
});

describe("the management brief stands on its own without AI", () => {
  const opps: OppRow[] = [
    { id: "w", sales_stage: "won", contract_value: 400_000, won_at: "2026-08-05", project_name: "Won deal" },
    { id: "o1", sales_stage: "jih", estimated_value_max: 900_000, human_win_probability: 60, next_action: "call", project_name: "Big open" },
    { id: "o2", sales_stage: "jih", estimated_value_max: 100_000, project_name: "Unscored", next_action: "call" },
    { id: "v", sales_stage: "verbally_awarded", contract_value: 700_000, project_name: "Verbal", next_action: "x" },
    { id: "stale", sales_stage: "jih", estimated_value_max: 50_000, last_activity_at: "2026-07-01", project_name: "Stale" },
  ];
  const b = buildManagementBrief({ opportunities: opps, ctx: CTX, targetAmount: 1_000_000 });

  it("every line is fact or calculated — nothing inferred", () => {
    const all = [...b.whatChanged, ...b.needsAttention, ...b.forecast, ...b.focus];
    expect(all.length).toBeGreaterThan(0);
    for (const l of all) {
      expect(["fact", "calculated"]).toContain(l.provenance);
      expect(l.basis.length).toBeGreaterThan(3);
    }
  });

  it("reports what closed", () => {
    expect(b.whatChanged).toContainEqual(
      expect.objectContaining({ text: expect.objectContaining({ key: "brf_won" }) }),
    );
  });

  it("separates exposure from revenue as its own line, not just a column", () => {
    // The wording ("exposure, not revenue") now lives in the translation; what
    // the engine guarantees is that the line EXISTS and carries the value.
    const line = b.forecast.find((l) => typeof l.text !== "string" && l.text.key === "brf_late_stage_exposure");
    expect(line).toBeDefined();
    expect((line!.text as { params: Record<string, number> }).params.value).toBeGreaterThan(0);
  });

  it("states the gap to target", () => {
    expect(b.forecast.some((l) => typeof l.text !== "string" && l.text.key === "brf_gap_to_target")).toBe(true);
  });

  it("names the unscored deals rather than weighting them", () => {
    // The brief now carries the caveat's KEY, not an English sentence — the
    // fact travels, the wording is chosen where the language is known.
    expect(b.forecast.some((l) => typeof l.text !== "string" && l.text.key === "cav_probability_missing")).toBe(true);
  });

  it("flags quiet records and unactioned work", () => {
    const keys = b.needsAttention.map((l) => (typeof l.text === "string" ? l.text : l.text.key));
    expect(keys).toContain("brf_issue_no_recent_crm_activity");
    expect(keys).toContain("brf_issue_no_next_action");
  });

  it("focuses on the largest open deals, with links", () => {
    // The project NAME travels as data inside the fact and is never translated.
    expect((b.focus[0].text as { params: Record<string, string> }).params.name).toContain("Big open");
    expect(b.focus[0].href).toBe("/opportunities/o1");
  });

  it("says nothing happened rather than inventing activity", () => {
    const quiet = buildManagementBrief({ opportunities: [], ctx: CTX });
    const key = (l: { text: unknown }) => (typeof l.text === "string" ? l.text : (l.text as { key: string }).key);
    expect(key(quiet.whatChanged[0])).toBe("brf_no_movement");
    expect(key(quiet.needsAttention[0])).toBe("brf_nothing_flagged");
    expect(key(quiet.forecast[0])).toBe("brf_forecast_uncomputable");
  });
});

describe("AI commentary sits on top, never replaces", () => {
  const base = buildManagementBrief({ opportunities: [], ctx: CTX });

  it("marks added lines with their provenance and agent", () => {
    const { brief } = withAiCommentary(base, {
      agentKey: "sales_report_insights",
      inferences: ["Pipeline may be concentrated in too few deals."],
      recommendations: [rec("Review the two largest deals this week.")],
    });
    const added = brief.needsAttention.filter(isAiGenerated);
    expect(added).toHaveLength(2);
    expect(added[0].provenance).toBe("inference");
    expect(added[1].provenance).toBe("recommendation");
    for (const l of added) expect(l.basis).toContain("sales_report_insights");
  });

  it("keeps the deterministic lines untouched", () => {
    const { brief } = withAiCommentary(base, { agentKey: "x", inferences: ["something"] });
    expect(brief.whatChanged).toEqual(base.whatChanged);
    expect(brief.forecast).toEqual(base.forecast);
  });

  it("drops a forbidden recommendation before a human ever sees it", () => {
    const { brief, refused } = withAiCommentary(base, {
      agentKey: "x",
      recommendations: [rec("Mark the Riyadh deal as won"), rec("Call the client")],
    });
    expect(refused).toHaveLength(1);
    expect(refused[0].violated).toBe("record_won");
    expect(brief.needsAttention.filter((l) => l.provenance === "recommendation")).toHaveLength(1);
  });
});

// §38 — show both, reconcile neither.
describe("AI vs manager probability", () => {
  const opps: OppRow[] = [
    { id: "gap", project_name: "Wide gap", human_win_probability: 70, score: 42 },
    { id: "agree", project_name: "Agreed", human_win_probability: 50, score: 45 },
    { id: "ai_only", project_name: "AI only", score: 30 },
    { id: "human_only", project_name: "Manager only", human_win_probability: 80 },
    { id: "neither", project_name: "Unscored" },
  ];
  const c = compareProbabilities(opps);
  const byId = (id: string) => c.find((x) => x.opportunityId === id)!;

  it("shows both numbers and the delta", () => {
    expect(byId("gap")).toMatchObject({ ai: 42, human: 70, delta: 28, divergent: true });
  });

  it("explains which way the manager leans", () => {
    expect(byId("gap").note).toContain("more confident than the model by 28");
  });

  it("does not flag a small difference", () => {
    expect(byId("agree").divergent).toBe(false);
    expect(byId("agree").note).toContain("broadly agree");
  });

  it("never fabricates the missing side", () => {
    expect(byId("ai_only").human).toBeNull();
    expect(byId("ai_only").delta).toBeNull();
    expect(byId("human_only").ai).toBeNull();
    expect(byId("neither")).toMatchObject({ ai: null, human: null, delta: null, divergent: false });
  });

  it("says plainly when nothing has been recorded", () => {
    expect(byId("neither").note).toContain("Neither");
  });

  it("respects a custom divergence threshold", () => {
    expect(compareProbabilities(opps, 40).find((x) => x.opportunityId === "gap")!.divergent).toBe(false);
  });
});
