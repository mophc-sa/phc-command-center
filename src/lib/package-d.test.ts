// =============================================================================
// Phase 5.1 Package D — AI UX.
//
// The guarantees worth pinning are the ones about what the AI CANNOT do:
// change a number, widen a query, see a record the user cannot, or act without
// a person pressing something.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  answerBounded,
  classifyIntent,
  parseMinValue,
  INTENT_RULES,
} from "@/lib/ask-ai";
import { buildAttention, dataQuality, REASON_CATEGORY, type AttentionOpp } from "@/lib/attention";
import {
  AI_FORBIDDEN_ACTIONS,
  buildManagementBrief,
  filterRecommendations,
  isAiGenerated,
  withAiCommentary,
} from "@/lib/sales-ai";
import type { OppRow } from "@/lib/sales-kpis";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const TODAY = "2026-08-26";
const CTX = { today: TODAY, period: null };
const opp = (o: Partial<AttentionOpp> & { id: string }): AttentionOpp => ({
  sales_stage: "jih",
  project_name: o.id,
  next_action: "Call",
  next_action_due: "2026-12-01",
  contractor_decision_maker: "Khalid",
  human_win_probability: 50,
  owner_id: "u1",
  client: "ICAD",
  quotation_value: 1_000_000,
  ...o,
});

// ---- §11 AI Executive Brief -------------------------------------------------

describe("the brief stands on counted records, with or without AI", () => {
  const book: OppRow[] = [
    { id: "w", sales_stage: "won", contract_value: 4_000_000, won_at: "2026-08-10" },
    { id: "o", sales_stage: "jih", quotation_value: 9_000_000, human_win_probability: 50 },
  ];

  it("is built before any model is consulted — no client, no fetch", () => {
    // buildManagementBrief takes rows and a context. If it ever takes a client
    // or an agent key, the brief has stopped being independent of AI.
    const brief = buildManagementBrief({ opportunities: book, ctx: CTX, targetAmount: 20_000_000 });
    expect(brief.forecast.length).toBeGreaterThan(0);
    expect(brief.whatChanged.length).toBeGreaterThan(0);
  });

  it("every deterministic line is a structured fact, never English prose", () => {
    const brief = buildManagementBrief({ opportunities: book, ctx: CTX });
    for (const line of [...brief.whatChanged, ...brief.forecast, ...brief.focus]) {
      expect([line.provenance, typeof line.text]).toEqual([line.provenance, "object"]);
    }
  });

  it("with no commentary at all, the brief is unchanged — that IS the fallback", () => {
    const base = buildManagementBrief({ opportunities: book, ctx: CTX });
    const { brief } = withAiCommentary(base, { agentKey: "x", inferences: [], recommendations: [] });
    expect(brief.whatChanged).toEqual(base.whatChanged);
    expect(brief.forecast).toEqual(base.forecast);
    expect(brief.focus).toEqual(base.focus);
  });

  it("AI cannot change an authoritative value — it may only append", () => {
    const base = buildManagementBrief({ opportunities: book, ctx: CTX });
    const { brief } = withAiCommentary(base, {
      agentKey: "sales_report_insights",
      inferences: ["Actually the forecast is SAR 99,000,000."],
      recommendations: [],
    });
    // The model's claim is present but marked, and every original fact survives
    // untouched beneath it.
    expect(brief.forecast).toEqual(base.forecast);
    const added = brief.needsAttention.filter(isAiGenerated);
    expect(added).toHaveLength(1);
    expect(added[0].provenance).toBe("inference");
  });

  it("a recommendation proposing a forbidden action never reaches the brief", () => {
    const { brief, refused } = withAiCommentary(buildManagementBrief({ opportunities: book, ctx: CTX }), {
      agentKey: "x",
      inferences: [],
      recommendations: [
        { id: "1", text: "Mark New Murabba as won.", proposedAction: "record_won" },
        { id: "2", text: "Call the client this week.", proposedAction: "call" },
      ],
    });
    expect(refused).toHaveLength(1);
    expect(refused[0].violated).toBe("record_won");
    const texts = brief.needsAttention.map((l) => (typeof l.text === "string" ? l.text : l.text.key));
    expect(texts).toContain("Call the client this week.");
    expect(texts.join(" ")).not.toContain("as won");
  });

  it("the forbidden list still covers every sensitive write named in the spec", () => {
    for (const a of [
      "change_sales_stage", "change_owner", "change_human_probability",
      "record_won", "record_lost", "send_email", "send_whatsapp", "approve_bafo",
    ]) {
      expect([a, (AI_FORBIDDEN_ACTIONS as readonly string[]).includes(a)]).toEqual([a, true]);
    }
  });

  it("filterRecommendations is the gate, and it defaults to refusing", () => {
    const { allowed, refused } = filterRecommendations([
      { id: "a", text: "Change the owner to Omar.", proposedAction: "change_owner" },
    ]);
    expect(allowed).toHaveLength(0);
    expect(refused).toHaveLength(1);
  });
});

// ---- §13 Data Quality -------------------------------------------------------

describe("data quality counts records, and is not risk", () => {
  const book = [
    opp({ id: "a", quotation_value: null, contractor_decision_maker: null }),
    opp({ id: "b", human_win_probability: null }),
    opp({ id: "c" }),
  ];
  const items = buildAttention({ opportunities: book, today: TODAY });
  const report = dataQuality(items, book.length);

  it("only reports data_quality reasons — never a risk one", () => {
    for (const issue of report.issues) {
      expect([issue.kind, REASON_CATEGORY[issue.kind]]).toEqual([issue.kind, "data_quality"]);
    }
  });

  it("a data gap does not make the opportunity At Risk", () => {
    const a = items.find((i) => i.opportunityId === "a")!;
    expect(a.reasons.length).toBeGreaterThan(0);
    expect(a.atRisk).toBe(false);
  });

  it("counts reconcile exactly to the records behind them", () => {
    for (const issue of report.issues) {
      expect([issue.kind, issue.count]).toEqual([issue.kind, issue.opportunityIds.length]);
      expect([issue.kind, new Set(issue.opportunityIds).size]).toEqual([issue.kind, issue.count]);
    }
  });

  it("one opportunity with several gaps is ONE affected record, not several", () => {
    // affectedOpportunities is a DISTINCT count; summing the issue counts would
    // over-report the size of the problem. All three are affected here because
    // none has a logged client activity — which is exactly the state of the
    // live book, and the reason the distinct count matters.
    const sumOfCounts = report.issues.reduce((s, i) => s + i.count, 0);
    expect(report.affectedOpportunities).toBeLessThan(sumOfCounts);
    expect(report.affectedOpportunities).toBe(3);
  });

  it("carries a denominator, so a count can be judged", () => {
    expect(report.totalConsidered).toBe(3);
  });

  it("a fully complete book reports nothing — engagement history included", () => {
    const clean = dataQuality(
      buildAttention({
        opportunities: [opp({ id: "z" })],
        activities: [
          { id: "m", opportunity_id: "z", activity_type: "meeting", status: "logged", created_at: TODAY },
        ],
        today: TODAY,
      }),
      1,
    );
    expect(clean.issues).toEqual([]);
    expect(clean.affectedOpportunities).toBe(0);
  });
});

// ---- §17 Search vs Ask ------------------------------------------------------

describe("intent routing is deterministic and closed", () => {
  it("a plain term is a record search, not a model question", () => {
    for (const q of ["CCC", "New Murabba", "FA26034"]) {
      expect([q, classifyIntent(q).kind]).toEqual([q, "record"]);
    }
  });

  it("recognises the management questions in both languages", () => {
    const cases: Array<[string, string]> = [
      ["Show opportunities at risk", "at_risk"],
      ["أظهر الفرص المعرضة للخطر", "at_risk"],
      ["Which opportunities have no decision maker?", "no_decision_maker"],
      ["أي الفرص بلا صانع قرار", "no_decision_maker"],
      ["opportunities with no next action", "no_next_action"],
      ["show stalled deals", "stalled"],
      ["overdue follow ups", "overdue_follow_ups"],
    ];
    for (const [q, expected] of cases) {
      const i = classifyIntent(q);
      expect([q, i.kind === "management" ? i.intent : i.kind]).toEqual([q, expected]);
    }
  });

  it("parses a value threshold, including units and Arabic", () => {
    expect(parseMinValue("above SAR 1M")).toBe(1_000_000);
    expect(parseMinValue("over 500k")).toBe(500_000);
    expect(parseMinValue("more than 250000")).toBe(250_000);
    expect(parseMinValue("أكثر من 2 مليون")).toBe(2_000_000);
    expect(parseMinValue("New Murabba")).toBeUndefined();
  });

  it("the same query always routes the same way", () => {
    const q = "Show opportunities above SAR 1M with no next action";
    expect(JSON.stringify(classifyIntent(q))).toBe(JSON.stringify(classifyIntent(q)));
  });

  it("an unrecognised question falls back to record search, never to a free query", () => {
    // The safe default is the one that cannot invent a filter.
    const i = classifyIntent("what is the meaning of this pipeline");
    expect(i.kind).toBe("record");
  });

  it("every rule maps to a named intent — the set is closed and reviewable", () => {
    for (const rule of INTENT_RULES) {
      expect(rule.patterns.length).toBeGreaterThan(0);
      expect(typeof rule.intent).toBe("string");
    }
  });
});

describe("bounded retrieval cannot widen what it was given", () => {
  const mine = [
    opp({ id: "mine1", expected_contract_date: "2026-01-01" }),
    opp({ id: "mine2", quotation_value: 9_000_000, contractor_decision_maker: null }),
  ];

  it("answers only from the rows handed to it", () => {
    const a = answerBounded("no_decision_maker", {}, mine, TODAY);
    expect(a.rows.map((r) => r.opportunityId)).toEqual(["mine2"]);
  });

  it("cannot return a record that was not passed in", () => {
    // The containment is structural: the function takes rows, not a client, so
    // a record the user could not read never reaches it.
    const a = answerBounded("at_risk", {}, [], TODAY);
    expect(a.rows).toEqual([]);
    expect(a.matched).toBe(0);
  });

  it("takes no supabase client — it cannot fetch", () => {
    expect(answerBounded.length).toBe(4); // intent, params, rows, today
    expect(read("src/lib/ask-ai.ts")).not.toMatch(/from\s+"@\/integrations\/supabase/);
  });

  it("generates no SQL and builds no query string", () => {
    const src = read("src/lib/ask-ai.ts");
    expect(src).not.toMatch(/\bSELECT\b|\bFROM\b\s+\w+|\.rpc\(|\.from\(/);
  });

  it("applies a value threshold to the same set, never a wider one", () => {
    const all = answerBounded("at_risk", {}, mine, TODAY);
    const filtered = answerBounded("at_risk", { minValue: 5_000_000 }, mine, TODAY);
    expect(filtered.matched).toBeLessThanOrEqual(all.matched);
  });

  it("a value intent with no threshold answers nothing rather than everything", () => {
    // "above" with no number names no filter; returning the whole book dressed
    // as an answer would be the worst possible reading.
    const a = answerBounded("above_value", {}, mine, TODAY);
    expect(a.rows).toEqual([]);
  });

  it("at risk here means what at risk means on the dashboard", () => {
    const items = buildAttention({ opportunities: mine, today: TODAY });
    const dash = items.filter((i) => i.atRisk).map((i) => i.opportunityId).sort();
    const ask = answerBounded("at_risk", {}, mine, TODAY).rows.map((r) => r.opportunityId).sort();
    expect(ask).toEqual(dash);
  });
});

// ---- §18 / §7 the panel and its boundaries ---------------------------------

describe("the Ask panel offers no sensitive write", () => {
  const src = read("src/components/phc/AskAiPanel.tsx");

  it("never calls the orchestrator directly — it only filters rows", () => {
    expect(src).not.toMatch(/runAiAgent|ai-orchestrator/);
  });

  it("performs no database write of any kind", () => {
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  it("takes rows, not a supabase client", () => {
    expect(src).not.toMatch(/from\s+"@\/integrations\/supabase/);
  });

  it("carries the route and entity context the spec asks for", () => {
    expect(src).toMatch(/route:\s*string/);
    expect(src).toMatch(/opportunityId\?:/);
  });
});

describe("the frontend still reaches AI through one door", () => {
  it("no component calls a provider directly", () => {
    for (const f of [
      "src/components/phc/ExecutiveBrief.tsx",
      "src/components/phc/AskAiPanel.tsx",
      "src/components/phc/DataQualityPanel.tsx",
    ]) {
      const src = read(f);
      expect([f, /openai|anthropic|api\.openai|generativelanguage/i.test(src)]).toEqual([f, false]);
    }
  });

  it("the Command Center's only AI call is the orchestrator", () => {
    const src = read("src/routes/_authenticated/command-center.tsx");
    expect(src).toContain("runAiAgent");
    expect(src).not.toMatch(/fetch\(\s*["'`]https?:\/\//);
  });

  it("no chain-of-thought field is stored or rendered", () => {
    for (const f of [
      "src/lib/sales-ai.ts",
      "src/lib/ask-ai.ts",
      "src/components/phc/ExecutiveBrief.tsx",
    ]) {
      expect([f, /chain_of_thought|reasoning_trace|scratchpad/i.test(read(f))]).toEqual([f, false]);
    }
  });
});
