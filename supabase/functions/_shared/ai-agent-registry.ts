// =============================================================================
// PHC Sales OS — Sprint 10: Safe AI Orchestrator — agent registry.
//
// Single source of truth for "what is agent X allowed to do" — allowed entity
// types, role/ownership rules, context loader, prompt builder, and output
// schema all live in one object per agent, looked up by key. The orchestrator
// (index.ts) never branches on agent name itself; it only calls into
// AGENT_REGISTRY[agentKey].
//
// This module touches the database (via the injected SupabaseClient), so —
// unlike ai-schemas.ts / ai-guardrails.ts / ai-prompts.ts / ai-providers.ts —
// it is Deno/Edge-Function-only and not imported into `bun test ./src`.
// Context-shaping is still deliberately minimal per agent (see each loader's
// comment) to satisfy "load only the minimum required context."
// =============================================================================
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  AGENT_OUTPUT_SCHEMAS,
  AGENT_OUTPUT_TYPES,
  FOLLOWUP_CHANNELS,
  type AgentKey,
  type EntityType,
  type OutputType,
} from "./ai-schemas.ts";
import { AGENT_PROMPT_BUILDERS, type BuiltPrompt } from "./ai-prompts.ts";
import {
  AGENT_ENTITY_ALLOWLIST,
  AGENT_ROLE_CHECK,
  bypassesOwnership,
  isOwnedBy,
  ownerFieldFor,
} from "./ai-guardrails.ts";
import type { AppRole } from "./roles.ts";
import type { z } from "zod";

// Redacts a UUID for the trace's context_manifest (audit-safe summary only —
// the real ID is still used in the actual prompt content sent to the
// provider, where the agent needs it to be useful, e.g. echoing a duplicate
// candidate's real id back for a human reviewer to look up).
export function redactId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export type ContextManifest = {
  fields_loaded: string[];
  record_counts: Record<string, number>;
  source_entity_types: string[];
  redacted_identifiers: Record<string, string | null>;
};

export type AgentContextResult =
  | { ok: true; contextText: string; manifest: ContextManifest; recordCount: number }
  | { ok: false; code: "AI_INPUT_INVALID" | "AI_ENTITY_NOT_ALLOWED"; message: string };

export type AgentAccessResult = { ok: true } | { ok: false; code: "AI_RECORD_ACCESS_DENIED"; message: string };

export type AgentDefinition = {
  key: AgentKey;
  allowedEntityTypes: readonly EntityType[];
  hasRole: (roles: AppRole[]) => boolean;
  checkAccess: (svc: SupabaseClient, entityType: EntityType, entityId: string, userId: string, roles: AppRole[]) => Promise<AgentAccessResult>;
  loadContext: (svc: SupabaseClient, entityType: EntityType, entityId: string, input: Record<string, unknown>) => Promise<AgentContextResult>;
  buildPrompt: (context: string) => BuiltPrompt;
  outputSchema: z.ZodType;
  outputType: OutputType;
  maxContextRecords: number;
  allowProviderFallback: true; // uniform in this sprint — every agent degrades gracefully, none is exempt.
};

// Generic ownership check shared by every agent whose entity type has an
// owner column (opportunities/rfqs/tenders/quotations/companies/contacts —
// see ownerFieldFor() in ai-guardrails.ts for the exact column per type,
// since companies uses account_owner_id rather than owner_id). Entity types
// with no owner column at all (import_batches, import_rows) fall through to
// role-only access.
async function checkOwnershipAccess(
  svc: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  userId: string,
  roles: AppRole[],
): Promise<AgentAccessResult> {
  if (bypassesOwnership(roles)) return { ok: true };
  const ownerField = ownerFieldFor(entityType);
  if (!ownerField) return { ok: true };
  const { data } = await svc.from(entityType).select(ownerField).eq("id", entityId).maybeSingle();
  const ownerValue = data ? (data as Record<string, unknown>)[ownerField] : null;
  if (!isOwnedBy(ownerValue, userId)) {
    return { ok: false, code: "AI_RECORD_ACCESS_DENIED", message: "You do not have access to this record." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Agent 1 — opportunity_evaluation
// ---------------------------------------------------------------------------

async function loadOpportunityEvaluationContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: opp, error } = await svc
    .from("opportunities")
    .select(
      "id, project_name, stage, tier, estimated_value_min, estimated_value_max, quotation_value, currency, next_action, next_action_due, last_activity_at, sector, win_confidence",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (error || !opp) return { ok: false, code: "AI_INPUT_INVALID", message: "Opportunity not found." };

  // Limited recent activity only — last 5 follow-ups, not the full history.
  const { data: followUps } = await svc
    .from("follow_ups")
    .select("due_date, status, channel, last_contact_at")
    .eq("opportunity_id", entityId)
    .order("due_date", { ascending: false })
    .limit(5);

  const { data: rfqs } = await svc.from("rfqs").select("id, status, rfq_number").eq("opportunity_id", entityId).limit(3);
  const { data: tenders } = await svc
    .from("tenders")
    .select("id, tender_stage, tender_name")
    .eq("converted_opportunity_id", entityId)
    .limit(3);

  const opportunitySummary = {
    reference: opp.project_name,
    stage: opp.stage,
    tier: opp.tier,
    value: opp.quotation_value ?? opp.estimated_value_max ?? opp.estimated_value_min ?? null,
    currency: opp.currency,
    next_step: opp.next_action,
    next_step_due: opp.next_action_due,
    last_activity_at: opp.last_activity_at,
    sector: opp.sector,
    win_confidence: opp.win_confidence,
  };
  const recentActivity = (followUps ?? []).map((f) => ({
    due_date: f.due_date,
    status: f.status,
    channel: f.channel,
    last_contact_at: f.last_contact_at,
  }));
  const linkage = {
    rfqs: (rfqs ?? []).map((r) => ({ status: r.status, ref: r.rfq_number })),
    tenders: (tenders ?? []).map((t) => ({ stage: t.tender_stage, name: t.tender_name })),
  };

  const contextText = JSON.stringify({ opportunity: opportunitySummary, recent_activity: recentActivity, linkage }, null, 2);
  const recordCount = 1 + recentActivity.length + linkage.rfqs.length + linkage.tenders.length;
  const manifest: ContextManifest = {
    fields_loaded: Object.keys(opportunitySummary),
    record_counts: {
      opportunities: 1,
      follow_ups: recentActivity.length,
      rfqs: linkage.rfqs.length,
      tenders: linkage.tenders.length,
    },
    source_entity_types: ["opportunities", "follow_ups", "rfqs", "tenders"],
    redacted_identifiers: { opportunity_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// ---------------------------------------------------------------------------
// Agent 2 — old_data_classifier
// ---------------------------------------------------------------------------

async function loadOldDataClassifierContext(
  svc: SupabaseClient,
  entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  if (entityType !== "import_rows") {
    return {
      ok: false,
      code: "AI_ENTITY_NOT_ALLOWED",
      message: "old_data_classifier requires entityType 'import_rows' (a single staged row).",
    };
  }

  const { data: row, error } = await svc
    .from("import_rows")
    .select("id, batch_id, file_id, row_number, raw_data, mapped_data, status")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !row) return { ok: false, code: "AI_INPUT_INVALID", message: "Staged row not found." };

  const { data: batch } = await svc
    .from("import_batches")
    .select("status, source_type, target_entity, total_rows")
    .eq("id", row.batch_id)
    .maybeSingle();
  const { data: file } = await svc.from("import_files").select("column_names").eq("id", row.file_id).maybeSingle();
  // No standalone "field dictionary" table exists in this schema (checked
  // during discovery) — the closest equivalent, already-chosen column
  // mappings for this batch, is substituted instead.
  const { data: mappings } = await svc
    .from("import_mappings")
    .select("source_column, target_table, target_column, is_key")
    .eq("batch_id", row.batch_id)
    .limit(20);
  const { data: dupes } = await svc
    .from("import_duplicate_candidates")
    .select("existing_table, existing_record_id, match_type, confidence")
    .eq("row_id", entityId)
    .limit(5);

  const contextText = JSON.stringify(
    {
      staged_row: { raw_data: row.raw_data, mapped_data: row.mapped_data, status: row.status },
      batch: batch
        ? { status: batch.status, source_type: batch.source_type, target_entity: batch.target_entity, total_rows: batch.total_rows }
        : null,
      detected_headers: file?.column_names ?? [],
      existing_field_mappings: (mappings ?? []).map((m) => ({
        source: m.source_column,
        target: `${m.target_table}.${m.target_column}`,
        is_key: m.is_key,
      })),
      // Real IDs here — the model needs a real, reviewable UUID to echo back
      // in duplicate_candidates. Only the trace's manifest below redacts IDs.
      duplicate_hints: (dupes ?? []).map((d) => ({
        table: d.existing_table,
        id: d.existing_record_id,
        match_type: d.match_type,
        confidence: d.confidence,
      })),
    },
    null,
    2,
  );

  const recordCount = 1 + (mappings?.length ?? 0) + (dupes?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["raw_data", "mapped_data", "status", "batch.status", "batch.target_entity", "file.column_names"],
    record_counts: {
      import_rows: 1,
      import_batches: batch ? 1 : 0,
      import_mappings: mappings?.length ?? 0,
      import_duplicate_candidates: dupes?.length ?? 0,
    },
    source_entity_types: ["import_rows", "import_batches", "import_files", "import_mappings", "import_duplicate_candidates"],
    redacted_identifiers: { row_id: redactId(entityId), batch_id: redactId(row.batch_id) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// old_data_classifier has no per-record owner concept (import access is
// role-gated, matching the real import-pipeline system — see
// ai-guardrails.ts's AGENT_ROLE_CHECK comment) — access is role-only.
async function checkOldDataClassifierAccess(): Promise<AgentAccessResult> {
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Agent 3 — smart_followup_draft
// ---------------------------------------------------------------------------

const FOLLOWUP_ENTITY_TABLES: Record<string, { select: string; toSummary: (r: Record<string, unknown>) => Record<string, unknown> }> = {
  opportunities: {
    select: "id, project_name, stage, next_action, next_action_due, last_activity_at",
    toSummary: (r) => ({
      type: "opportunity",
      reference: r.project_name,
      status: r.stage,
      next_action: r.next_action,
      last_activity_at: r.last_activity_at,
    }),
  },
  rfqs: {
    select: "id, rfq_number, status, response_due_date",
    toSummary: (r) => ({ type: "rfq", reference: r.rfq_number, status: r.status, response_due_date: r.response_due_date }),
  },
  tenders: {
    select: "id, tender_name, tender_stage, next_follow_up_date",
    toSummary: (r) => ({ type: "tender", reference: r.tender_name, status: r.tender_stage, next_follow_up_date: r.next_follow_up_date }),
  },
  quotations: {
    select: "id, quote_number, status, valid_until, last_follow_up_at",
    toSummary: (r) => ({
      type: "quotation",
      reference: r.quote_number,
      status: r.status,
      valid_until: r.valid_until,
      last_follow_up_at: r.last_follow_up_at,
    }),
  },
  // Companies/contacts have no pipeline "status" the way opportunities/RFQs/
  // tenders/quotations do — they are reference records, so the summary is
  // intentionally thinner (company_type/relationship_level and
  // authority/location are the closest equivalents that actually exist on
  // these tables).
  companies: {
    select: "id, name, company_type, relationship_level",
    toSummary: (r) => ({ type: "company", reference: r.name, company_type: r.company_type, relationship_level: r.relationship_level }),
  },
  contacts: {
    select: "id, name, title, authority",
    toSummary: (r) => ({ type: "contact", reference: r.name, title: r.title, authority: r.authority }),
  },
};

async function loadSmartFollowupDraftContext(
  svc: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  input: Record<string, unknown>,
): Promise<AgentContextResult> {
  const requestedChannel = typeof input.channel === "string" ? input.channel : null;
  if (!requestedChannel || !(FOLLOWUP_CHANNELS as readonly string[]).includes(requestedChannel)) {
    return { ok: false, code: "AI_INPUT_INVALID", message: "input.channel must be one of: email, whatsapp, internal_note." };
  }
  const entry = FOLLOWUP_ENTITY_TABLES[entityType];
  if (!entry) return { ok: false, code: "AI_ENTITY_NOT_ALLOWED", message: "Unsupported entity type for this agent." };

  const { data: record } = await svc.from(entityType).select(entry.select).eq("id", entityId).maybeSingle();
  if (!record) return { ok: false, code: "AI_INPUT_INVALID", message: "Linked record not found." };

  const summary = entry.toSummary(record as Record<string, unknown>);
  const language = typeof input.language === "string" && (input.language === "en" || input.language === "ar") ? input.language : "en";
  const contextText = JSON.stringify({ requested_channel: requestedChannel, language, linked_record: summary }, null, 2);
  const manifest: ContextManifest = {
    fields_loaded: Object.keys(summary),
    record_counts: { [entityType]: 1 },
    source_entity_types: [entityType],
    redacted_identifiers: { entity_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount: 1 };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const AGENT_REGISTRY: Record<AgentKey, AgentDefinition> = {
  opportunity_evaluation: {
    key: "opportunity_evaluation",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.opportunity_evaluation,
    hasRole: AGENT_ROLE_CHECK.opportunity_evaluation,
    checkAccess: checkOwnershipAccess,
    loadContext: loadOpportunityEvaluationContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.opportunity_evaluation,
    outputSchema: AGENT_OUTPUT_SCHEMAS.opportunity_evaluation,
    outputType: AGENT_OUTPUT_TYPES.opportunity_evaluation,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
  old_data_classifier: {
    key: "old_data_classifier",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.old_data_classifier,
    hasRole: AGENT_ROLE_CHECK.old_data_classifier,
    checkAccess: checkOldDataClassifierAccess,
    loadContext: loadOldDataClassifierContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.old_data_classifier,
    outputSchema: AGENT_OUTPUT_SCHEMAS.old_data_classifier,
    outputType: AGENT_OUTPUT_TYPES.old_data_classifier,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
  smart_followup_draft: {
    key: "smart_followup_draft",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.smart_followup_draft,
    hasRole: AGENT_ROLE_CHECK.smart_followup_draft,
    checkAccess: checkOwnershipAccess,
    loadContext: loadSmartFollowupDraftContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.smart_followup_draft,
    outputSchema: AGENT_OUTPUT_SCHEMAS.smart_followup_draft,
    outputType: AGENT_OUTPUT_TYPES.smart_followup_draft,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
};
