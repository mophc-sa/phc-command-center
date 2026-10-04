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
import { readAll, salesFacts } from "./ai-facts.ts";
import { opportunityValue } from "./opportunity-value.ts";
import { resolveCanonicalStage } from "./stage-canonical.ts";

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
  const { data } = await svc.from(entityType).select(ownerField).eq("id", entityId).maybeSingle().throwOnError();
  const ownerValue = isPlainRecord(data) ? data[ownerField] : null;
  if (!isOwnedBy(ownerValue, userId)) {
    return { ok: false, code: "AI_RECORD_ACCESS_DENIED", message: "You do not have access to this record." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// deal_correspondence_summary — the deal's recent email, for whoever may read
// the deal (can_read_boq: owner, pipeline operators, estimation, finance).
// ---------------------------------------------------------------------------

export const CORRESPONDENCE_MAX_EMAILS = 15;
const CORRESPONDENCE_BUDGET = 11_000; // under MAX_CONTEXT_CHARS (12 000)

async function checkDealReaderAccess(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
  userId: string,
): Promise<AgentAccessResult> {
  const { data } = await svc.rpc("can_read_boq", { _opportunity_id: entityId, _user_id: userId });
  return data === true
    ? { ok: true }
    : { ok: false, code: "AI_RECORD_ACCESS_DENIED", message: "You do not have access to this record." };
}

const squash = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export async function loadDealCorrespondenceContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
  input: Record<string, unknown>,
): Promise<AgentContextResult> {
  const { data: opp } = await svc.from("opportunities")
    .select("id, project_name, client, sales_stage, stage").eq("id", entityId).maybeSingle().throwOnError();
  if (!opp) return { ok: false, code: "AI_INPUT_INVALID", message: "Opportunity not found." };

  const { data: rows } = await svc.from("activities")
    .select("id, activity_type, status, occurred_at, summary, draft_content, email_from")
    .eq("related_opportunity_id", entityId)
    .in("activity_type", ["email_received", "email_draft"])
    .order("occurred_at", { ascending: false })
    .limit(CORRESPONDENCE_MAX_EMAILS * 2)
    .throwOnError();
  // Unsent drafts are not correspondence.
  const sent = (rows ?? []).filter((r) => r.activity_type === "email_received" || r.status === "sent")
    .slice(0, CORRESPONDENCE_MAX_EMAILS).reverse();
  if (sent.length === 0) return { ok: false, code: "AI_INPUT_INVALID", message: "There are no emails on this deal yet." };

  const language = input.language === "ar" ? "ar" : "en";
  const build = (perEmail: number, emails: typeof sent) => JSON.stringify({
    language,
    deal: { project_name: squash(opp.project_name, 200), client: squash(opp.client, 200), stage: resolveCanonicalStage(opp).stage },
    emails: emails.map((r) => ({
      id: r.id,
      direction: r.activity_type === "email_received" ? "client_to_phc" : "phc_to_client",
      date: String(r.occurred_at ?? "").slice(0, 10),
      from: squash(r.email_from, 120) || null,
      subject: squash(r.summary, 200),
      text: squash(r.draft_content, perEmail),
    })),
  });
  // Fit the budget: shorter excerpts first, then drop the oldest emails.
  let emails = sent;
  let contextText = build(600, emails);
  for (const n of [450, 300, 200]) if (contextText.length > CORRESPONDENCE_BUDGET) contextText = build(n, emails);
  while (contextText.length > CORRESPONDENCE_BUDGET && emails.length > 1) {
    emails = emails.slice(1);
    contextText = build(200, emails);
  }

  const manifest: ContextManifest = {
    fields_loaded: ["opportunities.project_name", "opportunities.client", "opportunities.stage",
      "activities.summary", "activities.draft_content", "activities.email_from", "activities.occurred_at"],
    record_counts: { opportunities: 1, activities: emails.length },
    source_entity_types: ["opportunities", "activities"],
    redacted_identifiers: { opportunity_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount: 1 + emails.length };
}

// ---------------------------------------------------------------------------
// daily_email_brief — a person's own client email since their last brief.
// The "entity" is the person: entityId must be the caller's own user id.
// ---------------------------------------------------------------------------

export const BRIEF_MAX_CANDIDATES = 25;
const BRIEF_BUDGET = 11_000;
const OPEN = (stage: string | null) => stage !== "won" && stage !== "lost";

async function checkOwnBriefAccess(
  _svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
  userId: string,
): Promise<AgentAccessResult> {
  return entityId === userId
    ? { ok: true }
    : { ok: false, code: "AI_RECORD_ACCESS_DENIED", message: "A daily brief is only for your own email." };
}

type BriefEmail = {
  id: string; activity_type: string; status: string; created_at: string; occurred_at: string;
  summary: string | null; draft_content: string | null; email_from: string | null;
  related_opportunity_id: string | null;
};

export async function loadDailyEmailBriefContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  userId: string,
  input: Record<string, unknown>,
): Promise<AgentContextResult> {
  // Since the last brief, or the last 24 hours; never more than 7 days back.
  const { data: last } = await svc.from("ai_agent_outputs").select("created_at")
    .eq("agent_key", "daily_email_brief").eq("requested_by", userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle().throwOnError();
  const floor = Date.now() - 7 * 86_400_000;
  const lastAt = last ? Date.parse(String(last.created_at)) : NaN;
  const since = new Date(Math.max(floor, Number.isFinite(lastAt) ? lastAt : Date.now() - 86_400_000)).toISOString();

  const { data: deals } = await svc.from("opportunities").select("id, project_name, sales_stage, stage")
    .eq("owner_id", userId).limit(500).throwOnError();
  const dealById = new Map((deals ?? []).map((d) => [d.id as string, d]));

  const cols = "id, activity_type, status, created_at, occurred_at, summary, draft_content, email_from, related_opportunity_id";
  const { data: mine } = await svc.from("activities").select(cols)
    .eq("owner_id", userId).in("activity_type", ["email_received", "email_draft"])
    .gte("created_at", since).order("created_at", { ascending: false }).limit(100).throwOnError();
  const onDeals: BriefEmail[] = [];
  const ids = [...dealById.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await svc.from("activities").select(cols)
      .in("related_opportunity_id", ids.slice(i, i + 100)).in("activity_type", ["email_received", "email_draft"])
      .gte("created_at", since).order("created_at", { ascending: false }).limit(100).throwOnError();
    onDeals.push(...((data ?? []) as BriefEmail[]));
  }

  // Unsent drafts are not email; the same email reached by both routes once.
  const all = new Map<string, BriefEmail>();
  for (const e of [...((mine ?? []) as BriefEmail[]), ...onDeals]) {
    if (e.activity_type === "email_received" || e.status === "sent") all.set(e.id, e);
  }
  if (all.size === 0) return { ok: false, code: "AI_INPUT_INVALID", message: "No new client email since your last brief." };

  // Open-deal email first, then received before sent, then newest.
  const dealOf = (e: BriefEmail) => (e.related_opportunity_id ? dealById.get(e.related_opportunity_id) ?? null : null);
  const rank = (e: BriefEmail) => {
    const d = dealOf(e);
    const stage = d ? resolveCanonicalStage(d).stage : null;
    return (d && OPEN(stage) ? 0 : d ? 2 : 1) * 2 + (e.activity_type === "email_received" ? 0 : 1);
  };
  let picked = [...all.values()]
    .sort((a, b) => rank(a) - rank(b) || Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, BRIEF_MAX_CANDIDATES);

  const language = input.language === "ar" ? "ar" : "en";
  const build = (n: number) => JSON.stringify({
    language,
    emails: picked.map((e) => {
      const d = dealOf(e);
      const stage = d ? resolveCanonicalStage(d).stage : null;
      return {
        id: e.id,
        direction: e.activity_type === "email_received" ? "client_to_phc" : "phc_to_client",
        date: String(e.occurred_at ?? "").slice(0, 10),
        deal: d ? { name: squash(d.project_name, 120), stage, open: OPEN(stage) } : null,
        from: squash(e.email_from, 100) || null,
        subject: squash(e.summary, 160),
        text: squash(e.draft_content, n),
      };
    }),
  });
  let contextText = build(350);
  for (const n of [250, 160, 100]) if (contextText.length > BRIEF_BUDGET) contextText = build(n);
  while (contextText.length > BRIEF_BUDGET && picked.length > 1) {
    picked = picked.slice(0, -1); // drop the least important
    contextText = build(100);
  }

  const manifest: ContextManifest = {
    fields_loaded: ["activities.summary", "activities.draft_content", "activities.email_from",
      "activities.occurred_at", "opportunities.project_name", "opportunities.stage"],
    record_counts: { activities: picked.length, opportunities: new Set(picked.map((e) => e.related_opportunity_id).filter(Boolean)).size },
    source_entity_types: ["activities", "opportunities"],
    redacted_identifiers: { user_id: redactId(userId) },
  };
  return { ok: true, contextText, manifest, recordCount: picked.length };
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
      "id, project_name, stage, sales_stage, contract_value, tier, estimated_value_min, estimated_value_max, quotation_value, currency, next_action, next_action_due, last_activity_at, sector, win_confidence",
    )
    .eq("id", entityId)
    .maybeSingle().throwOnError();
  if (error || !opp) return { ok: false, code: "AI_INPUT_INVALID", message: "Opportunity not found." };

  // Limited recent activity only — last 5 follow-ups, not the full history.
  const { data: followUps } = await svc
    .from("follow_ups")
    .select("due_date, status, channel, last_contact_at")
    .eq("opportunity_id", entityId)
    .order("due_date", { ascending: false })
    .limit(5).throwOnError();

  const { data: rfqs } = await svc.from("rfqs").select("id, status, rfq_number").eq("opportunity_id", entityId).limit(3).throwOnError();
  const { data: tenders } = await svc
    .from("tenders")
    .select("id, tender_stage, tender_name")
    .eq("converted_opportunity_id", entityId)
    .limit(3).throwOnError();

  const opportunitySummary = {
    reference: opp.project_name,
    stage: resolveCanonicalStage(opp).stage,
    tier: opp.tier,
    value: opportunityValue(opp),
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
    .maybeSingle().throwOnError();
  if (error || !row) return { ok: false, code: "AI_INPUT_INVALID", message: "Staged row not found." };

  const { data: batch } = await svc
    .from("import_batches")
    .select("status, source_type, target_entity, total_rows")
    .eq("id", row.batch_id)
    .maybeSingle().throwOnError();
  const { data: file } = await svc.from("import_files").select("column_names").eq("id", row.file_id).maybeSingle().throwOnError();
  // No standalone "field dictionary" table exists in this schema (checked
  // during discovery) — the closest equivalent, already-chosen column
  // mappings for this batch, is substituted instead.
  const { data: mappings } = await svc
    .from("import_mappings")
    .select("source_column, target_table, target_column, is_key")
    .eq("batch_id", row.batch_id)
    .limit(OLD_DATA_MAPPINGS_LIMIT).throwOnError();
  const { data: dupes } = await svc
    .from("import_duplicate_candidates")
    .select("existing_table, existing_record_id, match_type, confidence")
    .eq("row_id", entityId)
    .limit(OLD_DATA_DUPES_LIMIT).throwOnError();

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
    select: "id, project_name, stage, sales_stage, next_action, next_action_due, last_activity_at",
    toSummary: (r) => ({
      type: "opportunity",
      reference: r.project_name,
      status: resolveCanonicalStage({ stage: r.stage as string | null, sales_stage: r.sales_stage as string | null }).stage,
      next_action: r.next_action,
      next_action_due: r.next_action_due,
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

export const RECENT_UPDATES_MAX = 10;

/**
 * A deal's latest events, newest first: client email (received and sent),
 * calls, visits, meetings, notes, and stage changes — plus its latest
 * quotation and the commitments still open. Excerpts are short so the whole
 * context stays far below MAX_CONTEXT_CHARS.
 */
export async function loadDealRecentUpdates(svc: SupabaseClient, opportunityId: string) {
  const [acts, stages, quotes, comms] = await Promise.all([
    svc.from("activities").select("activity_type, status, occurred_at, summary, draft_content")
      .eq("related_opportunity_id", opportunityId).order("occurred_at", { ascending: false }).limit(20).throwOnError(),
    svc.from("stage_transition_history").select("from_stage, to_stage, notes, created_at")
      .eq("record_id", opportunityId).order("created_at", { ascending: false }).limit(5).throwOnError(),
    svc.from("quotations").select("quote_number, status, value, currency, issued_date, valid_until, created_at")
      .eq("related_opportunity_id", opportunityId).order("created_at", { ascending: false }).limit(1).throwOnError(),
    svc.from("commitments").select("description, direction, due_date")
      .eq("opportunity_id", opportunityId).eq("status", "open").order("due_date", { ascending: true }).limit(5).throwOnError(),
  ]);
  const kindOf = (t: string) => t === "email_received" ? "email_from_client" : t === "email_draft" ? "email_to_client" : t;
  const events = [
    ...((acts.data ?? []) as Array<Record<string, unknown>>)
      // Unsent drafts are not something that happened.
      .filter((a) => !(String(a.activity_type).endsWith("_draft") && a.status !== "sent"))
      .map((a) => ({
        date: String(a.occurred_at ?? "").slice(0, 10),
        kind: kindOf(String(a.activity_type)),
        text: squash(`${a.summary ?? ""}${a.draft_content ? ` — ${a.draft_content}` : ""}`, 350),
      })),
    ...((stages.data ?? []) as Array<Record<string, unknown>>).map((s) => ({
      date: String(s.created_at ?? "").slice(0, 10),
      kind: "stage_change",
      text: squash(`${s.from_stage ?? "?"} → ${s.to_stage}${s.notes ? ` (${s.notes})` : ""}`, 200),
    })),
  ].sort((x, y) => y.date.localeCompare(x.date)).slice(0, RECENT_UPDATES_MAX);
  const q = (quotes.data ?? [])[0] as Record<string, unknown> | undefined;
  return {
    events,
    quotation: q ? { number: q.quote_number, status: q.status, value: q.value, currency: q.currency,
      issued: q.issued_date ?? String(q.created_at ?? "").slice(0, 10), valid_until: q.valid_until } : null,
    commitments: ((comms.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
      who: c.direction === "we_owe_client" ? "PHC owes the client" : "the client owes PHC",
      what: squash(c.description, 200), due: c.due_date,
    })),
  };
}

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

  const { data: record } = await svc.from(entityType).select(entry.select).eq("id", entityId).maybeSingle().throwOnError();
  if (!isPlainRecord(record)) return { ok: false, code: "AI_INPUT_INVALID", message: "Linked record not found." };

  const summary = entry.toSummary(record);
  const language = typeof input.language === "string" && (input.language === "en" || input.language === "ar") ? input.language : "en";
  let followUp = null;
  if (input.follow_up_id) {
    if (entityType !== "opportunities" || typeof input.follow_up_id !== "string") return { ok: false, code: "AI_INPUT_INVALID", message: "Follow-up requires its linked opportunity." };
    const { data } = await svc.from("follow_ups").select("id, due_date, status, channel, last_contact_at, notes")
      .eq("id", input.follow_up_id).eq("opportunity_id", entityId).maybeSingle().throwOnError();
    if (!data) return { ok: false, code: "AI_INPUT_INVALID", message: "Follow-up is not linked to this opportunity." };
    followUp = data;
  }
  // The deal page asks for the deal's latest updates, so the draft answers what
  // actually happened rather than a generic follow-up (user, 2026-10-04).
  const updates = entityType === "opportunities" && input.recent_updates === true
    ? await loadDealRecentUpdates(svc, entityId)
    : null;
  const contextText = JSON.stringify({
    current_date: new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Riyadh", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date()),
    requested_channel: requestedChannel, language, linked_record: summary, follow_up: followUp,
    ...(updates ? { recent_updates: updates.events, latest_quotation: updates.quotation, open_commitments: updates.commitments } : {}),
  }, null, 2);
  const manifest: ContextManifest = {
    fields_loaded: [...Object.keys(summary), ...(updates ? ["activities", "stage_transition_history", "quotations", "commitments"] : [])],
    record_counts: { [entityType]: 1, ...(updates ? { recent_updates: updates.events.length, commitments: updates.commitments.length } : {}) },
    source_entity_types: [entityType, ...(updates ? ["activities", "stage_transition_history", "quotations", "commitments"] : [])],
    redacted_identifiers: { entity_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount: 1 + (updates ? updates.events.length + (updates.quotation ? 1 : 0) + updates.commitments.length : 0) };
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
    .maybeSingle().throwOnError();
  if (batchError || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: rows } = await svc
    .from("import_rows")
    .select("id, raw_data, mapped_data, status")
    .eq("batch_id", entityId)
    .limit(DATA_CLEANUP_ROWS_LIMIT).throwOnError();

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
        detected_headers: r.raw_data && typeof r.raw_data === "object" ? Object.keys(r.raw_data) : [],
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
    .maybeSingle().throwOnError();
  if (batchError || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: rows } = await svc
    .from("import_rows")
    .select("id, raw_data, mapped_data, status")
    .eq("batch_id", entityId)
    .limit(CONTACT_MAPPING_ROWS_LIMIT).throwOnError();

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
        detected_headers: r.raw_data && typeof r.raw_data === "object" ? Object.keys(r.raw_data) : [],
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
    .select("id, project_name, stage, sales_stage, contract_value, quotation_value, updated_at, estimated_value_max, owner_id")
    .neq("stage", "archived")
    .order("updated_at", { ascending: false })
    .limit(PIPELINE_OPPS_LIMIT).throwOnError();

  const { data: leads } = await svc
    .from("leads")
    .select("id, project_name, location, lead_stage, created_at")
    .order("created_at", { ascending: false })
    .limit(PIPELINE_LEADS_LIMIT).throwOnError();

  const contextText = JSON.stringify(
    {
      pipeline_snapshot: {
        as_of: new Date().toISOString(),
        scope: "Recent sample only; do not infer company totals or absence of other opportunities.",
      },
      opportunities: (opps ?? []).map((o) => ({
        id: o.id,
        project_name: o.project_name,
        stage: resolveCanonicalStage(o).stage,
        updated_at: o.updated_at,
        value: opportunityValue(o),
        owner_id: o.owner_id,
      })),
      leads: (leads ?? []).map((l) => ({
        id: l.id,
        project_name: l.project_name,
        location: l.location,
        stage: l.lead_stage,
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
      "id, project_name, stage, sales_stage, contract_value, tier, estimated_value_min, estimated_value_max, quotation_value, currency, next_action, next_action_due, last_activity_at, sector, company_id",
    )
    .eq("id", entityId)
    .maybeSingle().throwOnError();
  if (error || !opp) return { ok: false, code: "AI_INPUT_INVALID", message: "Opportunity not found." };

  // Linked company for client-type risk assessment.
  let company: { name: unknown; company_type: unknown; relationship_level: unknown } | null = null;
  if (opp.company_id) {
    const { data: co } = await svc
      .from("companies")
      .select("name, company_type, relationship_level")
      .eq("id", opp.company_id)
      .maybeSingle().throwOnError();
    if (isPlainRecord(co)) {
      company = { name: co.name, company_type: co.company_type, relationship_level: co.relationship_level };
    }
  }

  // Document presence signals (counts only — no PII).
  const { count: quotationCount } = await svc
    .from("quotations")
    .select("id", { count: "exact", head: true })
    .eq("related_opportunity_id", entityId).throwOnError();

  const { count: boqCount } = await svc
    .from("boqs")
    .select("id", { count: "exact", head: true })
    .eq("related_opportunity_id", entityId).throwOnError();

  const contextText = JSON.stringify(
    {
      opportunity: {
        id: opp.id,
        project_name: opp.project_name,
        stage: resolveCanonicalStage(opp).stage,
        tier: opp.tier,
        value: opportunityValue(opp),
        currency: opp.currency,
        next_action: opp.next_action,
        next_action_due: opp.next_action_due,
        last_activity_at: opp.last_activity_at,
        sector: opp.sector,
      },
      client: company,
      document_presence: {
        linked_quotations: quotationCount ?? 0,
        linked_boqs: boqCount ?? 0,
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
// Agent 15 — commercial_risk_assessment (2026-08-04, widened same day)
// Mirrors loadRiskFinanceContext's shape. Started as rfqs/tenders only;
// widened to quotations (same "deal risk" shape as rfqs/tenders — a linked
// project/company) and companies (a genuinely different shape — account
// relationship health, not a single deal — so it gets its own branch below
// rather than being forced through the deal-record enrichment logic).
// ---------------------------------------------------------------------------

async function loadCommercialRiskContext(
  svc: SupabaseClient,
  entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  if (entityType === "companies") {
    const { data: co } = await svc
      .from("companies")
      .select("id, name, company_type, account_status, relationship_level, next_action, next_action_due, last_contact_at")
      .eq("id", entityId)
      .maybeSingle().throwOnError();
    if (!isPlainRecord(co)) return { ok: false, code: "AI_INPUT_INVALID", message: "Company not found." };

    const { count: opportunityCount } = await svc.from("opportunities").select("id", { count: "exact", head: true }).eq("company_id", entityId).throwOnError();
    const { count: contactCount } = await svc.from("contacts").select("id", { count: "exact", head: true }).eq("company_id", entityId).throwOnError();

    const contextText = JSON.stringify(
      { record_type: "companies", record: co, linked_counts: { opportunities: opportunityCount ?? 0, contacts: contactCount ?? 0 } },
      null,
      2,
    );
    const manifest: ContextManifest = {
      fields_loaded: Object.keys(co),
      record_counts: { companies: 1, opportunities: opportunityCount ?? 0, contacts: contactCount ?? 0 },
      source_entity_types: ["companies", "opportunities", "contacts"],
      redacted_identifiers: { entity_id: redactId(entityId) },
    };
    return { ok: true, contextText, manifest, recordCount: 1 };
  }

  if (entityType !== "rfqs" && entityType !== "tenders" && entityType !== "quotations") {
    return { ok: false, code: "AI_ENTITY_NOT_ALLOWED", message: "Unsupported entity type for this agent." };
  }

  let record: Record<string, unknown>;
  let projectId: unknown;
  let companyId: unknown = null;
  if (entityType === "rfqs") {
    const { data } = await svc
      .from("rfqs")
      .select("id, rfq_number, classification, status, received_date, response_due_date, estimated_value, project_id, company_id")
      .eq("id", entityId)
      .maybeSingle().throwOnError();
    if (!isPlainRecord(data)) return { ok: false, code: "AI_INPUT_INVALID", message: "RFQ not found." };
    record = data;
    projectId = data.project_id;
    companyId = data.company_id;
  } else if (entityType === "tenders") {
    const { data } = await svc
      .from("tenders")
      .select("id, tender_name, tender_stage, tender_priority_classification, expected_award_date, estimated_project_value, signage_potential, project_id")
      .eq("id", entityId)
      .maybeSingle().throwOnError();
    if (!isPlainRecord(data)) return { ok: false, code: "AI_INPUT_INVALID", message: "Tender not found." };
    record = data;
    projectId = data.project_id;
  } else {
    const { data } = await svc
      .from("quotations")
      .select("id, quote_number, version, status, value, currency, valid_until, issued_date, last_follow_up_at, related_opportunity_id")
      .eq("id", entityId)
      .maybeSingle().throwOnError();
    if (!isPlainRecord(data)) return { ok: false, code: "AI_INPUT_INVALID", message: "Quotation not found." };
    record = data;
    if (typeof data.related_opportunity_id === "string") {
      const { data: opp } = await svc.from("opportunities").select("project_id, company_id").eq("id", data.related_opportunity_id).maybeSingle().throwOnError();
      if (isPlainRecord(opp)) {
        projectId = opp.project_id;
        companyId = opp.company_id;
      }
    }
  }

  let project: { name: unknown; project_stage: unknown } | null = null;
  if (typeof projectId === "string") {
    const { data: proj } = await svc.from("projects").select("name, project_stage").eq("id", projectId).maybeSingle().throwOnError();
    if (isPlainRecord(proj)) project = { name: proj.name, project_stage: proj.project_stage };
  }

  let company: { name: unknown; company_type: unknown } | null = null;
  if (typeof companyId === "string") {
    const { data: co } = await svc.from("companies").select("name, company_type").eq("id", companyId).maybeSingle().throwOnError();
    if (isPlainRecord(co)) company = { name: co.name, company_type: co.company_type };
  }

  const contextText = JSON.stringify({ record_type: entityType, record, linked_project: project, linked_company: company }, null, 2);
  const recordCount = 1 + (project ? 1 : 0) + (company ? 1 : 0);
  const manifest: ContextManifest = {
    fields_loaded: Object.keys(record),
    record_counts: { [entityType]: 1, projects: project ? 1 : 0, companies: company ? 1 : 0 },
    source_entity_types: [entityType, "projects", "companies"],
    redacted_identifiers: { entity_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// ---------------------------------------------------------------------------
// Agent 16 — project_job_notes (2026-08-04)
// Single project_jobs card — Production section, not Sales. No per-record
// owner concept (project_jobs RLS is team-based, is_sales_contributor OR
// system_admin), so checkAccess is role-only (see checkOwnershipAccess: no
// OWNER_FIELD_BY_ENTITY entry for "project_jobs" -> falls through to true).
// ---------------------------------------------------------------------------

async function loadProjectJobNotesContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: job } = await svc
    .from("project_jobs")
    .select("id, title, description, due_date, stage_id, assignee_id, project_id")
    .eq("id", entityId)
    .maybeSingle().throwOnError();
  if (!isPlainRecord(job)) return { ok: false, code: "AI_INPUT_INVALID", message: "Job not found." };

  let stageName: unknown = null;
  if (typeof job.stage_id === "string") {
    const { data: stage } = await svc.from("project_job_stages").select("name").eq("id", job.stage_id).maybeSingle().throwOnError();
    if (isPlainRecord(stage)) stageName = stage.name;
  }

  let project: { name: unknown; project_number: unknown; project_stage: unknown } | null = null;
  if (typeof job.project_id === "string") {
    const { data: proj } = await svc.from("projects").select("name, project_number, project_stage").eq("id", job.project_id).maybeSingle().throwOnError();
    if (isPlainRecord(proj)) project = { name: proj.name, project_number: proj.project_number, project_stage: proj.project_stage };
  }

  let assigneeName: unknown = null;
  if (typeof job.assignee_id === "string") {
    const { data: profile } = await svc.from("profiles").select("full_name").eq("id", job.assignee_id).maybeSingle().throwOnError();
    if (isPlainRecord(profile)) assigneeName = profile.full_name;
  }

  const contextText = JSON.stringify(
    {
      job: { id: job.id, title: job.title, description: job.description, due_date: job.due_date, stage: stageName, assignee: assigneeName },
      project,
    },
    null,
    2,
  );
  const recordCount = 1 + (project ? 1 : 0);
  const manifest: ContextManifest = {
    fields_loaded: ["title", "description", "due_date", "stage", "assignee", "project.name", "project.project_number", "project.project_stage"],
    record_counts: { project_jobs: 1, projects: project ? 1 : 0 },
    source_entity_types: ["project_jobs", "projects"],
    redacted_identifiers: { entity_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount };
}

// ---------------------------------------------------------------------------
// Agent 17 — project_budget_variance (2026-08-04)
// A project's budget line items — planned vs. actual. No per-record owner
// concept for "projects" either (falls through to role-only, same as above).
// ---------------------------------------------------------------------------

const BUDGET_VARIANCE_ITEMS_LIMIT = 15;

async function loadProjectBudgetVarianceContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  entityId: string,
): Promise<AgentContextResult> {
  const { data: project } = await svc
    .from("projects")
    .select("id, name, project_number, total_value, project_stage")
    .eq("id", entityId)
    .maybeSingle().throwOnError();
  if (!isPlainRecord(project)) return { ok: false, code: "AI_INPUT_INVALID", message: "Project not found." };

  const allItems = await readAll((from, to) => svc.from("project_budget_items")
    .select("id, category, description, planned_amount, actual_amount, currency")
    .eq("project_id", entityId).order("id").range(from, to));
  const totals: Record<string, { planned: number; actual: number; missing_planned: number; missing_actual: number; count: number }> = {};
  for (const item of allItems) {
    const group = totals[item.currency || "UNKNOWN"] ??= { planned: 0, actual: 0, missing_planned: 0, missing_actual: 0, count: 0 };
    group.count++;
    if (item.planned_amount == null) group.missing_planned++; else group.planned += Number(item.planned_amount);
    if (item.actual_amount == null) group.missing_actual++; else group.actual += Number(item.actual_amount);
  }
  const budgetItems = allItems.slice(0, BUDGET_VARIANCE_ITEMS_LIMIT);

  const contextText = JSON.stringify(
    {
      project: { name: project.name, project_number: project.project_number, total_value: project.total_value, project_stage: project.project_stage },
      budget_items_sample: budgetItems,
      complete_totals_by_currency: totals,
      total_items: allItems.length,
      sampled_items: budgetItems.length,
      instruction: "Use complete totals for variance. Sample descriptions are not the full budget. Missing costs are unknown, never zero.",
    },
    null,
    2,
  );
  const manifest: ContextManifest = {
    fields_loaded: ["project.name", "project.project_number", "project.total_value", "project.project_stage", "budget_items"],
    record_counts: { projects: 1, project_budget_items: allItems.length },
    source_entity_types: ["projects", "project_budget_items"],
    redacted_identifiers: { entity_id: redactId(entityId) },
  };
  return { ok: true, contextText, manifest, recordCount: 1 + budgetItems.length };
}

// ---------------------------------------------------------------------------
// Agent 18 — sales_report_insights (2026-08-04)
// Company-wide summary, no single record — mirrors the aggregations
// reports.tsx already computes client-side (win rate via the same formula
// as computeQuotationWinRatePct in src/lib/dashboard-helpers.ts; pipeline
// value by opportunity stage; quotation funnel by status; lost-reason
// frequency, not the raw reason strings, to keep the context bounded).
// ---------------------------------------------------------------------------

async function checkSalesReportInsightsAccess(): Promise<AgentAccessResult> {
  return { ok: true };
}

async function loadSalesReportInsightsContext(
  svc: SupabaseClient,
  _entityType: EntityType,
  _entityId: string,
  input: Record<string, unknown>,
): Promise<AgentContextResult> {
  const [opps, quotes] = await Promise.all([
    readAll((from, to) => svc.from("opportunities").select("id, stage, sales_stage, contract_value, quotation_value, estimated_value_max, currency").order("id").range(from, to)),
    readAll((from, to) => svc.from("quotations").select("id, status, value, currency").order("id").range(from, to)),
  ]);
  const facts = salesFacts(opps, quotes);
  return {
    ok: true, contextText: JSON.stringify({ ...facts, language: input.language === "ar" ? "ar" : "en" }), recordCount: 1,
    manifest: { fields_loaded: Object.keys(facts), record_counts: { opportunities: opps.length, quotations: quotes.length },
      source_entity_types: ["opportunities", "quotations"], redacted_identifiers: {} },
  };
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
    .maybeSingle().throwOnError();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: file } = await svc
    .from("import_files")
    .select("id, file_type, column_names, row_count, sheet_count")
    .eq("batch_id", entityId)
    .limit(1)
    .maybeSingle().throwOnError();

  // Up to 5 preview rows — raw_data only, no mapped_data needed at this stage.
  const { data: previewRows } = await svc
    .from("import_rows")
    .select("row_number, raw_data")
    .eq("batch_id", entityId)
    .order("row_number")
    .limit(5).throwOnError();

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
    .maybeSingle().throwOnError();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: file } = await svc
    .from("import_files")
    .select("file_type, column_names, sheet_count, file_name")
    .eq("batch_id", entityId)
    .limit(1)
    .maybeSingle().throwOnError();

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
    .maybeSingle().throwOnError();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: file } = await svc
    .from("import_files")
    .select("column_names")
    .eq("batch_id", entityId)
    .limit(1)
    .maybeSingle().throwOnError();

  const columns: string[] = (file?.column_names ?? []).slice(0, 100);

  // Up to 3 sample rows for value examples.
  const { data: sampleRows } = await svc
    .from("import_rows")
    .select("raw_data")
    .eq("batch_id", entityId)
    .limit(MAPPER_SAMPLE_VALUES).throwOnError();

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
    .limit(MAPPER_MAPPINGS_LIMIT).throwOnError();

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
    .maybeSingle().throwOnError();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  const { data: rows } = await svc
    .from("import_rows")
    .select("id, row_number, mapped_data, status")
    .eq("batch_id", entityId)
    .eq("status", "valid")
    .order("row_number")
    .limit(EXTRACTOR_ROWS_LIMIT).throwOnError();

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
    .maybeSingle().throwOnError();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  // Accepted split proposals for this batch.
  const { data: proposals } = await svc
    .from("import_split_proposals")
    .select("id, source_row_id, entity_type, proposed_payload, role")
    .eq("batch_id", entityId)
    .eq("review_status", "accepted")
    .limit(RESOLVER_PROPOSALS_LIMIT).throwOnError();

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
    .limit(RESOLVER_CRM_HINTS).throwOnError();
  const { data: crmContacts } = await svc
    .from("contacts")
    .select("id, name")
    .order("name")
    .limit(RESOLVER_CRM_HINTS).throwOnError();

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
    .maybeSingle().throwOnError();
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
    .maybeSingle().throwOnError();

  // Sample duplicate candidates to understand what changed.
  const { data: dupes } = await svc
    .from("import_duplicate_candidates")
    .select("match_type, match_scope, confidence, matched_fields, suggested_action")
    .eq("batch_id", entityId)
    .limit(CHANGE_DUPES_LIMIT).throwOnError();

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
    .maybeSingle().throwOnError();
  if (error || !batch) return { ok: false, code: "AI_INPUT_INVALID", message: "Import batch not found." };

  // Summaries of prior agent outputs for this batch (not full payloads — just metadata).
  const { data: priorOutputs } = await svc
    .from("ai_agent_outputs")
    .select("agent_key, output_type, status, created_at")
    .eq("entity_id", entityId)
    .eq("entity_type", "import_batches")
    .order("created_at", { ascending: false })
    .limit(REVIEWER_OUTPUTS_LIMIT).throwOnError();

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
    // On a deal: whoever may read the deal (can_read_boq), so the person who
    // presses Send email on it gets a draft. Elsewhere: the record's owner.
    checkAccess: (svc, entityType, entityId, userId, roles) =>
      entityType === "opportunities"
        ? checkDealReaderAccess(svc, entityType, entityId, userId)
        : checkOwnershipAccess(svc, entityType, entityId, userId, roles),
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
  commercial_risk_assessment: {
    key: "commercial_risk_assessment",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.commercial_risk_assessment,
    hasRole: AGENT_ROLE_CHECK.commercial_risk_assessment,
    checkAccess: checkOwnershipAccess,
    loadContext: loadCommercialRiskContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.commercial_risk_assessment,
    outputSchema: AGENT_OUTPUT_SCHEMAS.commercial_risk_assessment,
    outputType: AGENT_OUTPUT_TYPES.commercial_risk_assessment,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
  project_job_notes: {
    key: "project_job_notes",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.project_job_notes,
    hasRole: AGENT_ROLE_CHECK.project_job_notes,
    checkAccess: checkOwnershipAccess,
    loadContext: loadProjectJobNotesContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.project_job_notes,
    outputSchema: AGENT_OUTPUT_SCHEMAS.project_job_notes,
    outputType: AGENT_OUTPUT_TYPES.project_job_notes,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
  project_budget_variance: {
    key: "project_budget_variance",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.project_budget_variance,
    hasRole: AGENT_ROLE_CHECK.project_budget_variance,
    checkAccess: checkOwnershipAccess,
    loadContext: loadProjectBudgetVarianceContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.project_budget_variance,
    outputSchema: AGENT_OUTPUT_SCHEMAS.project_budget_variance,
    outputType: AGENT_OUTPUT_TYPES.project_budget_variance,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
  daily_email_brief: {
    key: "daily_email_brief",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.daily_email_brief,
    hasRole: AGENT_ROLE_CHECK.daily_email_brief,
    checkAccess: checkOwnBriefAccess,
    loadContext: loadDailyEmailBriefContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.daily_email_brief,
    outputSchema: AGENT_OUTPUT_SCHEMAS.daily_email_brief,
    outputType: AGENT_OUTPUT_TYPES.daily_email_brief,
    maxContextRecords: 30,
    allowProviderFallback: true,
  },
  deal_correspondence_summary: {
    key: "deal_correspondence_summary",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.deal_correspondence_summary,
    hasRole: AGENT_ROLE_CHECK.deal_correspondence_summary,
    checkAccess: checkDealReaderAccess,
    loadContext: loadDealCorrespondenceContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.deal_correspondence_summary,
    outputSchema: AGENT_OUTPUT_SCHEMAS.deal_correspondence_summary,
    outputType: AGENT_OUTPUT_TYPES.deal_correspondence_summary,
    maxContextRecords: 25,
    allowProviderFallback: true,
  },
  sales_report_insights: {
    key: "sales_report_insights",
    allowedEntityTypes: AGENT_ENTITY_ALLOWLIST.sales_report_insights,
    hasRole: AGENT_ROLE_CHECK.sales_report_insights,
    checkAccess: checkSalesReportInsightsAccess,
    loadContext: loadSalesReportInsightsContext,
    buildPrompt: AGENT_PROMPT_BUILDERS.sales_report_insights,
    outputSchema: AGENT_OUTPUT_SCHEMAS.sales_report_insights,
    outputType: AGENT_OUTPUT_TYPES.sales_report_insights,
    maxContextRecords: 20,
    allowProviderFallback: true,
  },
} satisfies Record<AgentKey, AgentDefinition>;
