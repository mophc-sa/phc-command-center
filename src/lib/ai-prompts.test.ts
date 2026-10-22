// PHC Sales OS — Sprint 10 Safe AI Orchestrator: prompt tests. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  PROMPT_VERSION,
  buildOpportunityEvaluationPrompt,
  buildOldDataClassifierPrompt,
  buildSmartFollowupDraftPrompt,
  AGENT_PROMPT_BUILDERS,
} from "../../supabase/functions/_shared/ai-prompts";

test("PROMPT_VERSION is a non-empty, stable version string", () => {
  expect(typeof PROMPT_VERSION).toBe("string");
  expect(PROMPT_VERSION.length).toBeGreaterThan(0);
});

test("every prompt builder records the current PROMPT_VERSION", () => {
  const builders = [buildOpportunityEvaluationPrompt, buildOldDataClassifierPrompt, buildSmartFollowupDraftPrompt];
  for (const build of builders) {
    const built = build("some context");
    expect(built.version).toBe(PROMPT_VERSION);
  }
});

test("prompt builders separate system instruction from the untrusted context (context appears only in userPrompt)", () => {
  const built = buildOpportunityEvaluationPrompt("SECRET_MARKER_XYZ");
  expect(built.userPrompt).toContain("SECRET_MARKER_XYZ");
  expect(built.systemPrompt).not.toContain("SECRET_MARKER_XYZ");
});

test("every system prompt states embedded content is untrusted and must not be followed as instructions", () => {
  for (const build of Object.values(AGENT_PROMPT_BUILDERS)) {
    const built = build("context");
    expect(built.systemPrompt.toLowerCase()).toContain("untrusted");
    expect(built.systemPrompt.toLowerCase()).toContain("never as instructions");
  }
});

test("every system prompt explicitly prohibits execution-claim language", () => {
  for (const build of Object.values(AGENT_PROMPT_BUILDERS)) {
    const built = build("context");
    const lower = built.systemPrompt.toLowerCase();
    expect(lower).toContain("i sent");
    expect(lower).toContain("i approved");
  }
});

test("every system prompt requires structured JSON-only output, no prose", () => {
  for (const build of Object.values(AGENT_PROMPT_BUILDERS)) {
    const built = build("context");
    expect(built.systemPrompt.toLowerCase()).toContain("only a single json object");
  }
});

test("every system prompt requires surfacing uncertainty / missing information rather than guessing", () => {
  for (const build of Object.values(AGENT_PROMPT_BUILDERS)) {
    const built = build("context");
    expect(built.systemPrompt.toLowerCase()).toContain("missing_information");
  }
});

test("each agent has a distinct schemaName", () => {
  const names = Object.values(AGENT_PROMPT_BUILDERS).map((build) => build("x").schemaName);
  expect(new Set(names).size).toBe(names.length);
});

test("smart_followup_draft prompt requires requires_human_review to always be true", () => {
  const built = buildSmartFollowupDraftPrompt("context");
  expect(built.systemPrompt).toContain("requires_human_review");
  expect(built.systemPrompt.toLowerCase()).toContain("must always be exactly true");
});

test("old_data_classifier prompt forbids committing or writing to CRM tables", () => {
  const built = buildOldDataClassifierPrompt("context");
  const lower = built.systemPrompt.toLowerCase();
  expect(lower).toMatch(/never insert,\s*update, delete, or merge/);
});

// Final review C1: the triage prompt must name every `request` key the schema
// demands (all present, null when not stated), or a valid answer can never pass.
test("info_mail_triage prompt lists every request key with its type", async () => {
  const { InfoMailTriageOutputSchema } = await import("../../supabase/functions/_shared/ai-schemas");
  const request = InfoMailTriageOutputSchema.shape.request.unwrap();
  const keys = Object.keys(request.shape);
  expect(keys.length).toBe(11);
  const prompt = AGENT_PROMPT_BUILDERS.info_mail_triage("context").systemPrompt;
  for (const key of keys) expect(prompt).toContain(key);
  expect(prompt).toMatch(/estimated_value[^\n]*number/);
  expect(prompt).toMatch(/deadline[^\n]*YYYY-MM-DD/);
  expect(prompt.toLowerCase()).toContain("every key");
});
