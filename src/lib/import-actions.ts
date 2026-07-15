/**
 * Data Import Center — client-side actions.
 *
 * Role enforcement:
 *   system_admin: upload, parse, map, validate, troubleshoot, view, download
 *   system_admin: CANNOT approve or commit (returns 403 from edge function)
 *   managing_director, general_manager, sales_manager, ceo: full access
 *   bd_manager: own batches only, no approve/commit
 *   salesperson, viewer: blocked entirely
 */

import { supabase } from "@/integrations/supabase/client";
import { type AppRole, ROLE_GROUPS } from "@/lib/roles";
import type { AiAgentCallResult, AiAgentOutput, ImportSplitProposal } from "@/integrations/supabase/types";
export type { AiAgentCallResult, ImportSplitProposal } from "@/integrations/supabase/types";

// Import tables are not in the auto-generated Supabase types yet.
// Use this untyped accessor until types are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type SourceKind =
  | "client_relations"
  | "project_reference"
  | "sales_overview"
  | "protenders_leads"
  | "quotation_masterlist"
  | "weekly_sales_update"
  | "unknown";

export type ImportSourceProfile = {
  id: string;
  name: string;
  source_kind: SourceKind;
  description: string | null;
  expected_dataset_types: string[];
  schema_signature: string | null;
  known_column_aliases: Record<string, string>;
  is_recurring: boolean;
  owner_id: string | null;
  last_successful_batch_id: string | null;
  last_imported_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ImportRecordCandidate = {
  id: string;
  batch_id: string;
  source_row_id: string | null;
  entity_type: "companies" | "contacts" | "leads" | "opportunities" | "projects" | "quotations" | "follow_ups" | "account_interactions" | "quotation_updates" | "sales_actuals";
  proposed_action: "create" | "update" | "no_change" | "needs_review" | "conflict" | "duplicate";
  identity_key: string | null;
  existing_record_id: string | null;
  existing_table: string | null;
  proposed_payload: Record<string, unknown>;
  changed_fields: string[];
  confidence: number | null;
  reason: string | null;
  review_status: "pending" | "approved" | "rejected" | "edited" | "needs_review";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Derived from ROLE_GROUPS so that new executive roles are picked up automatically.
export const IMPORT_CAPABLE_ROLES: AppRole[] = [
  ...ROLE_GROUPS.systemAdmin, ...ROLE_GROUPS.executive, ...ROLE_GROUPS.salesManager,
];

// Commercial sign-off authority — system_admin intentionally excluded (per roles.ts design rule).
export const APPROVE_COMMIT_ROLES: AppRole[] = [
  ...ROLE_GROUPS.executive, ...ROLE_GROUPS.salesManager,
];

export const UPLOAD_ROLES: AppRole[] = [
  ...IMPORT_CAPABLE_ROLES, ...ROLE_GROUPS.bdSalesOps,
];

export const BLOCKED_ROLES = ["salesperson", "viewer"] as const;

export type ImportBatchStatus =
  | "uploading" | "parsing" | "mapping" | "validating" | "duplicate_review"
  | "pending_approval" | "approved" | "dry_run" | "committed" | "failed" | "cancelled";

export type ImportBatch = {
  id: string;
  created_by: string;
  status: ImportBatchStatus;
  source_type: string;
  file_name: string | null;
  target_entity: ImportTargetEntity;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  duplicate_rows: number;
  dry_run: boolean;
  ai_suggestions_enabled: boolean;
  approved_by: string | null;
  approved_at: string | null;
  committed_at: string | null;
  source_profile_id: string | null;
  notes: string | null;
  archived_at: string | null;
  archived_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ImportTargetEntity =
  | "companies" | "contacts" | "leads" | "opportunities" | "projects"
  | "boq" | "rfqs" | "tenders" | "follow_ups" | "quotations";

export const TARGET_ENTITIES: { value: ImportTargetEntity; label: string }[] = [
  { value: "companies",     label: "Companies" },
  { value: "contacts",      label: "Contacts" },
  { value: "leads",         label: "Leads" },
  { value: "opportunities", label: "Opportunities" },
  { value: "projects",      label: "Projects" },
  { value: "boq",           label: "BOQ / Estimates" },
  { value: "rfqs",          label: "RFQs (Requests for Quotation)" },
  { value: "tenders",       label: "Tenders" },
  { value: "follow_ups",    label: "Follow-ups" },
  { value: "quotations",    label: "Quotations" },
];

export type ImportRow = {
  id: string;
  batch_id: string;
  file_id: string | null;
  row_number: number;
  raw_data: Record<string, unknown> | null;
  mapped_data: Record<string, unknown> | null;
  status: string;
  is_excluded: boolean;
  row_status: "active" | "edited" | "excluded" | "deleted" | "ai_split";
  edited_at: string | null;
  edited_by: string | null;
  edit_reason: string | null;
  excluded_at: string | null;
  excluded_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

export type DuplicateCandidate = {
  id: string;
  batch_id: string;
  row_id: string;
  existing_record_id: string;
  existing_table: string;
  match_scope: "within_file" | "existing_crm" | "previous_batch" | null;
  match_type: string;
  reason_code: string | null;
  matched_fields: string[] | null;
  confidence: number;
  suggested_action: string | null;
  resolution: string | null;
};

// -- Batch CRUD ----------------------------------------------------------------

export async function createBatch(
  opts: { target_entity?: ImportTargetEntity } = {},
): Promise<ImportBatch> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await db.from("import_batches").insert({
    created_by: user.id,
    status: "uploading",
    dry_run: true,
    ai_suggestions_enabled: false,
    target_entity: opts.target_entity ?? "companies",
  }).select().single();

  if (error) throw new Error(error.message);
  return data as ImportBatch;
}

/**
 * List batches. By default hides archived and soft-deleted batches.
 * Pass includeArchived / includeDeleted to override.
 */
export async function listBatches(
  opts: { includeArchived?: boolean; includeDeleted?: boolean } = {},
): Promise<ImportBatch[]> {
  let q = db.from("import_batches").select("*").order("created_at", { ascending: false });
  if (!opts.includeArchived) q = q.is("archived_at", null);
  if (!opts.includeDeleted)  q = q.is("deleted_at", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ImportBatch[];
}

// Alias per Phase 1.1 spec
export const listImportBatches = listBatches;

export async function getBatch(id: string): Promise<ImportBatch | null> {
  const { data, error } = await db
    .from("import_batches")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return data as ImportBatch;
}

// Alias per Phase 1.1 spec
export const getImportBatchDetails = getBatch;

export async function updateBatch(
  id: string,
  patch: Partial<Pick<ImportBatch, "target_entity" | "notes" | "file_name">>,
): Promise<void> {
  const { error } = await db.from("import_batches").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function cancelBatch(id: string): Promise<void> {
  const { error } = await db
    .from("import_batches")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

// -- Archive / Soft delete / Purge --------------------------------------------

export async function archiveImportBatch(id: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await db.from("import_batches").update({
    archived_at: new Date().toISOString(),
    archived_by: user.id,
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function unarchiveImportBatch(id: string): Promise<void> {
  const { error } = await db.from("import_batches").update({
    archived_at: null, archived_by: null,
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function softDeleteImportBatch(id: string, reason: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  if (!reason?.trim()) throw new Error("A reason is required to delete a batch");
  const { error } = await db.from("import_batches").update({
    deleted_at: new Date().toISOString(),
    deleted_by: user.id,
    delete_reason: reason.trim(),
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function restoreImportBatch(id: string): Promise<void> {
  const { error } = await db.from("import_batches").update({
    deleted_at: null, deleted_by: null, delete_reason: null,
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Permanently delete batch, storage file, and every import_* child row.
 * system_admin only (enforced by edge function + DB policy).
 * Requires typed confirmation string 'DELETE'.
 */
export async function purgeImportBatch(id: string, confirm: string): Promise<void> {
  await callPipeline("purge_batch", { batch_id: id, confirm });
}

// -- File upload ---------------------------------------------------------------

export async function uploadImportFile(
  batchId: string,
  file: File,
): Promise<{ fileId: string; storagePath: string }> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit`);
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "csv" && ext !== "xlsx") {
    throw new Error("Only .csv and .xlsx files are supported");
  }

  const storagePath = `${batchId}/${Date.now()}_${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("imports")
    .upload(storagePath, file);

  if (uploadError) throw new Error("Upload failed: " + uploadError.message);

  const { data: fileRecord, error: insertError } = await db
    .from("import_files")
    .insert({
      batch_id: batchId,
      file_name: file.name,
      file_type: ext,
      file_size_bytes: file.size,
      storage_path: storagePath,
    })
    .select()
    .single();

  if (insertError) throw new Error(insertError.message);

  // Denormalize file name onto the batch for history display
  await db.from("import_batches").update({ file_name: file.name }).eq("id", batchId);

  return { fileId: fileRecord.id, storagePath };
}


// -- Pipeline actions (call edge function) -------------------------------------

async function callPipeline(action: string, payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await supabase.functions.invoke("import-pipeline", {
    body: { action, ...payload },
  });

  if (res.error) {
    // supabase-js wraps non-2xx responses in a FunctionsHttpError with a
    // generic "non-2xx status" message. The real body lives on
    // res.error.context (a Response). Read it so the UI shows the cause.
    let detail = "";
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx: any = (res.error as any).context;
      if (ctx && typeof ctx.text === "function") {
        const raw = await ctx.text();
        try {
          const parsed = JSON.parse(raw);
          detail = parsed?.error ?? parsed?.message ?? raw;
        } catch {
          detail = raw;
        }
      }
    } catch { /* ignore */ }
    const base = typeof res.error === "object" && "message" in res.error
      ? (res.error as { message: string }).message
      : String(res.error);
    throw new Error(detail ? `${base}: ${detail}` : base);
  }

  return res.data;
}

export async function parseFile(batchId: string, fileId: string) {
  if (!batchId || !fileId) throw new Error("Missing batch or file");
  return callPipeline("parse", { batch_id: batchId, file_id: fileId });
}

export async function validateBatch(batchId: string) {
  if (!batchId) throw new Error("Missing batch");
  const mappings = await getMappings(batchId);
  if (mappings.length === 0) throw new Error("Save at least one column mapping before validating");
  return callPipeline("validate", { batch_id: batchId });
}


export async function detectDuplicates(batchId: string) {
  return callPipeline("detect_duplicates", { batch_id: batchId });
}

export async function approveBatch(batchId: string) {
  return callPipeline("approve", { batch_id: batchId });
}

export async function dryRunCommit(batchId: string) {
  return callPipeline("dry_run_commit", { batch_id: batchId });
}

export async function commitBatch(batchId: string) {
  if (!batchId) throw new Error("Missing batch");
  return callPipeline("commit", { batch_id: batchId }) as Promise<{ committed: number; failed: number; total: number }>;
}

export type ReportType = "validation_errors" | "duplicate_candidates" | "import_summary";
export type ReportFormat = "csv" | "json";

export async function downloadReport(
  batchId: string,
  reportType: ReportType,
  format: ReportFormat = "csv",
) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await supabase.functions.invoke("import-pipeline", {
    body: { action: "generate_report", batch_id: batchId, report_type: reportType, format },
  });

  if (res.error) throw new Error(String(res.error));

  const mime = format === "json" ? "application/json" : "text/csv";
  const payload = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
  const blob = new Blob([payload], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${reportType}_${batchId.slice(0, 8)}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

// -- Mappings ------------------------------------------------------------------

export type ImportMapping = {
  id: string;
  batch_id: string;
  source_column: string;
  target_table: string;
  target_column: string;
  transform: string | null;
  is_key: boolean;
};

export async function getMappings(batchId: string): Promise<ImportMapping[]> {
  const { data, error } = await db
    .from("import_mappings")
    .select("*")
    .eq("batch_id", batchId)
    .order("source_column");

  if (error) throw new Error(error.message);
  return (data ?? []) as ImportMapping[];
}

export async function saveMappings(
  batchId: string,
  mappings: Omit<ImportMapping, "id" | "batch_id">[],
): Promise<ImportMapping[]> {
  const seen = new Set<string>();
  const validMappings = mappings.filter((mapping) => {
    const source = mapping.source_column?.trim();
    const target = mapping.target_column?.trim();
    if (!source || !target || seen.has(source)) return false;
    seen.add(source);
    return true;
  });

  // Delete existing mappings for this batch
  const { error: deleteError } = await db.from("import_mappings").delete().eq("batch_id", batchId);
  if (deleteError) throw new Error(deleteError.message);

  if (validMappings.length === 0) return [];

  const { data, error } = await db.from("import_mappings").insert(
    validMappings.map((m) => ({ ...m, batch_id: batchId })),
  ).select();

  if (error) throw new Error(error.message);

  // Update batch status
  const { error: batchError } = await db.from("import_batches").update({ status: "validating" }).eq("id", batchId);
  if (batchError) throw new Error(batchError.message);

  return (data ?? []) as ImportMapping[];
}

// -- Queries for UI ------------------------------------------------------------

export async function getImportErrors(batchId: string) {
  const { data, error } = await db
    .from("import_errors")
    .select("*")
    .eq("batch_id", batchId)
    .order("row_number")
    .limit(500);

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getDuplicateCandidates(batchId: string) {
  const { data, error } = await db
    .from("import_duplicate_candidates")
    .select("*")
    .eq("batch_id", batchId)
    .order("confidence", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function resolveDuplicate(
  candidateId: string,
  resolution: "skip" | "merge" | "create_new",
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await db
    .from("import_duplicate_candidates")
    .update({
      resolution,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", candidateId);

  if (error) throw new Error(error.message);
}

export async function getImportFiles(batchId: string) {
  const { data, error } = await db
    .from("import_files")
    .select("*")
    .eq("batch_id", batchId)
    .order("created_at");

  if (error) throw new Error(error.message);
  return data ?? [];
}

// -- Parsed rows: view + edit + exclude + restore -----------------------------

export async function getImportRows(
  batchId: string,
  opts: { limit?: number; includeDeleted?: boolean } = {},
): Promise<ImportRow[]> {
  let q = db.from("import_rows").select("*").eq("batch_id", batchId).order("row_number");
  if (!opts.includeDeleted) q = q.neq("row_status", "deleted");
  q = q.limit(opts.limit ?? 500);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ImportRow[];
}

/**
 * Edit a single parsed row's raw_data cells.
 * Only touches import_rows — never writes to real CRM tables.
 */
export async function updateImportRow(
  rowId: string,
  patch: { raw_data: Record<string, unknown>; edit_reason?: string },
): Promise<ImportRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await db.from("import_rows").update({
    raw_data: patch.raw_data,
    edited_at: new Date().toISOString(),
    edited_by: user.id,
    edit_reason: patch.edit_reason ?? null,
    row_status: "edited",
    status: "pending", // must re-validate after edit
  }).eq("id", rowId).select().single();
  if (error) throw new Error(error.message);
  return data as ImportRow;
}

// Exclude a row from validation/dry-run. Uses the dedicated excluded_* columns
// (distinct from soft-delete). The row is preserved for restore/audit.
export async function excludeImportRow(rowId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await db.from("import_rows").update({
    is_excluded: true,
    row_status: "excluded",
    excluded_at: new Date().toISOString(),
    excluded_by: user.id,
  }).eq("id", rowId);
  if (error) throw new Error(error.message);
}

export async function restoreImportRow(rowId: string): Promise<void> {
  const { error } = await db.from("import_rows").update({
    is_excluded: false,
    row_status: "active",
    excluded_at: null,
    excluded_by: null,
    status: "pending", // re-validate after restore
  }).eq("id", rowId);
  if (error) throw new Error(error.message);
}

// Soft-delete a staged row (kept for audit; distinct from exclude).
export async function softDeleteImportRow(rowId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await db.from("import_rows").update({
    row_status: "deleted",
    deleted_at: new Date().toISOString(),
    deleted_by: user.id,
  }).eq("id", rowId);
  if (error) throw new Error(error.message);
}

// -- Storage download ---------------------------------------------------------

export async function getFileDownloadUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("imports")
    .createSignedUrl(storagePath, 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// -- Real-data readiness checklist (Section J) --------------------------------
// Stored on import_batches.readiness_checklist (jsonb). Staging metadata only.
export const READINESS_ITEMS = [
  { key: "file_source_confirmed", label: "File source confirmed", manual: true },
  { key: "owner_confirmed", label: "Data owner confirmed", manual: true },
  { key: "backup_completed", label: "Current CRM data backed up / exported", manual: true },
  { key: "no_unnecessary_sensitive_data", label: "File contains no unnecessary sensitive data", manual: true },
  { key: "mapping_reviewed", label: "Mapping reviewed", manual: false },
  { key: "validation_reviewed", label: "Validation reviewed", manual: false },
  { key: "duplicates_reviewed", label: "Duplicate resolution reviewed", manual: false },
  { key: "dry_run_generated", label: "Dry-run report generated", manual: false },
  { key: "approval_obtained", label: "Approval obtained (required before commit)", manual: false },
] as const;

export type ReadinessKey = (typeof READINESS_ITEMS)[number]["key"];
export type ReadinessChecklist = Partial<Record<ReadinessKey, boolean>>;

export async function saveReadinessChecklist(
  batchId: string,
  checklist: ReadinessChecklist,
): Promise<void> {
  const { error } = await db.from("import_batches").update({ readiness_checklist: checklist }).eq("id", batchId);
  if (error) throw new Error(error.message);
}

export async function getReadinessChecklist(batchId: string): Promise<ReadinessChecklist> {
  const { data, error } = await db.from("import_batches").select("readiness_checklist").eq("id", batchId).single();
  if (error) return {};
  return (data?.readiness_checklist ?? {}) as ReadinessChecklist;
}

// Derive the automatic (state-based) checklist items from batch state.
export function deriveAutoChecklist(batch: ImportBatch): ReadinessChecklist {
  return {
    mapping_reviewed: ["validating", "duplicate_review", "pending_approval", "approved", "dry_run"].includes(batch.status),
    validation_reviewed: batch.valid_rows > 0 || batch.error_rows > 0,
    duplicates_reviewed: ["pending_approval", "approved", "dry_run"].includes(batch.status),
    dry_run_generated: batch.status === "dry_run",
    approval_obtained: !!batch.approved_at,
  };
}

// -- Batch activity log (Section B, tab 13) -----------------------------------
export async function getBatchActivity(batchId: string) {
  const { data, error } = await db
    .from("audit_log")
    .select("id, action, actor_id, after_value, timestamp, created_at")
    .eq("entity_type", "import_batches")
    .eq("entity_id", batchId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return data ?? [];
}

// Group staged rows by intended target area for the per-entity staged tabs.
export type StagedGroup = "companies" | "contacts" | "opportunities" | "projects" | "rfq_tender" | "unmapped";

const STAGED_FIELD_MAP: Record<StagedGroup, string[]> = {
  companies: ["name", "company_name", "cr_number", "website", "website_domain", "company_type"],
  contacts: ["contact_name", "email", "phone", "contact_phone", "job_title"],
  opportunities: ["stage", "owner", "next_action", "lead_source", "estimated_value"],
  projects: ["project_name", "location", "consultant", "main_contractor"],
  rfq_tender: ["tender_ref", "rfq_number", "tender_number", "boq_value", "submission_date"],
  unmapped: [],
};

// Whether a staged row participates in validation / dry-run. Excluded and
// soft-deleted rows are ignored; restoring a row makes it processable again.
// The import-pipeline edge function applies the same rule server-side.
export function isRowProcessable(row: Pick<ImportRow, "is_excluded" | "row_status">): boolean {
  return !row.is_excluded && row.row_status !== "excluded" && row.row_status !== "deleted";
}

// Which staged groups a mapped row contributes to (display/staging only).
export function stagedGroupsForRow(mapped: Record<string, unknown> | null): StagedGroup[] {
  if (!mapped) return [];
  const keys = Object.keys(mapped).filter((k) => mapped[k] != null && mapped[k] !== "");
  const groups: StagedGroup[] = [];
  for (const g of Object.keys(STAGED_FIELD_MAP) as StagedGroup[]) {
    if (g === "unmapped") continue;
    if (STAGED_FIELD_MAP[g].some((f) => keys.includes(f))) groups.push(g);
  }
  return groups.length ? groups : ["unmapped"];
}

// Target columns for company mapping
export const COMPANY_TARGET_COLUMNS = [
  { value: "name", label: "Company Name", required: true },
  { value: "company_type", label: "Company Type" },
  { value: "cr_number", label: "CR Number" },
  { value: "website", label: "Website" },
  { value: "website_domain", label: "Website Domain" },
  { value: "regions", label: "Regions" },
  { value: "account_status", label: "Account Status" },
  { value: "relationship_level", label: "Relationship Level" },
  { value: "last_contact_at", label: "Last Contact Date" },
  { value: "next_action", label: "Next Action" },
  { value: "next_action_due", label: "Next Action Due Date" },
  { value: "internal_notes", label: "Internal Notes" },
  { value: "upsell_notes", label: "Upsell Notes" },
  { value: "source", label: "Source" },
] as const;

export const CONTACT_TARGET_COLUMNS = [
  { value: "name", label: "Contact Name", required: true },
  { value: "title", label: "Job Title" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "location", label: "Office Location" },
  { value: "authority", label: "Authority Level" },
  { value: "notes", label: "Notes" },
  { value: "source", label: "Source" },
] as const;

export const LEAD_TARGET_COLUMNS = [
  { value: "project_name", label: "Project Name", required: true },
  { value: "location", label: "Location" },
  { value: "sector", label: "Sector" },
  { value: "main_contractor", label: "Main Contractor" },
  { value: "total_value", label: "Total Value" },
  { value: "source", label: "Source" },
  { value: "notes", label: "Notes" },
] as const;

export const OPPORTUNITY_TARGET_COLUMNS = [
  { value: "project_name", label: "Project Name", required: true },
  { value: "client", label: "Client Company" },
  { value: "main_contractor", label: "Main Contractor" },
  { value: "location", label: "Location" },
  { value: "sector", label: "Sector" },
  { value: "estimated_value_min", label: "Min Value (SAR)" },
  { value: "estimated_value_max", label: "Max Value (SAR)" },
  { value: "quotation_value", label: "Quotation Value (SAR)" },
  { value: "stage", label: "Stage" },
  { value: "next_action", label: "Next Action" },
  { value: "next_action_due", label: "Next Action Due" },
  { value: "notes", label: "Notes" },
  { value: "source", label: "Source" },
] as const;

export const PROJECT_TARGET_COLUMNS = [
  { value: "name", label: "Project Name", required: true },
  { value: "location", label: "Location" },
  { value: "sector", label: "Sector" },
  { value: "project_stage", label: "Project Stage" },
  { value: "total_value", label: "Total Value (SAR)" },
  { value: "completion_pct", label: "Completion %" },
  { value: "signage_package_status", label: "Signage Package Status" },
  { value: "expected_boq_date", label: "Expected BOQ Date" },
  { value: "expected_signage_date", label: "Expected Signage Date" },
  { value: "notes", label: "Notes" },
  { value: "source", label: "Source" },
] as const;

export const BOQ_TARGET_COLUMNS = [
  { value: "title", label: "BOQ Title", required: true },
  { value: "opportunity_name", label: "Related Opportunity (name lookup)" },
  { value: "status", label: "Status" },
  { value: "estimated_value", label: "Estimated Value (SAR)" },
  { value: "assumptions", label: "Assumptions" },
  { value: "missing_items", label: "Missing Items" },
  { value: "notes", label: "Notes" },
  { value: "source", label: "Source" },
] as const;

export const RFQ_TARGET_COLUMNS = [
  { value: "rfq_number", label: "RFQ Number" },
  { value: "received_date", label: "Received Date" },
  { value: "opportunity_name", label: "Related Opportunity (name lookup)" },
  { value: "source_type", label: "Source Type" },
  { value: "response_due_date", label: "Response Due Date" },
  { value: "estimated_value", label: "Estimated Value (SAR)" },
  { value: "status", label: "Status" },
  { value: "notes", label: "Notes" },
] as const;

export const TENDER_TARGET_COLUMNS = [
  { value: "tender_name", label: "Tender Name", required: true },
  { value: "source", label: "Source" },
  { value: "tender_stage", label: "Stage" },
  { value: "tender_priority_classification", label: "Priority" },
  { value: "expected_award_date", label: "Expected Award Date" },
  { value: "estimated_project_value", label: "Estimated Value (SAR)" },
  { value: "signage_potential", label: "Signage Potential" },
  { value: "award_evidence", label: "Award Evidence" },
  { value: "next_follow_up_date", label: "Next Follow-up Date" },
  { value: "notes", label: "Notes" },
] as const;

export const FOLLOW_UP_TARGET_COLUMNS = [
  { value: "opportunity_name", label: "Related Opportunity (name lookup)", required: true },
  { value: "due_date", label: "Due Date", required: true },
  { value: "channel", label: "Channel" },
  { value: "cadence_tier", label: "Priority Tier (A/B/C)" },
  { value: "status", label: "Status" },
  { value: "last_contact_at", label: "Last Contact Date" },
  { value: "notes", label: "Notes" },
] as const;

export const QUOTATION_TARGET_COLUMNS = [
  { value: "quote_number", label: "Quote Number", required: true },
  { value: "opportunity_name", label: "Related Opportunity (name lookup)" },
  { value: "value", label: "Value (SAR)" },
  { value: "currency", label: "Currency" },
  { value: "status", label: "Status" },
  { value: "issued_date", label: "Issued Date" },
  { value: "valid_until", label: "Valid Until" },
  { value: "win_loss_reason", label: "Win/Loss Reason" },
  { value: "notes", label: "Notes" },
] as const;

// Sentinel: user explicitly routes a column to extra_data.
export const EXTRA_DATA_SENTINEL = "__extra_data__";

/** Returns CRM target columns for the given entity, always appending
 *  "Additional Data" and "Skip" options at the end. */
export function getTargetColumns(entity: ImportTargetEntity) {
  const base: { value: string; label: string; required?: boolean }[] =
    entity === "contacts"      ? [...CONTACT_TARGET_COLUMNS]      :
    entity === "leads"         ? [...LEAD_TARGET_COLUMNS]          :
    entity === "opportunities" ? [...OPPORTUNITY_TARGET_COLUMNS]   :
    entity === "projects"      ? [...PROJECT_TARGET_COLUMNS]       :
    entity === "boq"           ? [...BOQ_TARGET_COLUMNS]           :
    entity === "rfqs"          ? [...RFQ_TARGET_COLUMNS]           :
    entity === "tenders"       ? [...TENDER_TARGET_COLUMNS]        :
    entity === "follow_ups"    ? [...FOLLOW_UP_TARGET_COLUMNS]     :
    entity === "quotations"    ? [...QUOTATION_TARGET_COLUMNS]     :
                                 [...COMPANY_TARGET_COLUMNS];      // companies (default)
  return [
    ...base,
    { value: EXTRA_DATA_SENTINEL, label: "Additional Data (preserve in record)" },
    { value: "__skip__", label: "Skip this column" },
  ];
}

/** Run the data_cleanup AI agent on an import batch */
export async function runDataCleanup(batchId: string): Promise<{
  ok: boolean;
  corrections?: Array<{ row_id: string; field: string; original: string; corrected: string; reason: string }>;
  duplicates?: Array<{ row_ids: string[]; reason: string; duplicate_type: string; existing_id?: string }>;
  quality_score?: number;
  quality_summary?: string;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("ai-orchestrator", {
    body: { agent: "data_cleanup", entityType: "import_batches", entityId: batchId },
  });
  if (error || !data?.ok) return { ok: false, error: error?.message ?? data?.message ?? "AI unavailable" };
  return { ok: true, ...(data.result as object) };
}

export async function listSourceProfiles(): Promise<ImportSourceProfile[]> {
  const { data, error } = await db.from("import_source_profiles").select("*").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ImportSourceProfile[];
}

export async function listCandidates(batchId: string): Promise<ImportRecordCandidate[]> {
  const { data, error } = await db
    .from("import_record_candidates")
    .select("*")
    .eq("batch_id", batchId)
    .order("entity_type")
    .order("proposed_action");
  if (error) throw new Error(error.message);
  return (data ?? []) as ImportRecordCandidate[];
}

export async function updateCandidateReview(
  candidateId: string,
  review_status: "approved" | "rejected" | "needs_review",
  review_note?: string,
): Promise<void> {
  const { error } = await db
    .from("import_record_candidates")
    .update({ review_status, review_note: review_note ?? null, reviewed_at: new Date().toISOString() })
    .eq("id", candidateId);
  if (error) throw new Error(error.message);
}

/** Run the contact_mapping AI agent on an import batch */
export async function runContactMapping(batchId: string): Promise<{
  ok: boolean;
  classifications?: Array<{ row_id: string; entity_type: string; confidence: number; reason: string }>;
  contact_company_links?: Array<{ contact_row_id: string; company_row_id?: string; company_name: string; confidence: number; match_basis: string }>;
  suggested_splits?: Array<{ row_id: string; reason: string }>;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("ai-orchestrator", {
    body: { agent: "contact_mapping", entityType: "import_batches", entityId: batchId },
  });
  if (error || !data?.ok) return { ok: false, error: error?.message ?? data?.message ?? "AI unavailable" };
  return { ok: true, ...(data.result as object) };
}

// -- AI-assisted mapping suggestions ------------------------------------------

export type AiMappingSuggestion = {
  /** source column name from the uploaded file */
  sourceColumn: string;
  /** suggested CRM target column (may be EXTRA_DATA_SENTINEL if no match found) */
  suggestedTarget: string;
  /** 0–1 confidence from the AI model */
  confidence: number;
  /** whether the AI considers this a required / key field */
  isKey: boolean;
};

/**
 * Call the ai-orchestrator (old_data_classifier) on up to 3 sample rows from
 * the batch, then merge the proposed_field_mapping results into a single
 * consolidated suggestion list.
 *
 * Returns null if AI is unavailable or if the batch has no parsed rows yet.
 */
export async function suggestImportMappings(
  batchId: string,
): Promise<AiMappingSuggestion[] | null> {
  // Fetch up to 3 valid/pending rows to sample
  const { data: rows } = await db
    .from("import_rows")
    .select("id, raw_data")
    .eq("batch_id", batchId)
    .in("status", ["pending", "valid"])
    .limit(3);

  if (!rows || rows.length === 0) return null;

  // Call the orchestrator for each sample row in parallel
  const results = await Promise.allSettled(
    rows.map((row: { id: string }) =>
      supabase.functions.invoke("ai-orchestrator", {
        body: {
          agent: "old_data_classifier",
          entityType: "import_rows",
          entityId: row.id,
          input: { batch_id: batchId },
        },
      }),
    ),
  );

  // Merge proposed_field_mappings — use highest-confidence suggestion per column
  const best = new Map<string, { target: string; confidence: number; isKey: boolean }>();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { data } = result.value;
    if (!data?.ok || !data?.result?.proposed_field_mapping) continue;

    const mapping = data.result.proposed_field_mapping as Record<string, string>;
    const confidence: number = data.result.confidence ?? 0.5;
    const missingRequired: string[] = data.result.missing_required_fields ?? [];

    for (const [source, target] of Object.entries(mapping)) {
      const existing = best.get(source);
      if (!existing || confidence > existing.confidence) {
        const resolvedTarget = target || EXTRA_DATA_SENTINEL;
        best.set(source, {
          target: resolvedTarget,
          confidence,
          isKey: missingRequired.includes(source) === false && (
            resolvedTarget === "name" ||
            resolvedTarget === "project_name" ||
            resolvedTarget === "cr_number"
          ),
        });
      }
    }
  }

  if (best.size === 0) return null;

  // Convert to array; columns with no AI suggestion default to extra_data
  const { data: file } = await db
    .from("import_files")
    .select("column_names")
    .eq("batch_id", batchId)
    .limit(1)
    .single();

  const allColumns: string[] = file?.column_names ?? [];
  return allColumns.map((col: string) => {
    const suggestion = best.get(col);
    return {
      sourceColumn: col,
      suggestedTarget: suggestion?.target ?? EXTRA_DATA_SENTINEL,
      confidence: suggestion?.confidence ?? 0,
      isKey: suggestion?.isKey ?? false,
    };
  });
}

// =============================================================================
// AI agent helpers — Import Intelligence v2
// =============================================================================

/**
 * Call the ai-orchestrator for an import-scoped agent.
 * All import classification agents use entityType="import_batches".
 */
export async function callImportAgent(
  batchId: string,
  agent: string,
  input: Record<string, unknown> = {},
): Promise<AiAgentCallResult> {
  const { data, error } = await supabase.functions.invoke("ai-orchestrator", {
    body: {
      agent,
      entityType: "import_batches",
      entityId: batchId,
      input,
    },
  });

  if (error) {
    return { ok: false, code: "AI_UNKNOWN_ERROR", message: error.message, traceId: null };
  }

  return data as AiAgentCallResult;
}

/**
 * Fetch the most recent ai_agent_outputs row for a given batch + agent.
 * Returns null if the agent has not run yet.
 */
export async function getLatestAgentOutput(
  batchId: string,
  agent: string,
): Promise<AiAgentOutput | null> {
  const { data } = await db
    .from("ai_agent_outputs")
    .select("id, agent_key, entity_type, entity_id, output_type, status, result, created_at")
    .eq("entity_id", batchId)
    .eq("entity_type", "import_batches")
    .eq("agent_key", agent)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

/**
 * List all split proposals for a batch.
 */
export async function getSplitProposals(batchId: string): Promise<ImportSplitProposal[]> {
  const { data } = await db
    .from("import_split_proposals")
    .select("*")
    .eq("batch_id", batchId)
    .order("created_at");

  return (data ?? []) as ImportSplitProposal[];
}

/**
 * Update the review_status of a split proposal (accept or reject).
 */
export async function reviewSplitProposal(
  proposalId: string,
  status: "accepted" | "rejected",
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await db
    .from("import_split_proposals")
    .update({
      review_status: status,
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", proposalId);
  if (error) throw new Error(error.message);
}

/**
 * Stage entity_extractor AI output: parse the result and insert rows into
 * import_split_proposals. Idempotent — existing proposals for the same
 * ai_output_id are not re-inserted.
 */
export async function stageSplitProposals(
  batchId: string,
  aiOutputId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  splitProposals: Array<{ source_row_id: string; entities: Array<{ entity_type: string; proposed_payload: Record<string, unknown>; role: string }> }>,
): Promise<void> {
  // Check for existing proposals from this output to keep idempotency.
  const { count } = await db
    .from("import_split_proposals")
    .select("*", { count: "exact", head: true })
    .eq("ai_output_id", aiOutputId);

  if ((count ?? 0) > 0) return; // already staged

  const rows = splitProposals.flatMap((sp) =>
    sp.entities.map((e) => ({
      batch_id: batchId,
      source_row_id: sp.source_row_id,
      entity_type: e.entity_type,
      proposed_payload: e.proposed_payload,
      role: e.role,
      ai_output_id: aiOutputId,
      review_status: "pending",
    })),
  );

  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += 100) {
    await db.from("import_split_proposals").insert(rows.slice(i, i + 100));
  }
}

/**
 * Promote an accepted split proposal into a real import_row so it flows
 * through the rest of the pipeline (validate → commit).
 */
export async function acceptSplitProposalToRow(
  proposal: ImportSplitProposal,
  batchId: string,
  nextRowNumber: number,
): Promise<void> {
  await db.from("import_rows").insert({
    batch_id: batchId,
    file_id: null, // AI-generated row, not from file
    row_number: nextRowNumber,
    raw_data: proposal.proposed_payload,
    mapped_data: proposal.proposed_payload,
    status: "valid",
    row_status: "ai_split",
  });
}

