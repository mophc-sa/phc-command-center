import { describe, test, expect } from "bun:test";
import { buildDailyAssistant } from "../../supabase/functions/_shared/ai-daily";
import {
  verifyCitations,
  draftHasUnsupportedCompletion,
  groundedModel,
  referenceHasUnsupportedCompletion,
  referenceEvidenceFallback,
  groundCompanyKnowledge,
  type GroundedAnswer,
} from "../../supabase/functions/_shared/ai-grounding";
import { gradeEvaluation, estimateAiCost } from "../../supabase/functions/_shared/ai-quality";
import { embedKnowledge } from "../../supabase/functions/_shared/knowledge-embedding";
test("measured knowledge routing preserves daily and explicitly configured alternatives", () => {
  expect(groundedModel("company_knowledge", "openai", "gpt-4o-mini")).toBe("gpt-4.1-mini");
  expect(groundedModel("daily_meeting_brief", "openai", "gpt-4o-mini")).toBe("gpt-4o-mini");
  expect(groundedModel("company_knowledge", "anthropic", "claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  expect(groundedModel("company_knowledge", "openai", "custom-model")).toBe("custom-model");
});
test("reference years cannot be converted into English or Arabic completion claims", () => {
  const source = { id: "ref", source_type: "reference_project", source_id: "project", title: "Reference", content: "Recorded year: 2025; scope: signage" };
  const answer = (text: string): GroundedAnswer => ({ claims: [{ text, citations: ["ref"] }], questions: [], suggested_tasks: [], draft: null, insufficient_evidence: false });
  expect(referenceHasUnsupportedCompletion(answer("المشروع تم تنفيذه في عام 2025"), [source])).toBe(true);
  expect(referenceHasUnsupportedCompletion(answer("The project was completed in 2025"), [source])).toBe(true);
  expect(referenceHasUnsupportedCompletion(answer("The reference records year 2025 and signage scope"), [source])).toBe(false);
  expect(referenceHasUnsupportedCompletion(answer("يسجّل المرجع عام 2025 ونطاق اللوحات"), [source])).toBe(false);
  expect(referenceHasUnsupportedCompletion(answer("The project was completed in 2025"), [{ ...source, source_type: "document" }])).toBe(false);
  const fallback = referenceEvidenceFallback(answer("المشروع تم تنفيذه في عام 2025"), [source, { ...source, id: "uncited", content: "Unrelated source" }], "ar");
  expect(fallback.claims).toHaveLength(1);
  expect(fallback.claims[0].text).toContain(source.content);
  expect(fallback.claims[0].text).not.toContain("تم تنفيذه");
  expect(fallback.insufficient_evidence).toBe(true);
  expect(fallback.suggested_tasks).toEqual([]);
  expect(fallback.draft).toBeNull();
  expect(verifyCitations(fallback, [source])).toBe(true);
  const knowledge = groundCompanyKnowledge(answer("المشروع من المقرر أن يكون في عام 2025"), [source], "ar");
  expect(knowledge.claims[0].text).toContain(source.content);
  expect(knowledge.claims[0].text).not.toContain("من المقرر");
  expect(knowledge.draft).toBeNull();
  expect(knowledge.insufficient_evidence).toBe(true);
  const factual = groundCompanyKnowledge(answer("يسجّل المرجع عام 2025 ونطاق اللوحات"), [source], "ar");
  expect(factual.claims[0].text).toContain(source.content);
  expect(factual.insufficient_evidence).toBe(false);
});

describe("employee assistant decisions", () => {
  test("overdue work outranks future follow-ups; terminal deals do not generate next-action tasks", () => {
    const output = buildDailyAssistant(
      {
        opportunities: [
          {
            id: "a",
            updated_at: "2026-09-01",
            project_name: "A",
            stage: "qualification",
            sales_stage: "rfq_received",
            next_action: null,
            next_action_due: null,
          },
          {
            id: "won",
            updated_at: "2026-09-01",
            project_name: "Won",
            stage: "won",
            sales_stage: "won",
            next_action: null,
            next_action_due: null,
          },
        ],
        followups: [
          {
            id: "future",
            updated_at: "2026-09-01",
            opportunity_id: "a",
            due_date: "2026-09-12",
            notes: null,
            channel: "email",
          },
          {
            id: "late",
            updated_at: "2026-09-01",
            opportunity_id: "a",
            due_date: "2026-09-07",
            notes: null,
            channel: "email",
          },
        ],
        rfqs: [],
        boqs: [],
        boqItems: [],
      },
      "ar",
      "2026-09-08",
    );
    expect(output.suggestions[0].source_id).toBe("late");
    expect(output.suggestions[0].reasons).toContain("متأخر عن موعده");
    expect(output.suggestions.some((s) => s.source_id === "won")).toBe(false);
  });
  test("BOQ zero price is recorded, missing quantity or material is a review gap", () => {
    const result = buildDailyAssistant(
      {
        opportunities: [],
        followups: [],
        rfqs: [],
        boqs: [
          {
            id: "b",
            updated_at: "now",
            title: "BOQ",
            related_opportunity_id: "o",
            assumptions: null,
            missing_items: null,
          },
        ],
        boqItems: [
          { id: "i", boq_id: "b", sign_type: "sign", quantity: 1, material: "steel", unit_rate: 0 },
        ],
      },
      "en",
      "2026-09-08",
    );
    expect(result.suggestions).toHaveLength(0);
  });
});
describe("grounding and evaluation", () => {
  const empty: GroundedAnswer = {
    claims: [],
    questions: [],
    suggested_tasks: [],
    draft: null,
    insufficient_evidence: true,
  };
  test("no evidence cannot produce a supposedly grounded claim", () => {
    expect(verifyCitations(empty, [])).toBe(true);
    expect(
      verifyCitations(
        { ...empty, claims: [{ text: "Contract approved", citations: ["hidden"] }] },
        [],
      ),
    ).toBe(false);
  });
  test("citations on suggested tasks and drafts are validated too", () => {
    const sources = [
      {
        id: "allowed",
        source_type: "document",
        source_id: "d",
        title: "D",
        content: "Permitted text",
      },
    ];
    expect(
      verifyCitations(
        { ...empty, draft: { subject: "draft", body: "text", citations: ["foreign"] } },
        sources,
      ),
    ).toBe(false);
    expect(
      verifyCitations(
        {
          ...empty,
          suggested_tasks: [{ title: "Task", rationale: "Reason", citations: ["foreign"] }],
        },
        sources,
      ),
    ).toBe(false);
  });
  test("missing facts cannot be scored as zero; duplicates and fabricated citations fail", () => {
    const expected = {
      facts: { count: 414, value: null },
      source_ids: ["snapshot"],
      abstained: false,
    };
    const good = {
      facts: [
        { key: "count", value: 414 },
        { key: "value", value: null },
      ],
      source_ids: ["snapshot"],
      answer: "Data available",
      next_actions: [],
      abstained: false,
    };
    expect(gradeEvaluation(good, expected).passed).toBe(true);
    expect(
      gradeEvaluation(
        {
          ...good,
          facts: [
            { key: "count", value: 414 },
            { key: "value", value: 0 },
          ],
        },
        expected,
      ).numerical_accuracy,
    ).toBe(0.5);
    expect(
      gradeEvaluation({ ...good, facts: [...good.facts, { key: "count", value: 414 }] }, expected)
        .passed,
    ).toBe(false);
    expect(gradeEvaluation({ ...good, source_ids: ["fabricated"] }, expected).passed).toBe(false);
  });
  test("unknown prices remain unknown rather than reporting free AI", () => {
    expect(estimateAiCost("unknown", 1000, 1000).usd).toBeNull();
    expect(estimateAiCost("gpt-4o-mini", 1000, 1000).usd).toBeCloseTo(0.00075, 9);
    expect(estimateAiCost("claude-sonnet-4-6", 1000, 1000).usd).toBeCloseTo(0.018, 9);
    expect(estimateAiCost("claude-sonnet-4-6", 1000, 1000).basis).toContain("Anthropic");
    expect(estimateAiCost("gpt-4o-mini").usd).toBeNull();
  });
});
test("multilingual embeddings request one fixed vector space and reject invalid vectors", async () => {
  let body: Record<string, unknown> = {};
  const fetcher = (async (_url: unknown, options: RequestInit) => {
    body = JSON.parse(String(options.body));
    return Response.json({
      data: [{ embedding: Array(384).fill(0.1) }],
      usage: { total_tokens: 5 },
    });
  }) as typeof fetch;
  const result = await embedKnowledge("مشروع لوحات إرشادية", "test-key", fetcher);
  expect(body.model).toBe("text-embedding-3-small");
  expect(body.dimensions).toBe(384);
  expect(result.tokens).toBe(5);
  await expect(
    embedKnowledge("text", "test-key", (async () =>
      Response.json({ data: [{ embedding: Array(383).fill(1) }] })) as typeof fetch),
  ).rejects.toThrow("Invalid company knowledge embedding");
});


test("grounded drafts do not invent an employee's previous submission", () => {
  const base: GroundedAnswer={claims:[],questions:[],suggested_tasks:[],insufficient_evidence:false,draft:{subject:"RFQ follow-up",body:"I am following up on our recent submission.",citations:["rfq"]}};
  expect(draftHasUnsupportedCompletion(base)).toBe(true);
  expect(draftHasUnsupportedCompletion({...base,draft:{...base.draft!,body:"Please confirm the current status and any outstanding information required for the RFQ."}})).toBe(false);
});
