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
import { canManageSalesPipeline, type AppRole } from "./roles.ts";
import type { z } from "zod";

// Redacts a UUID for the trace's context_manifest (audit-safe summary only —
// the real ID is still used in the actual prompt content sent to the
// provider, where the agent needs it to be useful, e.g. echoing a duplicate
// candidate's real id back for a human reviewer to look up).
export function redactId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

// Required Fix 7: replaces two `as Record<string, unknown>` double-casts
// (TS2352 under `deno check` — a dynamic, non-literal `.select(someVar)`
// argument makes supabase-js infer a generic/error-shaped union for `data`,
// which doesn't structurally overlap with Record<string, unknown> closely
// enough for a direct assertion). This is a real runtime type guard, not a
// blind cast: `data`/`record` are narrowed through `unknown` only after
// actually checking they are a plain, non-array object.
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const ownerValue = isPlainRecord(data) ? data[ownerField] : null;
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

// Required Fix 4: the loader's own query limits are chosen so
// 1 (row) + OLD_DATA_MAPPINGS_LIMIT + OLD_DATA_DUPES_LIMIT can never exceed
// MAX_CONTEXT_RECORDS (20) — previously this loader could load up to 26
// records (1 + 20 mappings + 5 dupes), self-rejecting with AI_CONTEXT_TOO_LARGE
// on entirely ordinary import batches.
const OLD_DATA_MAPPINGS_LIMIT = 15;
const OLD_DATA_DUPES_LIMIT = 4;
const OLD_DATA_HEADERS_LIMIT = 50;
// raw_data/mapped_data are arbitrary staged jsonb — cap each independently
// so one oversized cell can't blow past the context character budget
// (previously unbounded; only the DB row COUNT was checked, never text
// length).
const RAW_DATA_MAX_CHARS = 3000;
const MAPPED_DATA_MAX_CHARS = 3000;

function truncateSerialized(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length <= maxChars) return serialized;
  return `${serialized.slice(0, maxChars)}…[truncated, ${serialized.length} chars total]`;
}

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
    .limit(OLD_DATA_MAPPINGS_LIMIT);
  const { data: dupes } = await svc
    .from("import_duplicate_candidates")
    .select("existing_table, existing_record_id, match_type, confidence")
    .eq("row_id", entityId)
    .limit(OLD_DATA_DUPES_LIMIT);

  const detectedHeaders = (file?.column_names ?? []).slice(0, OLD_DATA_HEADERS_LIMIT);

  const contextText = JSON.stringify(
    {
      staged_row: {
        // Individually capped, not re-parsed — a bounded string either way,
        // whether or not truncation actually fired.
        raw_data: truncateSerialized(row.raw_data, RAW_DATA_MAX_CHARS),
        mapped_data: truncateSerialized(row.mapped_data, MAPPED_DATA_MAX_CHARS),
        status: row.status,
      },
      batch: batch
        ? { status: batch.status, source_type: batch.source_type, target_entity: batch.target_entity, total_rows: batch.total_rows }
        : null,
      detected_headers: detectedHeaders,
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
  if (!isPlainRecord(record)) return { ok: false, code: "AI_INPUT_INVALID", message: "Linked record not found." };

  const summary = entry.toSummary(record);
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
// Agent 4 — data_cleanup
// ---------------------------------------------------------------------------

const DATA_CLEANUP_ROWS_LIMIT = 20;

async function loadDataCleanupContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error: batchError } = await svc
    .from("import_batches")
    .select("id, status, source_type, target_entity, total_rows, created_at")
    .eq("id", entityId)
    .maybeSingle();
  if (batchError || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: rows } = await svc
    .from("import_rows")
    .select("id, raw_data, mapped_data, detected_headers, status")
    .eq("batch_id", entityId)
    .limit(DATA_CLEANUP_ROWS_LIMIT);

  const contextText = JSON.stringify(
    {
      batch: {
        id: batch.id,
        status: batch.status,
        source_type: batch.source_type,
        target_entity: batch.target_entity,
        total_rows: batch.total_rows,
        created_at: batch.created_at,
      },
      rows: (rows ?? []).map((r) => ({
        id: r.id,
        raw_data: r.raw_data,
        mapped_data: r.mapped_data,
        detected_headers: r.detected_headers,
        status: r.status,
      })),
    },
    null,
    2,
  );

  const rowCount = rows?.length ?? 0;
  const recordCount = 1 + rowCount;
  const manifest: ContextManifest = {
    fields_loaded: ["id", "status", "source_type", "target_entity", "total_rows", "raw_data", "mapped_data", "detected_headers"],
    record_counts: { import_batches: 1, import_rows: rowCount },
    source_entity_types: ["import_batches", "import_rows"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

async function checkDataCleanupAccess(): Promise<AgentAccessResult> {
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Agent 5 — contact_mapping
// ---------------------------------------------------------------------------

const CONTACT_MAPPING_ROWS_LIMIT = 20;

async function loadContactMappingContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error: batchError } = await svc
    .from("import_batches")
    .select("id, status, source_type, target_entity, total_rows, created_at")
    .eq("id", entityId)
    .maybeSingle();
  if (batchError || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: rows } = await svc
    .from("import_rows")
    .select("id, raw_data, mapped_data, detected_headers, status")
    .eq("batch_id", entityId)
    .limit(CONTACT_MAPPING_ROWS_LIMIT);

  const contextText = JSON.stringify(
    {
      batch: {
        id: batch.id,
        status: batch.status,
        source_type: batch.source_type,
        target_entity: batch.target_entity,
        total_rows: batch.total_rows,
        created_at: batch.created_at,
      },
      rows: (rows ?? []).map((r) => ({
        id: r.id,
        raw_data: r.raw_data,
        mapped_data: r.mapped_data,
        detected_headers: r.detected_headers,
        status: r.status,
      })),
    },
    null,
    2,
  );

  const rowCount = rows?.length ?? 0;
  const recordCount = 1 + rowCount;
  const manifest: ContextManifest = {
    fields_loaded: ["id", "status", "source_type", "target_entity", "total_rows", "raw_data", "mapped_data", "detected_headers"],
    record_counts: { import_batches: 1, import_rows: rowCount },
    source_entity_types: ["import_batches", "import_rows"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

async function checkContactMappingAccess(): Promise<AgentAccessResult> {
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Agent 6 — project_radar
// ---------------------------------------------------------------------------

// entityId will be the sentinel string "pipeline" — not a real UUID. Do NOT
// use it in any SELECT WHERE id = entityId query.
const PIPELINE_OPPS_LIMIT = 50;
const PIPELINE_LEADS_LIMIT = 20;

async function loadProjectRadarContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  _entityId: string,
): Promise<AgentContextResult> {
  const { data: opps } = await svc
    .from("opportunities")
    .select("id, project_name, stage, updated_at, estimated_value_max, owner_id")
    .order("updated_at", { ascending: false })
    .limit(PIPELINE_OPPS_LIMIT);

  const { data: leads } = await svc
    .from("leads")
    .select("id, project_name, location, stage, created_at")
    .order("created_at", { ascending: false })
    .limit(PIPELINE_LEADS_LIMIT);

  const contextText = JSON.stringify(
    {
      pipeline_snapshot: {
        as_of: new Date().toISOString(),
      },
      opportunities: (opps ?? []).map((o) => ({
        id: o.id,
        project_name: o.project_name,
        stage: o.stage,
        updated_at: o.updated_at,
        value: o.estimated_value_max ?? null,
        owner_id: o.owner_id,
      })),
      leads: (leads ?? []).map((l) => ({
        id: l.id,
        project_name: l.project_name,
        location: l.location,
        stage: l.stage,
        created_at: l.created_at,
      })),
    },
    null,
    2,
  );

  const oppCount = opps?.length ?? 0;
  const leadCount = leads?.length ?? 0;
  const recordCount = oppCount + leadCount;
  const manifest: ContextManifest = {
    fields_loaded: ["id", "project_name", "stage", "updated_at", "value", "owner_id", "location", "created_at"],
    record_counts: { opportunities: oppCount, leads: leadCount },
    source_entity_types: ["opportunities", "leads"],
    redacted_identifiers: {},
  };
  return { ok: true, contextText, manifest, recordCount };
}

async function checkProjectRadarAccess(): Promise<AgentAccessResult> {
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Agent 7 — risk_finance
// ---------------------------------------------------------------------------

async function loadRiskFinanceContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: opp, error } = await svc
    .from("opportunities")
    .select(
      "id, project_name, stage, tier, estimated_value_min, estimated_value_max, quotation_value, currency, next_action, next_action_due, last_activity_at, sector, company_id",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (error || !opp) return { ok: false, code: "AI_INPUT_INVALID", message: "Opportunity not found." };

  // Linked company for client-type risk assessment.
  let company: { name: unknown; company_type: unknown; relationship_level: unknown } | null = null;
  if (opp.company_id) {
    const { data: co } = await svc
      .from("companies")
      .select("name, company_type, relationship_level")
      .eq("id", opp.company_id)
      .maybeSingle();
    if (isPlainRecord(co)) {
      company = { name: co.name, company_type: co.company_type, relationship_level: co.relationship_level };
    }
  }

  // Document presence signals (counts only — no PII).
  const { count: quotationCount } = await svc
    .from("quotations")
    .select("id", { count: "exact", head: true })
    .eq("opportunity_id", entityId);

  const { count: boqCount } = await svc
    .from("boq_items")
    .select("id", { count: "exact", head: true })
    .eq("opportunity_id", entityId);

  const contextText = JSON.stringify(
    {
      opportunity: {
        id: opp.id,
        project_name: opp.project_name,
        stage: opp.stage,
        tier: opp.tier,
        value_min: opp.estimated_value_min,
        value_max: opp.estimated_value_max,
        quotation_value: opp.quotation_value,
        currency: opp.currency,
        next_action: opp.next_action,
        next_action_due: opp.next_action_due,
        last_activity_at: opp.last_activity_at,
        sector: opp.sector,
      },
      client: company,
      document_presence: {
        linked_quotations: quotationCount ?? 0,
        linked_boq_items: boqCount ?? 0,
      },
    },
    null,
    2,
  );

  const recordCount = 1 + (company ? 1 : 0);
  const manifest: ContextManifest = {
    fields_loaded: [
      "project_name", "stage", "tier", "value_min", "value_max", "quotation_value",
      "currency", "next_action", "next_action_due", "last_activity_at", "sector",
      "company.name", "company.company_type", "company.relationship_level",
      "document_presence.linked_quotations", "document_presence.linked_boq_items",
    ],
    record_counts: {
      opportunities: 1,
      companies: company ? 1 : 0,
      quotations: quotationCount ?? 0,
      boq_items: boqCount ?? 0,
    },
    source_entity_types: ["opportunities", "companies", "quotations", "boq_items"],
    redacted_identifiers: { opportunity_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// ---------------------------------------------------------------------------
// Agents 8-14 — Import Intelligence v2 classification pipeline
// All agents operate on import_batches — no per-record owner concept;
// access is role-gated (matching the real import pipeline).
// ---------------------------------------------------------------------------

async function checkImportAccess(): Promise<AgentAccessResult> {
  return { ok: true };
}

// Agent 8 — workbook_classifier
async function loadWorkbookClassifierContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, status, source_type, target_entity, total_rows, created_at, ai_suggestions_enabled")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: file } = await svc
    .from("import_files")
    .select("id, file_type, column_names, row_count, sheet_count")
    .eq("batch_id", entityId)
    .limit(1)
    .maybeSingle();

  // Up to 5 preview rows — raw_data only, no mapped_data needed at this stage.
  const { data: previewRows } = await svc
    .from("import_rows")
    .select("row_number, raw_data")
    .eq("batch_id", entityId)
    .order("row_number")
    .limit(5);

  const contextText = JSON.stringify(
    {
      batch: {
        id: batch.id,
        status: batch.status,
        source_type: batch.source_type,
        target_entity: batch.target_entity,
        total_rows: batch.total_rows,
        created_at: batch.created_at,
      },
      file: file
        ? {
            file_type: file.file_type,
            column_names: (file.column_names ?? []).slice(0, 50),
            row_count: file.row_count,
            sheet_count: file.sheet_count ?? 1,
          }
        : null,
      preview_rows: (previewRows ?? []).map((r) => ({
        row_number: r.row_number,
        raw_data: r.raw_data,
      })),
    },
    null,
    2,
  );

  const recordCount = 1 + (file ? 1 : 0) + (previewRows?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["status", "source_type", "target_entity", "total_rows", "file_type", "column_names", "raw_data"],
    record_counts: { import_batches: 1, import_files: file ? 1 : 0, import_rows: previewRows?.length ?? 0 },
    source_entity_types: ["import_batches", "import_files", "import_rows"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 9 — sheet_classifier
async function loadSheetClassifierContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, status, target_entity")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: file } = await svc
    .from("import_files")
    .select("file_type, column_names, sheet_count, file_name")
    .eq("batch_id", entityId)
    .limit(1)
    .maybeSingle();

  if (!file || file.file_type !== "xlsx") {
    return { ok: false, code: "AI_INPUT_INVALID", message: "sheet_classifier requires an xlsx file." };
  }

  // NOTE: individual per-sheet metadata is not stored in the DB (only the
  // primary sheet's columns are). Context includes what we have — the file
  // name, total sheet count, and primary sheet columns. The agent infers
  // structure from these signals.
  const contextText = JSON.stringify(
    {
      batch: { id: batch.id, target_entity: batch.target_entity },
      workbook: {
        file_name: file.file_name,
        sheet_count: file.sheet_count ?? 1,
        primary_sheet_columns: (file.column_names ?? []).slice(0, 50),
      },
    },
    null,
    2,
  );

  const recordCount = 2;
  const manifest: ContextManifest = {
    fields_loaded: ["file_name", "sheet_count", "column_names", "target_entity"],
    record_counts: { import_batches: 1, import_files: 1 },
    source_entity_types: ["import_batches", "import_files"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 10 — semantic_field_mapper
const MAPPER_SAMPLE_VALUES = 3;
const MAPPER_MAPPINGS_LIMIT = 100;

async function loadSemanticFieldMapperContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, target_entity")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: file } = await svc
    .from("import_files")
    .select("column_names")
    .eq("batch_id", entityId)
    .limit(1)
    .maybeSingle();

  const columns: string[] = (file?.column_names ?? []).slice(0, 100);

  // Up to 3 sample rows for value examples.
  const { data: sampleRows } = await svc
    .from("import_rows")
    .select("raw_data")
    .eq("batch_id", entityId)
    .limit(MAPPER_SAMPLE_VALUES);

  // Build per-column sample values.
  const columnSamples: Record<string, unknown[]> = {};
  for (const col of columns) {
    columnSamples[col] = (sampleRows ?? [])
      .map((r) => (r.raw_data as Record<string, unknown>)?.[col] ?? null)
      .filter((v) => v != null && String(v).trim() !== "");
  }

  // Existing user mappings (don't suggest for these).
  const { data: existingMappings } = await svc
    .from("import_mappings")
    .select("source_column, target_column, is_key")
    .eq("batch_id", entityId)
    .limit(MAPPER_MAPPINGS_LIMIT);

  const mappedColumns = new Set((existingMappings ?? []).map((m) => m.source_column));
  const unmappedColumns = columns.filter((c) => !mappedColumns.has(c));

  const contextText = JSON.stringify(
    {
      batch: { id: batch.id, target_entity: batch.target_entity },
      unmapped_columns: unmappedColumns,
      column_samples: Object.fromEntries(
        unmappedColumns.map((col) => [col, columnSamples[col] ?? []]),
      ),
      existing_mappings: (existingMappings ?? []).map((m) => ({
        source: m.source_column,
        target: m.target_column,
        is_key: m.is_key,
      })),
    },
    null,
    2,
  );

  const recordCount = 1 + (sampleRows?.length ?? 0) + (existingMappings?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["target_entity", "column_names", "raw_data", "source_column", "target_column"],
    record_counts: {
      import_batches: 1,
      import_rows: sampleRows?.length ?? 0,
      import_mappings: existingMappings?.length ?? 0,
    },
    source_entity_types: ["import_batches", "import_files", "import_rows", "import_mappings"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 11 — entity_extractor
const EXTRACTOR_ROWS_LIMIT = 20;

async function loadEntityExtractorContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, status, target_entity, total_rows")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: rows } = await svc
    .from("import_rows")
    .select("id, row_number, mapped_data, status")
    .eq("batch_id", entityId)
    .eq("status", "valid")
    .order("row_number")
    .limit(EXTRACTOR_ROWS_LIMIT);

  const contextText = JSON.stringify(
    {
      batch: { id: batch.id, target_entity: batch.target_entity, total_rows: batch.total_rows },
      rows: (rows ?? []).map((r) => ({
        id: r.id,
        row_number: r.row_number,
        mapped_data: r.mapped_data,
      })),
    },
    null,
    2,
  );

  const rowCount = rows?.length ?? 0;
  const recordCount = 1 + rowCount;
  const manifest: ContextManifest = {
    fields_loaded: ["target_entity", "total_rows", "id", "row_number", "mapped_data"],
    record_counts: { import_batches: 1, import_rows: rowCount },
    source_entity_types: ["import_batches", "import_rows"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 12 — relationship_resolver
const RESOLVER_PROPOSALS_LIMIT = 20;
const RESOLVER_CRM_HINTS = 10;

async function loadRelationshipResolverContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, target_entity")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  // Accepted split proposals for this batch.
  const { data: proposals } = await svc
    .from("import_split_proposals")
    .select("id, source_row_id, entity_type, proposed_payload, role")
    .eq("batch_id", entityId)
    .eq("review_status", "accepted")
    .limit(RESOLVER_PROPOSALS_LIMIT);

  if (!proposals || proposals.length === 0) {
    return {
      ok: false,
      code: "AI_INPUT_INVALID",
      message: "No accepted split proposals found. Run entity_extractor and accept at least one proposal first.",
    };
  }

  // CRM name hints for matching (name-only — no PII beyond what's in the file already).
  const { data: crmCompanies } = await svc
    .from("companies")
    .select("id, name")
    .order("name")
    .limit(RESOLVER_CRM_HINTS);
  const { data: crmContacts } = await svc
    .from("contacts")
    .select("id, name")
    .order("name")
    .limit(RESOLVER_CRM_HINTS);

  const contextText = JSON.stringify(
    {
      batch: { id: batch.id, target_entity: batch.target_entity },
      accepted_proposals: proposals.map((p) => ({
        proposal_id: p.id,
        source_row_id: p.source_row_id,
        entity_type: p.entity_type,
        proposed_payload: p.proposed_payload,
        role: p.role,
      })),
      crm_hints: {
        companies: (crmCompanies ?? []).map((c) => ({ id: c.id, name: c.name })),
        contacts: (crmContacts ?? []).map((c) => ({ id: c.id, name: c.name })),
      },
    },
    null,
    2,
  );

  const recordCount = 1 + proposals.length + (crmCompanies?.length ?? 0) + (crmContacts?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["entity_type", "proposed_payload", "role", "name"],
    record_counts: {
      import_batches: 1,
      import_split_proposals: proposals.length,
      companies: crmCompanies?.length ?? 0,
      contacts: crmContacts?.length ?? 0,
    },
    source_entity_types: ["import_batches", "import_split_proposals", "companies", "contacts"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 13 — change_interpreter
const CHANGE_DUPES_LIMIT = 20;

async function loadChangeInterpreterContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, status, source_type, target_entity, total_rows, valid_rows, error_rows, duplicate_rows, source_profile_id, created_at")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  if (!batch.source_profile_id) {
    return {
      ok: false,
      code: "AI_INPUT_INVALID",
      message: "change_interpreter requires a recurring batch (source_profile_id must be set).",
    };
  }

  // Previous batch for the same source profile.
  const { data: prevBatch } = await svc
    .from("import_batches")
    .select("id, status, total_rows, valid_rows, error_rows, duplicate_rows, created_at, committed_at")
    .eq("source_profile_id", batch.source_profile_id)
    .neq("id", entityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Sample duplicate candidates to understand what changed.
  const { data: dupes } = await svc
    .from("import_duplicate_candidates")
    .select("match_type, match_scope, confidence, matched_fields, suggested_action")
    .eq("batch_id", entityId)
    .limit(CHANGE_DUPES_LIMIT);

  const contextText = JSON.stringify(
    {
      current_batch: {
        id: batch.id,
        status: batch.status,
        target_entity: batch.target_entity,
        total_rows: batch.total_rows,
        valid_rows: batch.valid_rows,
        error_rows: batch.error_rows,
        duplicate_rows: batch.duplicate_rows,
        created_at: batch.created_at,
      },
      previous_batch: prevBatch
        ? {
            id: redactId(prevBatch.id),
            total_rows: prevBatch.total_rows,
            valid_rows: prevBatch.valid_rows,
            error_rows: prevBatch.error_rows,
            duplicate_rows: prevBatch.duplicate_rows,
            created_at: prevBatch.created_at,
            committed_at: prevBatch.committed_at,
          }
        : null,
      duplicate_sample: (dupes ?? []).map((d) => ({
        match_type: d.match_type,
        match_scope: d.match_scope,
        confidence: d.confidence,
        matched_fields: d.matched_fields,
        suggested_action: d.suggested_action,
      })),
    },
    null,
    2,
  );

  const recordCount = 1 + (prevBatch ? 1 : 0) + (dupes?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["status", "total_rows", "valid_rows", "error_rows", "duplicate_rows", "match_type", "confidence"],
    record_counts: {
      import_batches: prevBatch ? 2 : 1,
      import_duplicate_candidates: dupes?.length ?? 0,
    },
    source_entity_types: ["import_batches", "import_duplicate_candidates"],
    redacted_identifiers: { batch_id: redactId(entityId), prev_batch_id: redactId(prevBatch?.id) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// Agent 14 — import_routing_reviewer
const REVIEWER_OUTPUTS_LIMIT = 10;

async function loadImportRoutingReviewerContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: batch, error } = await svc
    .from("import_batches")
    .select("id, status, source_type, target_entity, total_rows, valid_rows, error_rows, duplicate_rows, dry_run, readiness_checklist, ai_suggestions_enabled, created_at")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  // Summaries of prior agent outputs for this batch (not full payloads — just metadata).
  const { data: priorOutputs } = await svc
    .from("ai_agent_outputs")
    .select("agent_key, output_type, status, created_at")
    .eq("entity_id", entityId)
    .eq("entity_type", "import_batches")
    .order("created_at", { ascending: false })
    .limit(REVIEWER_OUTPUTS_LIMIT);

  const contextText = JSON.stringify(
    {
      batch: {
        id: batch.id,
        status: batch.status,
        source_type: batch.source_type,
        target_entity: batch.target_entity,
        total_rows: batch.total_rows,
        valid_rows: batch.valid_rows,
        error_rows: batch.error_rows,
        duplicate_rows: batch.duplicate_rows,
        dry_run: batch.dry_run,
        readiness_checklist: batch.readiness_checklist,
        ai_suggestions_enabled: batch.ai_suggestions_enabled,
        created_at: batch.created_at,
      },
      prior_ai_analysis: (priorOutputs ?? []).map((o) => ({
        agent: o.agent_key,
        output_type: o.output_type,
        status: o.status,
        ran_at: o.created_at,
      })),
    },
    null,
    2,
  );

  const recordCount = 1 + (priorOutputs?.length ?? 0);
  const manifest: ContextManifest = {
    fields_loaded: ["status", "target_entity", "total_rows", "valid_rows", "error_rows", "duplicate_rows", "readiness_checklist", "agent_key", "output_type"],
    record_counts: { import_batches: 1, ai_agent_outputs: priorOutputs?.length ?? 0 },
    source_entity_types: ["import_batches", "ai_agent_outputs"],
    redacted_identifiers: { batch_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
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
  data_cleanup: {
    key: "data_cleanup",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.data_cleanup,
    hasRole: (roles) => canManageSalesPipeline(roles),
    checkAccess: checkDataCleanupAccess,
    loadContext: loadDataCleanupContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.data_cleanup,
    outputSchema: AGENT_OUTPUT_SCHEMAS.data_cleanup,
    outputType: AGENT_OUTPUT_TYPES.data_cleanup,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
  contact_mapping: {
    key: "contact_mapping",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.contact_mapping,
    hasRole: (roles) => canManageSalesPipeline(roles),
    checkAccess: checkContactMappingAccess,
    loadContext: loadContactMappingContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.contact_mapping,
    outputSchema: AGENT_OUTPUT_SCHEMAS.contact_mapping,
    outputType: AGENT_OUTPUT_TYPES.contact_mapping,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
  project_radar: {
    key: "project_radar",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.project_radar,
    hasRole: (roles) => canManageSalesPipeline(roles),
    checkAccess: checkProjectRadarAccess,
    loadContext: loadProjectRadarContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.project_radar,
    outputSchema: AGENT_OUTPUT_SCHEMAS.project_radar,
    outputType: AGENT_OUTPUT_TYPES.project_radar,
    maxContextRecords: 70,
    allowProviderFallback: true,
  },
  risk_finance: {
    key: "risk_finance",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.risk_finance,
    hasRole: (roles) => canManageSalesPipeline(roles),
    checkAccess: checkOwnershipAccess,
    loadContext: loadRiskFinanceContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.risk_finance,
    outputSchema: AGENT_OUTPUT_SCHEMAS.risk_finance,
    outputType: AGENT_OUTPUT_TYPES.risk_finance,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
  workbook_classifier: {
    key: "workbook_classifier",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.workbook_classifier,
    hasRole: AGENT_ROLE_CHECK.workbook_classifier,
    checkAccess: checkImportAccess,
    loadContext: loadWorkbookClassifierContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.workbook_classifier,
    outputSchema: AGENT_OUTPUT_SCHEMAS.workbook_classifier,
    outputType: AGENT_OUTPUT_TYPES.workbook_classifier,
    maxContextRecords: 10,
    allowProviderFallback: true,
  },
  sheet_classifier: {
    key: "sheet_classifier",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.sheet_classifier,
    hasRole: AGENT_ROLE_CHECK.sheet_classifier,
    checkAccess: checkImportAccess,
    loadContext: loadSheetClassifierContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.sheet_classifier,
    outputSchema: AGENT_OUTPUT_SCHEMAS.sheet_classifier,
    outputType: AGENT_OUTPUT_TYPES.sheet_classifier,
    maxContextRecords: 5,
    allowProviderFallback: true,
  },
  semantic_field_mapper: {
    key: "semantic_field_mapper",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.semantic_field_mapper,
    hasRole: AGENT_ROLE_CHECK.semantic_field_mapper,
    checkAccess: checkImportAccess,
    loadContext: loadSemanticFieldMapperContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.semantic_field_mapper,
    outputSchema: AGENT_OUTPUT_SCHEMAS.semantic_field_mapper,
    outputType: AGENT_OUTPUT_TYPES.semantic_field_mapper,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
  entity_extractor: {
    key: "entity_extractor",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.entity_extractor,
    hasRole: AGENT_ROLE_CHECK.entity_extractor,
    checkAccess: checkImportAccess,
    loadContext: loadEntityExtractorContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.entity_extractor,
    outputSchema: AGENT_OUTPUT_SCHEMAS.entity_extractor,
    outputType: AGENT_OUTPUT_TYPES.entity_extractor,
    maxContextRecords: 25,
    allowProviderFallback: true,
  },
  relationship_resolver: {
    key: "relationship_resolver",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.relationship_resolver,
    hasRole: AGENT_ROLE_CHECK.relationship_resolver,
    checkAccess: checkImportAccess,
    loadContext: loadRelationshipResolverContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.relationship_resolver,
    outputSchema: AGENT_OUTPUT_SCHEMAS.relationship_resolver,
    outputType: AGENT_OUTPUT_TYPES.relationship_resolver,
    maxContextRecords: 45,
    allowProviderFallback: true,
  },
  change_interpreter: {
    key: "change_interpreter",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.change_interpreter,
    hasRole: AGENT_ROLE_CHECK.change_interpreter,
    checkAccess: checkImportAccess,
    loadContext: loadChangeInterpreterContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.change_interpreter,
    outputSchema: AGENT_OUTPUT_SCHEMAS.change_interpreter,
    outputType: AGENT_OUTPUT_TYPES.change_interpreter,
    maxContextRecords: 25,
    allowProviderFallback: true,
  },
  import_routing_reviewer: {
    key: "import_routing_reviewer",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.import_routing_reviewer,
    hasRole: AGENT_ROLE_CHECK.import_routing_reviewer,
    checkAccess: checkImportAccess,
    loadContext: loadImportRoutingReviewerContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.import_routing_reviewer,
    outputSchema: AGENT_OUTPUT_SCHEMAS.import_routing_reviewer,
    outputType: AGENT_OUTPUT_TYPES.import_routing_reviewer,
    maxContextRecords: 15,
    allowProviderFallback: true,
  },
} satisfies Record<AgentKey, AgentDefinition>;
