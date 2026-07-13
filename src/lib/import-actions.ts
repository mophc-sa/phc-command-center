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

// Import tables are not in the auto-generated Supabase types yet.
// Use this untyped accessor until types are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

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
  | "companies" | "contacts" | "leads" | "opportunities" | "projects" | "boq";

export const TARGET_ENTITIES: { value: ImportTargetEntity; label: string }[] = [
  { value: "companies",     label: "Companies" },
  { value: "contacts",      label: "Contacts" },
  { value: "leads",         label: "Leads" },
  { value: "opportunities", label: "Opportunities" },
  { value: "projects",      label: "Projects" },
  { value: "boq",           label: "BOQ / Estimates" },
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
  row_status: "active" | "edited" | "excluded" | "deleted";
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
  { value: "relationship_level", label: "Relationship Level" },
  { value: "internal_notes", label: "Internal Notes" },
  { value: "source", label: "Source" },
] as const;

