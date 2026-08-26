// =============================================================================
// An authoritative agent response must actually reach the screen.
//
// WHAT ESCAPED, TWICE, IN SERIES
// ------------------------------
// The first defect was the request: the Command Center asked
// sales_report_insights about "opportunities", which the registry never
// allowed, so every call returned 400. Fixing it made the second defect
// reachable: the response. The agent's strict schema returns `key_insights`,
// `risks` and `recommended_actions`; the consumer read `insights` and
// `recommendations`. Both undefined. HTTP 200, ok:true, and nothing rendered.
//
// The lesson these tests encode: proving a call SUCCEEDS proves nothing about
// whether its answer was consumed. So none of them assert on a status code.
// They feed a response that SalesReportInsightsOutputSchema itself validates
// through the real mapper and the real withAiCommentary, and assert on the
// lines a reader would see.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { SalesReportInsightsOutputSchema } from "../../supabase/functions/_shared/ai-schemas";
import {
  buildManagementBrief,
  commentaryFromReportInsights,
  isAiGenerated,
  withAiCommentary,
  type ManagementBrief,
} from "@/lib/sales-ai";
import { executiveKpis, type OppRow } from "@/lib/sales-kpis";

const TODAY = "2026-08-26";
const CTX = { today: TODAY, period: null };

/**
 * A representative response, validated by the authoritative schema itself.
 * If the schema changes shape, this stops parsing and the test fails loudly
 * rather than drifting.
 */
const AGENT_RESPONSE = SalesReportInsightsOutputSchema.parse({
  headline: "The pipeline is concentrated in submitted quotations awaiting a decision.",
  key_insights: [
    "There are 44 submitted quotations valued at 60,945,178.",
    "No open deal carries a recorded win probability.",
  ],
  risks: ["Three of the five largest deals have had no client contact in over 60 days."],
  recommended_actions: [
    "Call the BLVD District client to confirm the decision timeline.",
    "Record a win probability on the ten largest open deals.",
  ],
  confidence: 0.6,
  disclaimer: "Generated from aggregate figures; verify before acting.",
});

const OPPS: OppRow[] = [
  { id: "w", sales_stage: "won", contract_value: 4_000_000, won_at: "2026-08-10" },
  { id: "o", sales_stage: "jih", quotation_value: 9_000_000, human_win_probability: 50 },
];

const deterministic = (): ManagementBrief =>
  buildManagementBrief({ opportunities: OPPS, ctx: CTX, targetAmount: 20_000_000 });

/** The lines a reader would see, by provenance. */
const linesOf = (b: ManagementBrief) =>
  [...b.whatChanged, ...b.needsAttention, ...b.forecast, ...b.focus];
const textOf = (b: ManagementBrief) =>
  linesOf(b).map((l) => (typeof l.text === "string" ? l.text : JSON.stringify(l.text)));

describe("an authoritative response reaches the reader", () => {
  const before = deterministic();
  const { inferences, recommendations } = commentaryFromReportInsights(AGENT_RESPONSE);
  const after = withAiCommentary(before, {
    agentKey: "sales_report_insights",
    inferences,
    recommendations,
  }).brief;

  it("key_insights become visible inference lines", () => {
    const shown = textOf(after);
    for (const insight of AGENT_RESPONSE.key_insights) {
      expect([insight, shown.includes(insight)]).toEqual([insight, true]);
    }
  });

  it("recommended_actions become visible recommendation lines", () => {
    const shown = textOf(after);
    for (const action of AGENT_RESPONSE.recommended_actions) {
      expect([action, shown.includes(action)]).toEqual([action, true]);
    }
  });

  it("risks are carried, not silently dropped", () => {
    // They are part of the approved schema and are real signal. They travel on
    // the existing `inference` channel rather than in a new UI model.
    const shown = textOf(after);
    for (const risk of AGENT_RESPONSE.risks) {
      expect([risk, shown.includes(risk)]).toEqual([risk, true]);
    }
  });

  it("every added line is labelled AI-generated, never fact or calculated", () => {
    const added = linesOf(after).filter((l) => !linesOf(before).includes(l));
    expect(added.length).toBe(
      AGENT_RESPONSE.key_insights.length + AGENT_RESPONSE.risks.length +
        AGENT_RESPONSE.recommended_actions.length,
    );
    for (const l of added) {
      expect([l.provenance, isAiGenerated(l)]).toEqual([l.provenance, true]);
      expect(["fact", "calculated"]).not.toContain(l.provenance);
    }
  });

  it("the field names the consumer reads are the schema's, not invented ones", () => {
    // The regression itself: `insights` / `recommendations` are names this
    // schema has never had. Reading them yields nothing, silently.
    const wrongShape = { insights: ["x"], recommendations: [{ id: "1", text: "y" }] };
    const mapped = commentaryFromReportInsights(wrongShape);
    expect(mapped.inferences).toEqual([]);
    expect(mapped.recommendations).toEqual([]);
    expect(Object.keys(SalesReportInsightsOutputSchema.shape)).not.toContain("insights");
    expect(Object.keys(SalesReportInsightsOutputSchema.shape)).not.toContain("recommendations");
  });
});

describe("deterministic facts are untouched by commentary", () => {
  it("every pre-existing line survives byte-identical, in order", () => {
    const before = deterministic();
    const snapshot = JSON.stringify(linesOf(before));
    const { inferences, recommendations } = commentaryFromReportInsights(AGENT_RESPONSE);
    const after = withAiCommentary(before, {
      agentKey: "sales_report_insights", inferences, recommendations,
    }).brief;

    // The originals are a prefix of the result — appended to, never rewritten.
    const factLines = linesOf(after).filter((l) => !isAiGenerated(l));
    expect(JSON.stringify(factLines)).toBe(snapshot);
  });

  it("commentary cannot alter a KPI — it never receives one", () => {
    const kpis = executiveKpis(OPPS, CTX);
    const snapshot = JSON.stringify(kpis);
    const { inferences, recommendations } = commentaryFromReportInsights(AGENT_RESPONSE);
    withAiCommentary(deterministic(), { agentKey: "sales_report_insights", inferences, recommendations });
    expect(JSON.stringify(kpis)).toBe(snapshot);
  });
});

describe("forbidden actions never reach the screen", () => {
  it("a recommendation written as prose is filtered out, and the rest survive", () => {
    const hostile = {
      ...AGENT_RESPONSE,
      recommended_actions: [
        "Send an email to the client confirming the award",
        "Mark the BLVD deal as won",
        "Call the client to confirm the timeline",
      ],
    };
    const { inferences, recommendations } = commentaryFromReportInsights(hostile);
    const { brief, refused } = withAiCommentary(deterministic(), {
      agentKey: "sales_report_insights", inferences, recommendations,
    });
    expect(refused.map((r) => r.violated).sort()).toEqual(["record_won", "send_email"]);
    const shown = textOf(brief);
    expect(shown).not.toContain("Send an email to the client confirming the award");
    expect(shown).not.toContain("Mark the BLVD deal as won");
    // Refusing one must not refuse the others.
    expect(shown).toContain("Call the client to confirm the timeline");
  });

  it("the whole pipeline: safe survives, prose AND embedded-token are removed", () => {
    // schema-parsed response → mapper → withAiCommentary → filterRecommendations
    // → the lines a reader would see. All three kinds in one payload, because
    // the interesting failure is one refusal suppressing another.
    const payload = SalesReportInsightsOutputSchema.parse({
      ...AGENT_RESPONSE,
      recommended_actions: [
        "Call the BLVD District client to confirm the decision timeline.", // safe
        "Send an email to the client confirming the award",                // forbidden, prose
        "send_email to the client",                                        // forbidden, embedded token
      ],
    });
    const before = deterministic();
    const factsBefore = JSON.stringify(linesOf(before).filter((l) => !isAiGenerated(l)));

    const { inferences, recommendations } = commentaryFromReportInsights(payload);
    const { brief, refused } = withAiCommentary(before, {
      agentKey: "sales_report_insights", inferences, recommendations,
    });

    const shown = textOf(brief);
    expect(shown).toContain("Call the BLVD District client to confirm the decision timeline.");
    expect(shown).not.toContain("Send an email to the client confirming the award");
    expect(shown).not.toContain("send_email to the client");
    expect(refused.map((r) => r.violated)).toEqual(["send_email", "send_email"]);

    // Deterministic lines byte-identical, whatever the model proposed.
    expect(JSON.stringify(linesOf(brief).filter((l) => !isAiGenerated(l)))).toBe(factsBefore);
  });

  it("a bare canonical action name is refused by the exact-token check", () => {
    // recommended_actions are plain strings, so proposedAction IS the text.
    // That makes the exact-token guard the load-bearing one for this path.
    const { recommendations } = commentaryFromReportInsights({
      recommended_actions: ["send_email"],
    });
    expect(recommendations[0].proposedAction).toBe("send_email");
    const { refused } = withAiCommentary(deterministic(), {
      agentKey: "sales_report_insights", inferences: [], recommendations,
    });
    expect(refused.map((r) => r.violated)).toEqual(["send_email"]);
  });
});

describe("an empty but valid response is its own state", () => {
  const EMPTY = SalesReportInsightsOutputSchema.parse({
    headline: "Nothing notable this period.",
    key_insights: [], risks: [], recommended_actions: [],
    confidence: 0.2, disclaimer: "No commentary produced.",
  });

  it("maps to nothing, and the brief is unchanged", () => {
    const before = deterministic();
    const { inferences, recommendations } = commentaryFromReportInsights(EMPTY);
    expect(inferences).toEqual([]);
    expect(recommendations).toEqual([]);
    const after = withAiCommentary(before, {
      agentKey: "sales_report_insights", inferences, recommendations,
    }).brief;
    expect(JSON.stringify(linesOf(after))).toBe(JSON.stringify(linesOf(before)));
  });

  it("the Command Center distinguishes ok / empty / unavailable", () => {
    // The defect: ok:true with nothing rendered suppressed the caveat entirely,
    // so a broken mapping looked exactly like a model with nothing to say.
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../routes/_authenticated/command-center.tsx"), "utf8");
    expect(src).toContain('commentaryState: (rendered > 0 ? "ok" : "empty")');
    expect(src).toContain('"unavailable"');
    expect(src).not.toContain("aiUnavailable={commentary.isFetched && !commentary.data}");
    const brief = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../components/phc/ExecutiveBrief.tsx"), "utf8");
    // Non-ok states always say something; the UI never implies commentary exists.
    expect(brief).toContain('commentaryState !== "ok"');
    expect(brief).toContain("brf_ai_empty");
  });

  it("both caveat messages exist in both languages", () => {
    const i18n = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "./i18n.tsx"), "utf8");
    for (const k of ["brf_ai_unavailable", "brf_ai_empty"]) {
      expect([k, i18n.includes(`${k}: {`)]).toEqual([k, true]);
    }
    expect(i18n).toMatch(/brf_ai_empty:\s*\{[\s\S]{0,200}?ar:/);
  });
});

describe("commentary performs no write", () => {
  it("neither the mapper nor withAiCommentary can reach a database", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "./sales-ai.ts"), "utf8");
    expect(src).not.toMatch(/from\s+"@\/integrations\/supabase/);
    for (const w of [".insert(", ".update(", ".delete(", ".upsert("]) {
      expect([w, src.includes(w)]).toEqual([w, false]);
    }
  });
});
