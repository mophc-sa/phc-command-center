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

// Import tables are not in the auto-generated Supabase types yet.
// Use this untyped accessor until types are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const IMPORT_CAPABLE_ROLES = [
  "system_admin", "managing_director", "general_manager", "ceo", "sales_manager",
] as const;

export const APPROVE_COMMIT_ROLES = [
  "managing_director", "general_manager", "ceo", "sales_manager",
] as const;

export const UPLOAD_ROLES = [
  ...IMPORT_CAPABLE_ROLES, "bd_manager",
] as const;

export const BLOCKED_ROLES = ["salesperson", "viewer"] as const;

export type ImportBatchStatus =
  | "uploading" | "parsing" | "mapping" | "validating" | "duplicate_review"
  | "pending_approval" | "approved" | "dry_run" | "committed" | "failed" | "cancelled";

export type ImportBatch = {
  id: string;
  created_by: string;
  status: ImportBatchStatus;
  source_type: string;
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
  created_at: string;
  updated_at: string;
};

// -- Batch CRUD ----------------------------------------------------------------

export async function createBatch(): Promise<ImportBatch> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await db.from("import_batches").insert({
    created_by: user.id,
    status: "uploading",
    dry_run: true,
    ai_suggestions_enabled: false,
  }).select().single();

  if (error) throw new Error(error.message);
  return data as ImportBatch;
}

export async function listBatches(): Promise<ImportBatch[]> {
  const { data, error } = await db
    .from("import_batches")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ImportBatch[];
}

export async function getBatch(id: string): Promise<ImportBatch | null> {
  const { data, error } = await db
    .from("import_batches")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return data as ImportBatch;
}

export async function cancelBatch(id: string): Promise<void> {
  const { error } = await db
    .from("import_batches")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (error) throw new Error(error.message);
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

export async function downloadReport(
  batchId: string,
  reportType: "validation_errors" | "duplicate_candidates" | "import_summary",
) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await supabase.functions.invoke("import-pipeline", {
    body: { action: "generate_report", batch_id: batchId, report_type: reportType },
  });

  if (res.error) throw new Error(String(res.error));

  // Create download
  const blob = new Blob([res.data as string], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${reportType}_${batchId.slice(0, 8)}.csv`;
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
