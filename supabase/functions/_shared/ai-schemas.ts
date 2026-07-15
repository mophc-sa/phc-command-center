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
  "data_cleanup",
  "contact_mapping",
  "project_radar",
  "risk_finance",
  // Import Intelligence v2 — classification pipeline
  "workbook_classifier",
  "sheet_classifier",
  "semantic_field_mapper",
  "entity_extractor",
  "relationship_resolver",
  "change_interpreter",
  "import_routing_reviewer",
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
  "pipeline",
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

// ---------------------------------------------------------------------------
// Agent 4 — data_cleanup structured output
// ---------------------------------------------------------------------------

export const DataCleanupOutputSchema = z
  .object({
    corrections: z
      .array(
        z
          .object({
            row_id: z.string().min(1),
            field: z.string().min(1).max(200),
            original: z.unknown(),
            corrected: z.unknown(),
            reason: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(200),
    duplicates: z
      .array(
        z
          .object({
            row_ids: z.array(z.string().min(1)).min(2),
            reason: z.string().min(1).max(500),
            duplicate_type: z.enum(["within_batch", "existing_record"]),
            existing_id: z.string().optional(),
          })
          .strict(),
      )
      .max(100),
    quality_score: z.number().min(0).max(100),
    quality_summary: z.string().min(1).max(300),
  })
  .strict();
export type DataCleanupOutput = z.infer<typeof DataCleanupOutputSchema>;

// ---------------------------------------------------------------------------
// Agent 5 — contact_mapping structured output
// ---------------------------------------------------------------------------

export const ContactMappingOutputSchema = z
  .object({
    classifications: z
      .array(
        z
          .object({
            row_id: z.string().min(1),
            entity_type: z.enum(["companies", "contacts", "leads", "ambiguous"]),
            confidence: z.number().min(0).max(1),
            reason: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(100),
    contact_company_links: z
      .array(
        z
          .object({
            contact_row_id: z.string().min(1),
            company_row_id: z.string().optional(),
            existing_company_id: z.string().optional(),
            company_name: z.string().min(1).max(300),
            confidence: z.number().min(0).max(1),
            match_basis: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(100),
    suggested_splits: z
      .array(
        z
          .object({
            row_id: z.string().min(1),
            reason: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type ContactMappingOutput = z.infer<typeof ContactMappingOutputSchema>;

// ---------------------------------------------------------------------------
// Agent 6 — project_radar structured output
// ---------------------------------------------------------------------------

const RADAR_ALERT_TYPES = [
  "stale_opportunity",
  "missing_boq",
  "inactive_account",
  "stage_bottleneck",
  "approaching_deadline",
  "pattern",
] as const;

const RADAR_ENTITY_TYPES = ["opportunities", "companies", "leads"] as const;

const SEVERITY_LEVELS = ["low", "medium", "high"] as const;

export const ProjectRadarOutputSchema = z
  .object({
    radar_alerts: z
      .array(
        z
          .object({
            alert_type: z.enum(RADAR_ALERT_TYPES),
            entity_type: z.enum(RADAR_ENTITY_TYPES),
            entity_id: z.string().min(1),
            entity_name: z.string().min(1).max(300),
            severity: z.enum(SEVERITY_LEVELS),
            description: z.string().min(1).max(500),
            recommended_action: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(100),
    pipeline_health_score: z.number().min(0).max(100),
    summary: z.string().min(1).max(500),
  })
  .strict();
export type ProjectRadarOutput = z.infer<typeof ProjectRadarOutputSchema>;

// ---------------------------------------------------------------------------
// Agent 7 — risk_finance structured output
// ---------------------------------------------------------------------------

const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
const IMPACT_LEVELS = ["low", "medium", "high"] as const;

export const RiskFinanceOutputSchema = z
  .object({
    risk_score: z.number().min(0).max(100),
    risk_level: z.enum(RISK_LEVELS),
    risk_factors: z
      .array(
        z
          .object({
            factor: z.string().min(1).max(300),
            impact: z.enum(IMPACT_LEVELS),
            description: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(20),
    mitigations: z
      .array(
        z
          .object({
            action: z.string().min(1).max(300),
            priority: z.enum(IMPACT_LEVELS),
          })
          .strict(),
      )
      .max(20),
    confidence: z.number().min(0).max(1),
    disclaimer: z.string().min(1).max(500),
  })
  .strict();
export type RiskFinanceOutput = z.infer<typeof RiskFinanceOutputSchema>;

// ---------------------------------------------------------------------------
// Import Intelligence v2 — 7 classification pipeline agents
// ---------------------------------------------------------------------------

const SOURCE_KINDS = [
  "client_relations", "project_reference", "sales_overview",
  "protenders_leads", "quotation_masterlist", "weekly_sales_update", "unknown",
] as const;

const SHEET_RECOMMENDED_ACTIONS = ["import", "skip", "review"] as const;
const CHANGE_RECOMMENDED_ACTIONS = ["proceed", "review", "hold"] as const;
const ROUTING_RECOMMENDATIONS = ["approve", "review", "hold"] as const;
const FINDING_SEVERITIES = ["info", "warning", "critical"] as const;
const CHANGE_SEVERITIES = ["info", "warning", "critical"] as const;

// Agent 8 — workbook_classifier
// Top-level uses strip (default) not strict: json_object mode lets the AI add
// explanatory fields; stripping them is safer than failing validation.
export const WorkbookClassifierOutputSchema = z
  .object({
    detected_source_kind: z.enum(SOURCE_KINDS),
    detected_entity_type: z.enum(IMPORT_TARGET_ENTITIES),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(500),
    sheet_summary: z
      .array(
        z.object({
          sheet_name: z.string().min(1).max(200),
          row_count: z.number().int().nonnegative(),
          notes: z.string().max(300),
        }),
      )
      .max(20),
    warnings: z.array(z.string().min(1).max(300)).max(10),
  });
export type WorkbookClassifierOutput = z.infer<typeof WorkbookClassifierOutputSchema>;

// Agent 9 — sheet_classifier
export const SheetClassifierOutputSchema = z
  .object({
    sheets: z
      .array(
        z.object({
          sheet_name: z.string().min(1).max(200),
          detected_entity_type: z.enum(IMPORT_TARGET_ENTITIES),
          confidence: z.number().min(0).max(1),
          recommended_action: z.enum(SHEET_RECOMMENDED_ACTIONS),
          rationale: z.string().min(1).max(300),
        }),
      )
      .max(20),
    recommended_primary_sheet: z.string().min(1).max(200),
    warnings: z.array(z.string().min(1).max(300)).max(10),
  });
export type SheetClassifierOutput = z.infer<typeof SheetClassifierOutputSchema>;

// Agent 10 — semantic_field_mapper
export const SemanticFieldMapperOutputSchema = z
  .object({
    proposals: z
      .array(
        z.object({
          source_column: z.string().min(1).max(200),
          suggested_target: z.string().min(1).max(200),
          confidence: z.number().min(0).max(1),
          rationale: z.string().min(1).max(300),
        }),
      )
      .max(100),
    unmapped_columns: z.array(z.string().min(1).max(200)).max(100),
    warnings: z.array(z.string().min(1).max(300)).max(10),
  });
export type SemanticFieldMapperOutput = z.infer<typeof SemanticFieldMapperOutputSchema>;

// Agent 11 — entity_extractor
export const EntityExtractorOutputSchema = z
  .object({
    split_proposals: z
      .array(
        z.object({
          source_row_id: z.string().uuid(),
          entities: z
            .array(
              z.object({
                entity_type: z.enum(IMPORT_TARGET_ENTITIES),
                proposed_payload: z.record(z.string(), z.unknown()),
                role: z.string().min(1).max(100),
              }),
            )
            .min(2)
            .max(10),
        }),
      )
      .max(50),
    multi_entity_count: z.number().int().nonnegative(),
    rationale: z.string().min(1).max(500),
  });
export type EntityExtractorOutput = z.infer<typeof EntityExtractorOutputSchema>;

// Agent 12 — relationship_resolver
export const RelationshipResolverOutputSchema = z
  .object({
    links: z
      .array(
        z.object({
          from_entity_ref: z.string().min(1).max(200),
          to_entity_ref: z.string().min(1).max(200),
          relationship_type: z.string().min(1).max(100),
          confidence: z.number().min(0).max(1),
          rationale: z.string().min(1).max(300),
        }),
      )
      .max(100),
    unresolved: z
      .array(
        z.object({
          entity_ref: z.string().min(1).max(200),
          reason: z.string().min(1).max(300),
        }),
      )
      .max(50),
  });
export type RelationshipResolverOutput = z.infer<typeof RelationshipResolverOutputSchema>;

// Agent 13 — change_interpreter
export const ChangeInterpreterOutputSchema = z
  .object({
    change_summary: z.string().min(1).max(500),
    new_records_count: z.number().int().nonnegative(),
    updated_records_count: z.number().int().nonnegative(),
    removed_records_count: z.number().int().nonnegative(),
    notable_changes: z
      .array(
        z.object({
          description: z.string().min(1).max(300),
          severity: z.enum(CHANGE_SEVERITIES),
        }),
      )
      .max(20),
    confidence: z.number().min(0).max(1),
    recommended_action: z.enum(CHANGE_RECOMMENDED_ACTIONS),
  });
export type ChangeInterpreterOutput = z.infer<typeof ChangeInterpreterOutputSchema>;

// Agent 14 — import_routing_reviewer
export const ImportRoutingReviewerOutputSchema = z
  .object({
    overall_recommendation: z.enum(ROUTING_RECOMMENDATIONS),
    confidence: z.number().min(0).max(1),
    findings: z
      .array(
        z.object({
          severity: z.enum(FINDING_SEVERITIES),
          title: z.string().min(1).max(100),
          description: z.string().min(1).max(300),
        }),
      )
      .max(20),
    requires_human_review: z.literal(true),
  });
export type ImportRoutingReviewerOutput = z.infer<typeof ImportRoutingReviewerOutputSchema>;

// Lookup used by the orchestrator to validate whichever agent ran, without a
// switch statement scattered through the request-handling code.
export const AGENT_OUTPUT_SCHEMAS = {
  opportunity_evaluation: OpportunityEvaluationOutputSchema,
  old_data_classifier: OldDataClassifierOutputSchema,
  smart_followup_draft: SmartFollowupDraftOutputSchema,
  data_cleanup: DataCleanupOutputSchema,
  contact_mapping: ContactMappingOutputSchema,
  project_radar: ProjectRadarOutputSchema,
  risk_finance: RiskFinanceOutputSchema,
  workbook_classifier: WorkbookClassifierOutputSchema,
  sheet_classifier: SheetClassifierOutputSchema,
  semantic_field_mapper: SemanticFieldMapperOutputSchema,
  entity_extractor: EntityExtractorOutputSchema,
  relationship_resolver: RelationshipResolverOutputSchema,
  change_interpreter: ChangeInterpreterOutputSchema,
  import_routing_reviewer: ImportRoutingReviewerOutputSchema,
} as const satisfies Record<AgentKey, z.ZodType>;

export const AGENT_OUTPUT_TYPES = {
  opportunity_evaluation: "recommendation",
  old_data_classifier: "staged_classification",
  smart_followup_draft: "draft",
  data_cleanup: "staged_classification",
  contact_mapping: "staged_classification",
  project_radar: "recommendation",
  risk_finance: "recommendation",
  workbook_classifier: "staged_classification",
  sheet_classifier: "staged_classification",
  semantic_field_mapper: "staged_classification",
  entity_extractor: "staged_classification",
  relationship_resolver: "staged_classification",
  change_interpreter: "recommendation",
  import_routing_reviewer: "recommendation",
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
