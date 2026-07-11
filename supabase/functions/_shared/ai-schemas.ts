// =============================================================================
// PHC Sales OS — Sprint 10: Safe AI Orchestrator — schemas (pure, no I/O).
//
// Every shape that crosses a trust boundary (frontend request, provider
// response) is validated here at RUNTIME with zod, not just typed at compile
// time. This file has zero Deno-specific APIs so it is importable/testable
// from both the Edge Function (Deno, via the bare "zod" specifier resolved
// through supabase/functions/import_map.json -> npm:zod@4) and
// `bun test ./src` (bare "zod" resolves through node_modules, since zod is
// already a package.json dependency) — see src/lib/ai-schemas.test.ts.
// Matches this repo's existing _shared/conversion.ts convention of keeping
// pure logic modules portable across both runtimes.
// =============================================================================
import { z } from "zod";

// ---------------------------------------------------------------------------
// Agents, providers, entities — closed vocabularies. Anything not in these
// lists is rejected before it reaches the registry, a provider, or the DB.
// ---------------------------------------------------------------------------

export const AGENT_KEYS = [
  "opportunity_evaluation",
  "old_data_classifier",
  "smart_followup_draft",
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const PROVIDER_NAMES = ["openai", "anthropic"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

// Every entity type any agent is allowed to reference. Per-agent allowlists
// (a stricter subset) live in ai-guardrails.ts / the agent registry.
export const ENTITY_TYPES = [
  "opportunities",
  "rfqs",
  "tenders",
  "quotations",
  "companies",
  "contacts",
  "import_batches",
  "import_rows",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const TRACE_STATUSES = ["started", "succeeded", "failed", "rejected", "skipped"] as const;
export type TraceStatus = (typeof TRACE_STATUSES)[number];

export const OUTPUT_TYPES = ["recommendation", "draft", "staged_classification"] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

export const OUTPUT_STATUSES = ["pending_review", "accepted", "rejected", "superseded"] as const;
export type OutputStatus = (typeof OUTPUT_STATUSES)[number];

// Stable error codes returned to the caller and written to trace rows. Never
// expose raw provider errors, stack traces, or SQL error text — map
// everything to one of these.
export const AI_ERROR_CODES = [
  "AI_UNAUTHENTICATED",
  "AI_NOT_CONFIGURED",
  "AI_AGENT_NOT_ALLOWED",
  "AI_ENTITY_NOT_ALLOWED",
  "AI_RECORD_ACCESS_DENIED",
  "AI_INPUT_INVALID",
  "AI_CONTEXT_TOO_LARGE",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_ERROR",
  "AI_RESPONSE_PARSE_FAILED",
  "AI_OUTPUT_VALIDATION_FAILED",
  "AI_GUARDRAIL_REJECTED",
  "AI_OUTPUT_PERSIST_FAILED",
  // A concurrent request with the same idempotency key is already being
  // processed (a fresh, non-stale ai_agent_requests claim) — the caller
  // should not retry immediately; the in-flight request will produce the
  // real result. See ai-agent-registry.ts's claim flow (Required Fix 2).
  "AI_REQUEST_IN_PROGRESS",
  // The same idempotency key (requested_by + agent_key + entity_type +
  // entity_id + client_request_id) was reused with a genuinely different
  // request payload (a different request.input and/or effective provider
  // override) than the one that originally claimed it — regardless of
  // whether that prior claim is processing, stale-processing, failed, or
  // succeeded. Returned before any provider call and before any
  // ai_agent_outputs row is created. See ai-fingerprint.ts and
  // docs/ai-orchestrator.md's "Idempotency" section.
  "AI_IDEMPOTENCY_CONFLICT",
  // The output was validated and persisted, but the DB write that records
  // the request as successfully completed (the "succeeded" trace event
  // and/or the request-claim row) failed. The output row itself still
  // exists and is preserved for reconciliation — see docs/ai-orchestrator.md
  // "Reconciliation" — this is deliberately never silently reported as
  // ok:true (Required Fix 3).
  "AI_TRACE_PERSIST_FAILED",
  "AI_UNKNOWN_ERROR",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Request contract (frontend -> ai-orchestrator). `.strict()` rejects any
// field not listed here, closing off attempts to smuggle in a system prompt,
// model override, SQL, or extra context via an unrecognized key.
// ---------------------------------------------------------------------------

export const OrchestratorRequestSchema = z
  .object({
    agent: z.enum(AGENT_KEYS),
    entityType: z.enum(ENTITY_TYPES).nullable().optional(),
    entityId: z.string().uuid().nullable().optional(),
    // Agent-specific free-form input (e.g. requested channel for a draft).
    // Bounded in size by ai-guardrails.ts before it is ever used, and never
    // interpreted as instructions — only as data substituted into a fixed
    // template (see ai-prompts.ts).
    input: z.record(z.string(), z.unknown()).default({}),
    // Provider override — only honored for callers ai-guardrails.ts confirms
    // hold an administrative role; ignored (not merely rejected) otherwise.
    provider: z.enum(PROVIDER_NAMES).nullable().optional(),
    // Idempotency key, scoped per-caller-per-agent in the DB unique index.
    clientRequestId: z.string().min(1).max(128).optional(),
  })
  .strict();
export type OrchestratorRequest = z.infer<typeof OrchestratorRequestSchema>;

// ---------------------------------------------------------------------------
// Provider result envelope — the neutral shape every provider adapter must
// return, regardless of OpenAI vs. Anthropic wire format. Consumed by the
// orchestrator; agents/orchestrator never see a provider-specific shape.
// ---------------------------------------------------------------------------

export const ProviderUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;

// ---------------------------------------------------------------------------
// Agent 1 — opportunity_evaluation structured output
// ---------------------------------------------------------------------------

const QUALIFICATION_LEVELS = ["low", "medium", "high"] as const;
const PRIORITY_LEVELS = ["low", "medium", "high", "critical"] as const;

export const OpportunityEvaluationOutputSchema = z
  .object({
    overall_score: z.number().min(0).max(100),
    qualification: z.enum(QUALIFICATION_LEVELS),
    recommended_priority: z.enum(PRIORITY_LEVELS),
    win_likelihood: z.number().min(0).max(100),
    rationale: z.string().min(1).max(2000),
    strengths: z.array(z.string().min(1).max(300)).max(10),
    risks: z.array(z.string().min(1).max(300)).max(10),
    missing_information: z.array(z.string().min(1).max(300)).max(10),
    recommended_next_actions: z.array(z.string().min(1).max(300)).max(6),
    suggested_follow_up_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "suggested_follow_up_date must be YYYY-MM-DD")
      .nullable(),
    confidence: z.number().min(0).max(1),
    disclaimer: z.string().min(1).max(500),
  })
  .strict();
export type OpportunityEvaluationOutput = z.infer<typeof OpportunityEvaluationOutputSchema>;

// ---------------------------------------------------------------------------
// Agent 2 — old_data_classifier structured output
// ---------------------------------------------------------------------------

// Matches import_batches_target_entity_check in
// 20260708092659_..._data_import_center.sql — the only destinations the
// import system itself recognizes.
const IMPORT_TARGET_ENTITIES = ["companies", "contacts", "leads", "opportunities", "projects", "boq"] as const;
const CLASSIFIER_RECOMMENDED_ACTIONS = ["stage", "needs_review", "reject"] as const;

export const DuplicateCandidateSchema = z
  .object({
    entity_type: z.string().min(1).max(64),
    entity_id: z.string().uuid(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const OldDataClassifierOutputSchema = z
  .object({
    proposed_entity_type: z.enum(IMPORT_TARGET_ENTITIES),
    confidence: z.number().min(0).max(1),
    proposed_field_mapping: z.record(z.string(), z.string().max(200)),
    normalized_values: z.record(z.string(), z.unknown()),
    missing_required_fields: z.array(z.string().min(1).max(200)).max(20),
    warnings: z.array(z.string().min(1).max(300)).max(20),
    duplicate_likelihood: z.number().min(0).max(1),
    duplicate_candidates: z.array(DuplicateCandidateSchema).max(10),
    recommended_action: z.enum(CLASSIFIER_RECOMMENDED_ACTIONS),
    rationale: z.string().min(1).max(2000),
  })
  .strict();
export type OldDataClassifierOutput = z.infer<typeof OldDataClassifierOutputSchema>;

// ---------------------------------------------------------------------------
// Agent 3 — smart_followup_draft structured output
// ---------------------------------------------------------------------------

export const FOLLOWUP_CHANNELS = ["email", "whatsapp", "internal_note"] as const;
export type FollowupChannel = (typeof FOLLOWUP_CHANNELS)[number];
const DRAFT_LANGUAGES = ["en", "ar"] as const;

export const SmartFollowupDraftOutputSchema = z
  .object({
    channel: z.enum(FOLLOWUP_CHANNELS),
    language: z.enum(DRAFT_LANGUAGES),
    subject: z.string().min(1).max(200).nullable(),
    message: z.string().min(1).max(4000),
    purpose: z.string().min(1).max(300),
    call_to_action: z.string().min(1).max(300),
    suggested_send_time: z.string().min(1).max(100).nullable(),
    assumptions: z.array(z.string().min(1).max(300)).max(10),
    missing_information: z.array(z.string().min(1).max(300)).max(10),
    confidence: z.number().min(0).max(1),
    // Fixed guarantee, not a provider-controlled toggle: validation fails
    // (AI_OUTPUT_VALIDATION_FAILED) if the provider ever returns anything
    // other than `true` here — a draft claiming it doesn't need review is
    // exactly the kind of output this schema must not let through.
    requires_human_review: z.literal(true),
  })
  .strict();
export type SmartFollowupDraftOutput = z.infer<typeof SmartFollowupDraftOutputSchema>;

// Lookup used by the orchestrator to validate whichever agent ran, without a
// switch statement scattered through the request-handling code.
export const AGENT_OUTPUT_SCHEMAS = {
  opportunity_evaluation: OpportunityEvaluationOutputSchema,
  old_data_classifier: OldDataClassifierOutputSchema,
  smart_followup_draft: SmartFollowupDraftOutputSchema,
} as const satisfies Record<AgentKey, z.ZodType>;

export const AGENT_OUTPUT_TYPES = {
  opportunity_evaluation: "recommendation",
  old_data_classifier: "staged_classification",
  smart_followup_draft: "draft",
} as const satisfies Record<AgentKey, OutputType>;

// ---------------------------------------------------------------------------
// Safe response envelope returned to the caller.
// ---------------------------------------------------------------------------

export const SuccessEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    traceId: z.string().uuid(),
    outputId: z.string().uuid(),
    agent: z.enum(AGENT_KEYS),
    status: z.literal("pending_review"),
    result: z.unknown(),
  })
  .strict();

export const ErrorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum(AI_ERROR_CODES),
    message: z.string(),
    traceId: z.string().uuid().nullable(),
    // Only ever populated for AI_TRACE_PERSIST_FAILED: the output was
    // successfully created but the terminal trace event couldn't be
    // recorded. Carrying the id here is the "record enough metadata to
    // identify it" requirement — a human/ops can look the row up directly
    // even though the response itself is ok:false.
    outputId: z.string().uuid().optional(),
  })
  .strict();
