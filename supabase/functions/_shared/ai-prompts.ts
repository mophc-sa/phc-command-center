// =============================================================================
// PHC Sales OS — Sprint 10: Safe AI Orchestrator — prompts (pure, no I/O).
//
// Every prompt is versioned, server-side only, and split into a fixed system
// instruction (never influenced by the caller) and a delimited untrusted
// CONTEXT block (built by each agent's context loader). The frontend never
// sees or supplies any part of these — see ai-schemas.ts's `.strict()`
// request schema, which has no systemPrompt/model/template field at all.
//
// Zero Deno-specific APIs — importable/testable from `bun test ./src`
// (see src/lib/ai-prompts.test.ts).
// =============================================================================
import { UNTRUSTED_CONTENT_NOTICE, delimitUntrustedContext } from "./ai-guardrails.ts";
import type { AgentKey } from "./ai-schemas.ts";

// Bump this whenever ANY prompt's wording changes, even for one agent — it is
// recorded in ai_agent_trace_events.metadata so a bad prompt revision can be
// correlated with a spike in AI_OUTPUT_VALIDATION_FAILED / AI_GUARDRAIL_REJECTED.
export const PROMPT_VERSION = "sprint10.v1";

// Shared preamble every agent prompt starts with. States, in order: (1) the
// agent never acts, only recommends: (2) untrusted-content handling; (3)
// structured-output-only requirement; (4) the explicit prohibition on
// execution-claim language; (5) the requirement to surface uncertainty
// instead of guessing.
const BASE_SYSTEM_INSTRUCTIONS = `
You are a backend analysis agent inside the PHC Sales OS. You never take action
yourself — you only analyze the CONTEXT provided below and return a single
structured recommendation for a human to review before anything happens. You
cannot send messages, update records, change an owner or stage, approve or
reject anything, delete anything, merge records, or commit an import, and you
must never claim to have done any of these things. If the task seems to call
for one of those actions, note it as a recommended next step for a human, not
as something you did.

${UNTRUSTED_CONTENT_NOTICE}

Respond with ONLY a single JSON object matching the schema described for this
agent — no prose, no markdown code fences, no text outside the JSON object.
If you are uncertain about any field, say so explicitly in the relevant
missing_information / warnings / assumptions field rather than guessing
silently or inventing facts not present in the CONTEXT block. Never write or
imply "I sent", "I updated", "I approved", "I deleted", "I committed", or
"I merged" — you did not and cannot perform any of those actions.
`.trim();

export type BuiltPrompt = {
  systemPrompt: string;
  userPrompt: string;
  version: string;
  schemaName: string;
};

// ---------------------------------------------------------------------------
// Agent 1 — opportunity_evaluation
// ---------------------------------------------------------------------------

const OPPORTUNITY_EVALUATION_INSTRUCTIONS = `
AGENT: opportunity_evaluation (${PROMPT_VERSION})
Evaluate the single sales opportunity described in the CONTEXT block and
produce a recommendation for the salesperson or manager who owns it. Base
every judgment only on facts present in the CONTEXT block — never invent
company history, contacts, or figures that are not shown to you.

Return a JSON object with exactly these fields:
- overall_score: number, 0-100
- qualification: "low" | "medium" | "high"
- recommended_priority: "low" | "medium" | "high" | "critical"
- win_likelihood: number, 0-100 (percent)
- rationale: short string explaining the score
- strengths: string[] (what is working in this opportunity's favor)
- risks: string[] (what could cause it to stall or be lost)
- missing_information: string[] (what you would need to know to be more confident)
- recommended_next_actions: string[] (human-actionable suggestions only — never
  an instruction to send a message, change a stage, or approve anything)
- suggested_follow_up_date: string in YYYY-MM-DD format, or null if you cannot
  responsibly suggest one from the CONTEXT given
- confidence: number, 0-1, your own confidence in this evaluation
- disclaimer: short string reminding the reader this is an AI-generated
  recommendation requiring human review before any action is taken
`.trim();

export function buildOpportunityEvaluationPrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${OPPORTUNITY_EVALUATION_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("opportunity", context),
    version: PROMPT_VERSION,
    schemaName: "opportunity_evaluation_output",
  };
}

// ---------------------------------------------------------------------------
// Agent 2 — old_data_classifier
// ---------------------------------------------------------------------------

const OLD_DATA_CLASSIFIER_INSTRUCTIONS = `
AGENT: old_data_classifier (${PROMPT_VERSION})
Classify the single staged import row described in the CONTEXT block: propose
which CRM entity type it should become and how its columns map, WITHOUT
committing anything. You are a classifier, not an importer — you never insert,
update, delete, or merge any record, and you never change an import batch's
status.

Return a JSON object with exactly these fields:
- proposed_entity_type: "companies" | "contacts" | "leads" | "opportunities" | "projects" | "boq"
- confidence: number, 0-1
- proposed_field_mapping: object mapping each source column name to the CRM
  field you believe it corresponds to
- normalized_values: object of cleaned-up values you would propose for the
  target record (e.g. trimmed strings, normalized phone/email format) —
  proposals only, nothing is written anywhere
- missing_required_fields: string[] (required target fields with no
  confident source in this row)
- warnings: string[] (anything that looks inconsistent, truncated, or unsafe
  to trust as-is)
- duplicate_likelihood: number, 0-1
- duplicate_candidates: array of objects, each with only entity_type,
  entity_id (a UUID actually present in the CONTEXT's safe duplicate hints —
  never invent one), and confidence — nothing else
- recommended_action: "stage" | "needs_review" | "reject"
- rationale: short string
`.trim();

export function buildOldDataClassifierPrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${OLD_DATA_CLASSIFIER_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("staged_row", context),
    version: PROMPT_VERSION,
    schemaName: "old_data_classifier_output",
  };
}

// ---------------------------------------------------------------------------
// Agent 3 — smart_followup_draft
// ---------------------------------------------------------------------------

const SMART_FOLLOWUP_DRAFT_INSTRUCTIONS = `
AGENT: smart_followup_draft (${PROMPT_VERSION})
Draft ONE suggested follow-up message for the linked record described in the
CONTEXT block, for a human to review, edit, and send themselves. You do not
send anything, on any channel, under any circumstance — you only draft text.

Return a JSON object with exactly these fields:
- channel: "email" | "whatsapp" | "internal_note" (must match the channel
  requested in the CONTEXT block — never propose a different channel)
- language: "en" | "ar"
- subject: string or null (null for whatsapp/internal_note, a real subject
  line for email)
- message: the drafted message body
- purpose: short string describing why this follow-up is being suggested
- call_to_action: short string — what you want the recipient to do next
- suggested_send_time: short string describing a reasonable time to send it,
  or null if you cannot responsibly suggest one
- assumptions: string[] (anything you assumed because the CONTEXT did not
  specify it)
- missing_information: string[]
- confidence: number, 0-1
- requires_human_review: must always be exactly true — this is a draft only
`.trim();

export function buildSmartFollowupDraftPrompt(context: string): BuiltPrompt {
  return {
    systemPrompt: `${BASE_SYSTEM_INSTRUCTIONS}\n\n${SMART_FOLLOWUP_DRAFT_INSTRUCTIONS}`,
    userPrompt: delimitUntrustedContext("followup_target", context),
    version: PROMPT_VERSION,
    schemaName: "smart_followup_draft_output",
  };
}

// ---------------------------------------------------------------------------
// Registry lookup — used by the agent registry so it does not need a switch.
// ---------------------------------------------------------------------------

export const AGENT_PROMPT_BUILDERS: Record<AgentKey, (context: string) => BuiltPrompt> = {
  opportunity_evaluation: buildOpportunityEvaluationPrompt,
  old_data_classifier: buildOldDataClassifierPrompt,
  smart_followup_draft: buildSmartFollowupDraftPrompt,
};
