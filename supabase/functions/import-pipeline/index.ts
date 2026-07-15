// =============================================================================
// Data Import Center — Edge Function
//
// Server-side pipeline: parse → validate → detect duplicates → approve → dry-run
// commit → generate reports.
//
// Role enforcement:
//   system_admin: upload, parse, map, validate, troubleshoot, view, download
//                 CANNOT approve or commit (403)
//   managing_director, general_manager, sales_manager, ceo: full access
//   bd_manager: own batches only, no approve/commit
//   salesperson, viewer: blocked (403)
//
// Dry-run safety: enabled by default. No production writes unless explicitly
// approved and committed by an authorized role.
// =============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { json, err } from "../_shared/respond.ts";
import {
  resolveCaller,
  serviceClient,
  hasAny,
  audit,
  type AppRole,
} from "../_shared/supabase.ts";
import { compareSignals, type DedupSignals } from "../_shared/import-dedup.ts";

// Coerce a mapped_data value to a non-empty string or null (tries keys left-to-right).
function mv(m: Record<string, unknown> | null, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = m?.[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

// -- Commit helpers ------------------------------------------------------------

type CommitResult = { action: "created" | "updated"; recordId: string } | { action: "skipped"; recordId: null; error: string };

// Known CRM columns per entity. Any mapped_data key NOT in this set (and not
// a sentinel value) is stored in extra_data instead of being discarded.
const KNOWN_COMPANY_KEYS = new Set([
  "name","company_name","company_type","cr_number","website","website_domain",
  "regions","relationship_level","internal_notes","source","created_by",
]);
const KNOWN_CONTACT_KEYS = new Set([
  "name","contact_name","title","job_title","phone","contact_phone","email",
  "source","created_by",
]);
const KNOWN_LEAD_KEYS = new Set([
  "project_name","location","main_contractor","main_contractor_guess",
  "source","created_by",
]);
const KNOWN_OPPORTUNITY_KEYS = new Set([
  "project_name","client","main_contractor","location","sector",
  "estimated_value_min","estimated_value_max","quotation_value",
  "stage","next_action","next_action_due","notes","source","created_by",
]);
const KNOWN_PROJECT_KEYS = new Set([
  "name","location","sector","project_stage","total_value","completion_pct",
  "signage_package_status","expected_boq_date","expected_signage_date",
  "notes","source","created_by",
]);

// User-facing sentinels written into mapped_data by the validate step.
const SKIP_KEY = "__skip__";

// Collect unknown mapped_data keys into an extra_data object.
// Keys that match SKIP_KEY or known CRM columns are excluded.
// Keys prefixed "__extra::" were explicitly mapped to "Additional Data" by
// the user; strip the prefix to recover the original source column name.
function collectExtraData(
  m: Record<string, unknown> | null,
  knownKeys: Set<string>,
): Record<string, unknown> | null {
  if (!m) return null;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (k === SKIP_KEY || knownKeys.has(k)) continue;
    if (v == null || String(v).trim() === "") continue;
    const label = k.startsWith("__extra::") ? k.slice(9) : k;
    extra[label] = String(v).trim();
  }
  return Object.keys(extra).length > 0 ? extra : null;
}

// deno-lint-ignore no-explicit-any
async function commitCompany(svc: any, row: { id: string; mapped_data: Record<string, unknown> | null }, actorId: string): Promise<CommitResult> {
  const m = row.mapped_data;
  const name = mv(m, "name", "company_name");
  if (!name) return { action: "skipped", recordId: null, error: "Missing required field: name" };

  const crNumber = mv(m, "cr_number");
  const patch: Record<string, unknown> = { name, created_by: actorId };
  const ct = mv(m, "company_type"); if (ct) patch.company_type = ct;
  if (crNumber) patch.cr_number = crNumber;
  const wd = mv(m, "website_domain", "website"); if (wd) patch.website_domain = wd;
  const reg = mv(m, "regions"); if (reg) patch.regions = [reg];
  const rl = mv(m, "relationship_level"); if (rl) patch.relationship_level = rl;
  const notes = mv(m, "internal_notes"); if (notes) patch.internal_notes = notes;
  const src = mv(m, "source"); if (src) patch.source = src;
  const extra = collectExtraData(m, KNOWN_COMPANY_KEYS);
  if (extra) patch.extra_data = extra;

  if (crNumber) {
    const { data, error } = await svc.from("companies")
      .upsert({ ...patch, cr_number: crNumber }, { onConflict: "cr_number" })
      .select("id").single();
    if (error) return { action: "skipped", recordId: null, error: error.message };
    return { action: "created", recordId: data.id };
  }

  const { data: existing } = await svc.from("companies").select("id").eq("name", name).maybeSingle();
  if (existing) {
    const { error } = await svc.from("companies")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", existing.id);
    if (error) return { action: "skipped", recordId: null, error: error.message };
    return { action: "updated", recordId: existing.id };
  }

  const { data: created, error } = await svc.from("companies").insert(patch).select("id").single();
  if (error) return { action: "skipped", recordId: null, error: error.message };
  return { action: "created", recordId: created.id };
}

// deno-lint-ignore no-explicit-any
async function commitContact(svc: any, row: { id: string; mapped_data: Record<string, unknown> | null }, actorId: string): Promise<CommitResult> {
  const m = row.mapped_data;
  const name = mv(m, "name", "contact_name");
  if (!name) return { action: "skipped", recordId: null, error: "Missing required field: name" };

  const patch: Record<string, unknown> = { name, created_by: actorId };
  const title = mv(m, "title", "job_title"); if (title) patch.title = title;
  const phone = mv(m, "phone", "contact_phone"); if (phone) patch.phone = phone;
  const email = mv(m, "email"); if (email) patch.email = email;
  const src = mv(m, "source"); if (src) patch.source = src;
  const extra = collectExtraData(m, KNOWN_CONTACT_KEYS);
  if (extra) patch.extra_data = extra;

  const { data: created, error } = await svc.from("contacts").insert(patch).select("id").single();
  if (error) return { action: "skipped", recordId: null, error: error.message };
  return { action: "created", recordId: created.id };
}

// deno-lint-ignore no-explicit-any
async function commitLead(svc: any, row: { id: string; mapped_data: Record<string, unknown> | null }, actorId: string): Promise<CommitResult> {
  const m = row.mapped_data;
  const project_name = mv(m, "project_name");
  if (!project_name) return { action: "skipped", recordId: null, error: "Missing required field: project_name" };

  const patch: Record<string, unknown> = { project_name, created_by: actorId };
  const loc = mv(m, "location"); if (loc) patch.location = loc;
  const contractor = mv(m, "main_contractor", "main_contractor_guess"); if (contractor) patch.main_contractor_guess = contractor;
  const src = mv(m, "source"); if (src) patch.source = src;
  const extra = collectExtraData(m, KNOWN_LEAD_KEYS);
  if (extra) patch.extra_data = extra;

  const { data: created, error } = await svc.from("leads").insert(patch).select("id").single();
  if (error) return { action: "skipped", recordId: null, error: error.message };
  return { action: "created", recordId: created.id };
}

// deno-lint-ignore no-explicit-any
async function commitOpportunity(svc: any, row: { id: string; mapped_data: Record<string, unknown> | null }, actorId: string): Promise<CommitResult> {
  const m = row.mapped_data;
  const project_name = mv(m, "project_name");
  if (!project_name) return { action: "skipped", recordId: null, error: "Missing required field: project_name" };

  const patch: Record<string, unknown> = { project_name, created_by: actorId };
  const client = mv(m, "client"); if (client) patch.client = client;
  const location = mv(m, "location"); if (location) patch.location = location;
  const sector = mv(m, "sector"); if (sector) patch.sector = sector;
  const stage = mv(m, "stage"); if (stage) patch.stage = stage;
  const qv = mv(m, "quotation_value"); if (qv) patch.quotation_value = parseFloat(qv) || null;
  const evMin = mv(m, "estimated_value_min"); if (evMin) patch.estimated_value_min = parseFloat(evMin) || null;
  const evMax = mv(m, "estimated_value_max"); if (evMax) patch.estimated_value_max = parseFloat(evMax) || null;
  const nextAction = mv(m, "next_action"); if (nextAction) patch.next_action = nextAction;
  const naDue = mv(m, "next_action_due"); if (naDue) patch.next_action_due = naDue;
  const src = mv(m, "source"); if (src) patch.source = src;
  const notes = mv(m, "notes"); if (notes) patch.notes = notes;
  const extra = collectExtraData(m, KNOWN_OPPORTUNITY_KEYS);
  if (extra) patch.extra_data = extra;

  const { data: created, error } = await svc.from("opportunities").insert(patch).select("id").single();
  if (error) return { action: "skipped", recordId: null, error: error.message };
  return { action: "created", recordId: created.id };
}

// deno-lint-ignore no-explicit-any
async function commitProject(svc: any, row: { id: string; mapped_data: Record<string, unknown> | null }, actorId: string): Promise<CommitResult> {
  const m = row.mapped_data;
  const name = mv(m, "name", "project_name");
  if (!name) return { action: "skipped", recordId: null, error: "Missing required field: name" };

  const patch: Record<string, unknown> = { name, created_by: actorId };
  const location = mv(m, "location"); if (location) patch.location = location;
  const sector = mv(m, "sector"); if (sector) patch.sector = sector;
  const stage = mv(m, "project_stage"); if (stage) patch.project_stage = stage;
  const tv = mv(m, "total_value"); if (tv) patch.total_value = parseFloat(tv) || null;
  const pct = mv(m, "completion_pct"); if (pct) patch.completion_pct = parseFloat(pct) || null;
  const sps = mv(m, "signage_package_status"); if (sps) patch.signage_package_status = sps;
  const src = mv(m, "source"); if (src) patch.source = src;
  const notes = mv(m, "notes"); if (notes) patch.notes = notes;
  const extra = collectExtraData(m, KNOWN_PROJECT_KEYS);
  if (extra) patch.extra_data = extra;

  const { data: created, error } = await svc.from("projects").insert(patch).select("id").single();
  if (error) return { action: "skipped", recordId: null, error: error.message };
  return { action: "created", recordId: created.id };
}

// Build the dedup signal set from a row's mapped data (best-effort field names).
function signalsFromMapped(m: Record<string, string | null> | null): DedupSignals {
  const g = (k: string) => (m?.[k] ?? null) as string | null;
  return {
    company_name: g("name") ?? g("company_name"),
    cr_number: g("cr_number"),
    website_domain: g("website_domain") ?? g("website"),
    email: g("email"),
    phone: g("phone") ?? g("contact_phone"),
    project_name: g("project_name"),
    main_contractor: g("main_contractor"),
    tender_ref: g("tender_ref") ?? g("rfq_number") ?? g("tender_number"),
  };
}

// -- Role groups ---------------------------------------------------------------
const IMPORT_ROLES: AppRole[] = [
  "system_admin", "managing_director", "general_manager", "ceo", "sales_manager",
];
const APPROVE_COMMIT_ROLES: AppRole[] = [
  "managing_director", "general_manager", "ceo", "sales_manager",
];
const BD_ROLE: AppRole = "bd_manager";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS = 10_000;

// -- CSV parser (no external deps) --------------------------------------------
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (line: string) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

function uniqueSourceColumns(headers: string[]): string[] {
  const seen = new Map<string, number>();

  return headers.map((header, idx) => {
    const base = String(header ?? "").trim() || `column_${idx + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

// -- Handlers ------------------------------------------------------------------

type Handler = (
  payload: Record<string, unknown>,
  caller: { userId: string; roles: AppRole[] },
) => Promise<Response>;

const handlers: Record<string, Handler> = {};

// PARSE: read uploaded file, extract headers + preview rows
handlers["parse"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  const fileId = payload.file_id as string;
  if (!batchId || !fileId) return err("batch_id and file_id required");

  const svc = serviceClient();

  // Verify batch ownership for bd_manager
  if (hasAny(caller.roles, [BD_ROLE]) && !hasAny(caller.roles, IMPORT_ROLES)) {
    const { data: batch } = await svc.from("import_batches").select("created_by").eq("id", batchId).single();
    if (!batch || batch.created_by !== caller.userId) return err("Access denied", 403);
  }

  // Get file metadata
  const { data: file } = await svc.from("import_files").select("*").eq("id", fileId).single();
  if (!file) return err("File not found", 404);

  if (file.file_size_bytes > MAX_FILE_SIZE) return err(`File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit`);

  // Download file from storage
  const { data: fileData, error: dlError } = await svc.storage
    .from("imports")
    .download(file.storage_path);
  if (dlError || !fileData) return err("Failed to download file: " + (dlError?.message ?? "unknown"));

  let headers: string[] = [];
  let rows: string[][] = [];
  let sheetCount = 1;

  if (file.file_type === "csv") {
    const text = await fileData.text();
    const parsed = parseCsv(text);
    headers = parsed.headers;
    rows = parsed.rows;
  } else if (file.file_type === "xlsx") {
    // For xlsx, use the npm SheetJS build supported by the edge runtime.
    try {
      const { read, utils } = await import("npm:xlsx@0.18.5");
      const ab = await fileData.arrayBuffer();
      const wb = read(new Uint8Array(ab), { type: "array" });
      sheetCount = wb.SheetNames.length;

      // If sheet_name is specified, parse that sheet only. Otherwise parse the
      // first sheet (or all sheets concatenated if multiple exist and no name).
      const sheetNames: string[] = file.sheet_name
        ? [file.sheet_name]
        : wb.SheetNames.slice(0, 1); // default to first sheet for now

      for (const sn of sheetNames) {
        const ws = wb.Sheets[sn];
        if (!ws) return err(`Sheet "${sn}" not found in workbook. Available sheets: ${wb.SheetNames.join(", ")}`);
        const jsonData: string[][] = utils.sheet_to_json(ws, { header: 1, raw: false });
        if (jsonData.length === 0) continue;

        const sheetHeaders = jsonData[0].map(String);
        const sheetRows = jsonData.slice(1).filter((r) =>
          // Skip rows where every cell is empty (merged title rows)
          r.some((v) => v != null && String(v).trim() !== "")
        );

        if (headers.length === 0) {
          // First sheet sets the column schema
          headers = sheetHeaders;
          rows = sheetRows;
        } else {
          // Additional sheets: only append rows if headers match
          const compatible = sheetHeaders.length === headers.length &&
            sheetHeaders.every((h, i) => h === headers[i]);
          if (compatible) {
            rows = [...rows, ...sheetRows];
          }
          // Silently skip incompatible sheets — they'll be handled in a future PR
          // with full multi-entity fan-out support.
        }
      }
    } catch (e) {
      return err("Failed to parse xlsx: " + (e instanceof Error ? e.message : String(e)));
    }
  } else {
    return err("Unsupported file type: " + file.file_type);
  }

  if (rows.length > MAX_ROWS) {
    return err(`File has ${rows.length} data rows, exceeding the ${MAX_ROWS} row limit`);
  }

  headers = uniqueSourceColumns(headers);

  // Update file with column names, row count, and sheet count (xlsx only).
  // sheet_count is used by the UI to enable the sheet_classifier AI button.
  await svc.from("import_files").update({
    column_names: headers,
    row_count: rows.length,
    sheet_count: sheetCount,
  }).eq("id", fileId);

  // Insert parsed rows into import_rows
  const rowInserts = rows.map((row, idx) => ({
    batch_id: batchId,
    file_id: fileId,
    row_number: idx + 1,
    raw_data: Object.fromEntries(headers.map((h, i) => [h, row[i] ?? null])),
    status: "pending",
  }));

  // Insert in chunks of 500
  for (let i = 0; i < rowInserts.length; i += 500) {
    const chunk = rowInserts.slice(i, i + 500);
    await svc.from("import_rows").insert(chunk);
  }

  // Update batch status and row count
  await svc.from("import_batches").update({
    status: "mapping",
    total_rows: rows.length,
  }).eq("id", batchId);

  await audit(svc, caller.userId, "import_parse", "import_batches", batchId, {
    file_id: fileId,
    row_count: rows.length,
    column_count: headers.length,
  });

  // Return preview (first 20 rows only — no full data to client)
  return json({
    headers,
    row_count: rows.length,
    preview: rows.slice(0, 20).map((row) =>
      Object.fromEntries(headers.map((h, i) => [h, row[i] ?? null]))
    ),
  });
};

// VALIDATE: run deterministic validation rules on mapped data
handlers["validate"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  if (!batchId) return err("batch_id required");

  const svc = serviceClient();

  // Get mappings
  const { data: mappings } = await svc.from("import_mappings").select("*").eq("batch_id", batchId);
  if (!mappings || mappings.length === 0) return err("No mappings configured");

  // Get rows — skip excluded/deleted rows from validation
  const { data: rows } = await svc.from("import_rows")
    .select("id, row_number, raw_data, is_excluded, row_status")
    .eq("batch_id", batchId)
    .order("row_number");
  if (!rows) return err("No rows found");

  // Clear old validation errors so re-validate produces a clean report
  await svc.from("import_errors").delete().eq("batch_id", batchId);

  const errors: Array<{
    batch_id: string; row_id: string; row_number: number;
    column_name: string; error_type: string; message: string; severity: string;
  }> = [];
  let validCount = 0;
  let errorCount = 0;
  let excludedCount = 0;

  for (const row of rows) {
    // Skip rows the user has excluded or soft-deleted from the batch
    if (row.is_excluded || row.row_status === "excluded" || row.row_status === "deleted") {
      await svc.from("import_rows").update({ status: "excluded" }).eq("id", row.id);
      excludedCount++;
      continue;
    }

    const raw = row.raw_data as Record<string, unknown>;
    const mapped: Record<string, unknown> = {};
    let rowHasError = false;

    for (const m of mappings) {
      const value = raw[m.source_column];
      const strVal = value != null ? String(value).trim() : "";

      // __skip__ → user explicitly excluded this column; omit from mapped_data.
      if (m.target_column === SKIP_KEY) continue;

      // __extra_data__ → user wants this column stored in extra_data.
      // Write it under "__extra::{source_column}" so that collectExtraData()
      // can recover the original column name without key collisions.
      if (m.target_column === "__extra_data__") {
        mapped[`__extra::${m.source_column}`] = strVal || null;
        continue;
      }

      // Required check for key fields
      if (m.is_key && !strVal) {
        errors.push({
          batch_id: batchId, row_id: row.id, row_number: row.row_number,
          column_name: m.source_column, error_type: "required",
          message: `Required field "${m.target_column}" is empty`, severity: "error",
        });
        rowHasError = true;
      }

      // Length check
      if (strVal.length > 1000) {
        errors.push({
          batch_id: batchId, row_id: row.id, row_number: row.row_number,
          column_name: m.source_column, error_type: "length",
          message: `Value exceeds 1000 character limit`, severity: "error",
        });
        rowHasError = true;
      }

      mapped[m.target_column] = strVal || null;
    }

    // Update row with mapped data and status
    await svc.from("import_rows").update({
      mapped_data: mapped,
      status: rowHasError ? "error" : "valid",
    }).eq("id", row.id);

    if (rowHasError) errorCount++;
    else validCount++;
  }

  // Insert errors in chunks
  if (errors.length > 0) {
    for (let i = 0; i < errors.length; i += 500) {
      await svc.from("import_errors").insert(errors.slice(i, i + 500));
    }
  }

  // Update batch
  await svc.from("import_batches").update({
    status: "duplicate_review",
    valid_rows: validCount,
    error_rows: errorCount,
  }).eq("id", batchId);

  await audit(svc, caller.userId, "import_validate", "import_batches", batchId, {
    valid: validCount, errors: errorCount, excluded: excludedCount,
  });

  return json({ valid_rows: validCount, error_rows: errorCount, excluded_rows: excludedCount, total_errors: errors.length });
};


// DETECT_DUPLICATES: match each staged row against (1) existing CRM records,
// (2) other rows within the same file, and (3) rows from previous import
// batches. Every candidate carries a reason code, matched fields, confidence,
// and a suggested action. This is staging only — nothing is merged or written
// to live CRM tables.
type DupeInsert = {
  batch_id: string; row_id: string; existing_record_id: string; existing_table: string;
  match_type: string; confidence: number; resolution: string;
  match_scope: string; reason_code: string; matched_fields: string[]; suggested_action: string;
};

handlers["detect_duplicates"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  if (!batchId) return err("batch_id required");

  const svc = serviceClient();

  const { data: batch } = await svc.from("import_batches")
    .select("id, target_entity").eq("id", batchId).single();

  // Only rows that are still in play (valid, not excluded/deleted).
  const { data: rows } = await svc.from("import_rows")
    .select("id, row_number, mapped_data, is_excluded, row_status")
    .eq("batch_id", batchId)
    .eq("status", "valid")
    .order("row_number");
  if (!rows || rows.length === 0) return json({ duplicates: 0 });
  const liveRows = rows.filter((r) => !r.is_excluded && r.row_status !== "deleted" && r.row_status !== "excluded");

  // (1) Existing CRM records (companies today; other entities as they gain
  //     matchable fields). Read-only.
  const { data: companies } = await svc.from("companies")
    .select("id, name, cr_number, website_domain, email, phone");
  const crmSignals = (companies ?? []).map((c) => ({
    id: c.id as string,
    signals: {
      company_name: c.name, cr_number: c.cr_number, website_domain: c.website_domain,
      email: (c as { email?: string }).email ?? null, phone: (c as { phone?: string }).phone ?? null,
    } as DedupSignals,
  }));

  // (3) Rows from PREVIOUS batches (same target entity), read-only staging.
  const { data: prevRows } = await svc.from("import_rows")
    .select("id, mapped_data, batch_id")
    .neq("batch_id", batchId)
    .neq("row_status", "deleted")
    .limit(5000);
  const prevSignals = (prevRows ?? []).map((r) => ({
    id: r.id as string, signals: signalsFromMapped(r.mapped_data as Record<string, string | null> | null),
  }));

  const dupes: DupeInsert[] = [];
  const flaggedRowIds = new Set<string>();
  const seenInFile: { id: string; signals: DedupSignals }[] = [];

  const record = (rowId: string, existingId: string, table: string, scope: string, hit: NonNullable<ReturnType<typeof compareSignals>>) => {
    dupes.push({
      batch_id: batchId, row_id: rowId, existing_record_id: existingId, existing_table: table,
      match_type: hit.match_type, confidence: Math.round(hit.confidence * 100), resolution: "pending",
      match_scope: scope, reason_code: hit.reason_code, matched_fields: hit.matched_fields,
      suggested_action: hit.suggested_action,
    });
    flaggedRowIds.add(rowId);
  };

  for (const row of liveRows) {
    const signals = signalsFromMapped(row.mapped_data as Record<string, string | null> | null);

    // (1) existing CRM
    for (const c of crmSignals) {
      const hit = compareSignals(signals, c.signals);
      if (hit) { record(row.id, c.id, batch?.target_entity ?? "companies", "existing_crm", hit); break; }
    }
    // (2) within this file (rows already scanned)
    for (const prev of seenInFile) {
      const hit = compareSignals(signals, prev.signals);
      if (hit) { record(row.id, prev.id, "import_rows", "within_file", hit); break; }
    }
    // (3) previous batches
    for (const p of prevSignals) {
      const hit = compareSignals(signals, p.signals);
      if (hit) { record(row.id, p.id, "import_rows", "previous_batch", hit); break; }
    }

    seenInFile.push({ id: row.id, signals });
  }

  for (const id of flaggedRowIds) {
    await svc.from("import_rows").update({ status: "duplicate" }).eq("id", id);
  }
  for (let i = 0; i < dupes.length; i += 500) {
    if (dupes.length) await svc.from("import_duplicate_candidates").insert(dupes.slice(i, i + 500));
  }

  await svc.from("import_batches").update({
    status: "pending_approval",
    duplicate_rows: flaggedRowIds.size,
  }).eq("id", batchId);

  await audit(svc, caller.userId, "import_detect_duplicates", "import_batches", batchId, {
    duplicate_rows: flaggedRowIds.size, candidates: dupes.length,
  });

  return json({ duplicates: flaggedRowIds.size, candidates: dupes.length });
};

// APPROVE: manager approves the batch for dry-run commit
handlers["approve"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  if (!batchId) return err("batch_id required");

  // system_admin explicitly blocked from approve
  if (hasAny(caller.roles, ["system_admin" as AppRole]) && !hasAny(caller.roles, APPROVE_COMMIT_ROLES)) {
    return err("system_admin cannot approve imports", 403);
  }
  if (!hasAny(caller.roles, APPROVE_COMMIT_ROLES)) {
    return err("Insufficient role for approval", 403);
  }

  const svc = serviceClient();

  const { data: batch } = await svc.from("import_batches").select("status").eq("id", batchId).single();
  if (!batch) return err("Batch not found", 404);
  if (batch.status !== "pending_approval") return err("Batch not in pending_approval status");

  await svc.from("import_batches").update({
    status: "approved",
    approved_by: caller.userId,
    approved_at: new Date().toISOString(),
  }).eq("id", batchId);

  await svc.from("import_approval_queue").insert({
    batch_id: batchId,
    requested_by: caller.userId,
    action: "approve",
    decided_by: caller.userId,
    decided_at: new Date().toISOString(),
    decision: "approved",
  });

  await audit(svc, caller.userId, "import_approve", "import_batches", batchId);

  return json({ status: "approved" });
};

// DRY_RUN_COMMIT: simulate production commit without writing to CRM tables
handlers["dry_run_commit"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  if (!batchId) return err("batch_id required");

  // system_admin explicitly blocked from commit
  if (hasAny(caller.roles, ["system_admin" as AppRole]) && !hasAny(caller.roles, APPROVE_COMMIT_ROLES)) {
    return err("system_admin cannot commit imports", 403);
  }
  if (!hasAny(caller.roles, APPROVE_COMMIT_ROLES)) {
    return err("Insufficient role for commit", 403);
  }

  const svc = serviceClient();

  const { data: batch } = await svc.from("import_batches").select("*").eq("id", batchId).single();
  if (!batch) return err("Batch not found", 404);
  if (batch.status !== "approved") return err("Batch must be approved before commit");

  // Dry-run: mark batch as dry_run, simulate row processing
  const { data: validRows } = await svc.from("import_rows")
    .select("id, mapped_data")
    .eq("batch_id", batchId)
    .eq("status", "valid")
    .order("row_number");

  const summary = {
    total: batch.total_rows,
    would_create: validRows?.length ?? 0,
    would_skip_duplicates: batch.duplicate_rows,
    would_skip_errors: batch.error_rows,
    dry_run: true,
  };

  await svc.from("import_batches").update({
    status: "dry_run",
    dry_run: true,
  }).eq("id", batchId);

  await audit(svc, caller.userId, "import_dry_run", "import_batches", batchId, summary);

  return json(summary);
};

// COMMIT: write valid rows to live CRM tables
handlers["commit"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  if (!batchId) return err("batch_id required");

  // system_admin explicitly blocked
  if (hasAny(caller.roles, ["system_admin" as AppRole]) && !hasAny(caller.roles, APPROVE_COMMIT_ROLES)) {
    return err("system_admin cannot commit imports", 403);
  }
  if (!hasAny(caller.roles, APPROVE_COMMIT_ROLES)) {
    return err("Insufficient role for commit", 403);
  }

  const svc = serviceClient();

  const { data: batch } = await svc.from("import_batches").select("*").eq("id", batchId).single();
  if (!batch) return err("Batch not found", 404);
  if (batch.status !== "dry_run") return err("Batch must be in dry_run status before commit");

  // Readiness guard: all manual checklist items must be true
  const MANUAL_KEYS = [
    "file_source_confirmed", "owner_confirmed", "backup_completed", "no_unnecessary_sensitive_data",
  ];
  const checklist = (batch.readiness_checklist ?? {}) as Record<string, boolean>;
  const incomplete = MANUAL_KEYS.filter((k) => !checklist[k]);
  if (incomplete.length > 0) {
    return err(`Readiness checklist incomplete. Unchecked items: ${incomplete.join(", ")}`);
  }

  const entity = batch.target_entity as string;
  const SUPPORTED = ["companies", "contacts", "leads", "opportunities", "projects"];

  const { data: rows } = await svc
    .from("import_rows")
    .select("id, mapped_data, row_number")
    .eq("batch_id", batchId)
    .eq("status", "valid")
    .order("row_number");

  const eligibleRows = (rows ?? []) as { id: string; mapped_data: Record<string, unknown> | null; row_number: number }[];
  let committed = 0;
  let failed = 0;
  const links: Array<{ batch_id: string; row_id: string; target_table: string; target_id: string; action: string }> = [];
  const commitErrors: Array<{
    batch_id: string; row_id: string; row_number: number;
    column_name: string; error_type: string; message: string; severity: string;
  }> = [];

  for (const row of eligibleRows) {
    if (!SUPPORTED.includes(entity)) {
      commitErrors.push({
        batch_id: batchId, row_id: row.id, row_number: row.row_number,
        column_name: "*", error_type: "commit_unsupported",
        message: `Entity '${entity}' is not yet supported for commit. Supported: companies, contacts, leads`,
        severity: "error",
      });
      await svc.from("import_rows").update({ status: "failed" }).eq("id", row.id);
      failed++;
      continue;
    }

    let result: CommitResult;
    try {
      if (entity === "companies") result = await commitCompany(svc, row, caller.userId);
      else if (entity === "contacts") result = await commitContact(svc, row, caller.userId);
      else if (entity === "opportunities") result = await commitOpportunity(svc, row, caller.userId);
      else if (entity === "projects") result = await commitProject(svc, row, caller.userId);
      else result = await commitLead(svc, row, caller.userId);
    } catch (e) {
      result = { action: "skipped", recordId: null, error: e instanceof Error ? e.message : String(e) };
    }

    if (result.action === "skipped") {
      commitErrors.push({
        batch_id: batchId, row_id: row.id, row_number: row.row_number,
        column_name: "*", error_type: "commit_error",
        message: result.error,
        severity: "error",
      });
      await svc.from("import_rows").update({ status: "failed" }).eq("id", row.id);
      failed++;
    } else {
      await svc.from("import_rows").update({ status: "committed" }).eq("id", row.id);
      links.push({
        batch_id: batchId, row_id: row.id,
        target_table: entity, target_id: result.recordId, action: result.action,
      });
      committed++;
    }
  }

  // Flush commit errors
  for (let i = 0; i < commitErrors.length; i += 500) {
    await svc.from("import_errors").insert(commitErrors.slice(i, i + 500));
  }

  // Flush record links
  for (let i = 0; i < links.length; i += 500) {
    await svc.from("import_record_links").insert(links.slice(i, i + 500));
  }

  // Mark batch committed
  await svc.from("import_batches").update({
    status: "committed",
    committed_at: new Date().toISOString(),
  }).eq("id", batchId);

  await audit(svc, caller.userId, "import_commit", "import_batches", batchId, {
    entity, committed, failed, total: eligibleRows.length,
  }, caller.roles);

  return json({ committed, failed, total: eligibleRows.length });
};

// GENERATE_REPORT: downloadable dry-run reports in CSV (default) or JSON.
handlers["generate_report"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  const reportType = payload.report_type as string;
  const format = (payload.format as string) === "json" ? "json" : "csv";
  if (!batchId || !reportType) return err("batch_id and report_type required");

  const svc = serviceClient();

  let columns: string[] = [];
  let records: Record<string, unknown>[] = [];

  if (reportType === "validation_errors") {
    const { data } = await svc.from("import_errors")
      .select("row_number, column_name, error_type, message, severity")
      .eq("batch_id", batchId).order("row_number");
    columns = ["row_number", "column_name", "error_type", "message", "severity"];
    records = (data ?? []) as Record<string, unknown>[];
  } else if (reportType === "duplicate_candidates") {
    const { data } = await svc.from("import_duplicate_candidates")
      .select("row_id, existing_record_id, existing_table, match_scope, match_type, reason_code, matched_fields, confidence, suggested_action, resolution")
      .eq("batch_id", batchId);
    columns = ["row_id", "existing_record_id", "existing_table", "match_scope", "match_type", "reason_code", "matched_fields", "confidence", "suggested_action", "resolution"];
    records = (data ?? []) as Record<string, unknown>[];
  } else if (reportType === "import_summary") {
    const { data: batch } = await svc.from("import_batches").select("*").eq("id", batchId).single();
    if (!batch) return err("Batch not found", 404);
    columns = ["field", "value"];
    records = [
      ["batch_id", batch.id], ["status", batch.status], ["target_entity", batch.target_entity],
      ["total_rows", batch.total_rows], ["valid_rows", batch.valid_rows], ["error_rows", batch.error_rows],
      ["duplicate_rows", batch.duplicate_rows], ["dry_run", batch.dry_run],
      ["would_create_new", (batch.valid_rows ?? 0) - (batch.duplicate_rows ?? 0)],
      ["committed_at", batch.committed_at ?? null],
      ["created_at", batch.created_at], ["ai_suggestions_enabled", batch.ai_suggestions_enabled],
    ].map(([field, value]) => ({ field, value }));
  } else {
    return err("Invalid report_type. Use: validation_errors, duplicate_candidates, import_summary");
  }

  await audit(svc, caller.userId, "import_generate_report", "import_batches", batchId, { report_type: reportType, format });

  if (format === "json") {
    const body = JSON.stringify({ report_type: reportType, batch_id: batchId, generated_at: new Date().toISOString(), records }, null, 2);
    return new Response(body, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${reportType}_${batchId.slice(0, 8)}.json"` },
    });
  }

  const csvRows = [columns.join(",")];
  for (const rec of records) {
    csvRows.push(columns.map((c) => {
      const v = rec[c];
      return Array.isArray(v) ? quote(v.join("|")) : typeof v === "string" ? quote(v) : String(v ?? "");
    }).join(","));
  }
  return new Response(csvRows.join("\n"), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${reportType}_${batchId.slice(0, 8)}.csv"` },
  });
};

function quote(s: string | null | undefined): string {
  if (!s) return "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// PURGE_BATCH: permanently delete a batch (storage file + all import_* rows).
// system_admin ONLY. Callers are refused if the batch has any real committed
// links (import_record_links) — Phase 1.1 dry-run only, so this should be 0.
handlers["purge_batch"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  const confirm = payload.confirm as string;
  if (!batchId) return err("batch_id required");
  if (confirm !== "DELETE") return err("Confirmation token required ('DELETE')");

  if (!hasAny(caller.roles, ["system_admin" as AppRole])) {
    return err("Only system_admin can permanently purge an import batch", 403);
  }

  const svc = serviceClient();

  // Safety: refuse to purge batches with committed record links
  const { count: linkCount } = await svc
    .from("import_record_links")
    .select("*", { count: "exact", head: true })
    .eq("batch_id", batchId);
  if ((linkCount ?? 0) > 0) {
    return err(`Batch has ${linkCount} committed record link(s); purge blocked.`, 409);
  }

  // 1. Remove storage objects for this batch
  const { data: storageObjs } = await svc.storage.from("imports").list(batchId, { limit: 1000 });
  if (storageObjs && storageObjs.length > 0) {
    const paths = storageObjs.map((o) => `${batchId}/${o.name}`);
    const { error: rmError } = await svc.storage.from("imports").remove(paths);
    if (rmError) return err("Storage removal failed: " + rmError.message);
  }

  // 2. Delete child rows in dependency order, then the batch itself
  const childTables = [
    "import_record_links",
    "import_approval_queue",
    "import_duplicate_candidates",
    "import_errors",
    "import_mappings",
    "import_rows",
    "import_files",
  ];
  for (const tbl of childTables) {
    const { error } = await svc.from(tbl).delete().eq("batch_id", batchId);
    if (error) return err(`Failed to purge ${tbl}: ${error.message}`);
  }
  const { error: batchError } = await svc.from("import_batches").delete().eq("id", batchId);
  if (batchError) return err(`Failed to purge batch: ${batchError.message}`);

  await audit(svc, caller.userId, "import_purge", "import_batches", batchId, {
    storage_files_removed: storageObjs?.length ?? 0,
  });

  return json({ purged: true, storage_files_removed: storageObjs?.length ?? 0 });
};


// -- Main router ---------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Reject oversized bodies before parsing — prevents DoS via huge JSON payloads.
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > 1_048_576) {
    return err("Request body exceeds 1 MB limit", 413);
  }

  try {
    const authHeader = req.headers.get("authorization");
    const caller = await resolveCaller(authHeader);

    // Block salesperson and viewer entirely
    if (!hasAny(caller.roles, [...IMPORT_ROLES, BD_ROLE])) {
      return err("Access denied: insufficient role for data import", 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (!action || !handlers[action]) {
      return err("Unknown action. Available: parse, validate, detect_duplicates, approve, dry_run_commit, commit, generate_report, purge_batch");
    }

    return await handlers[action](body, caller);
  } catch (e: unknown) {
    const status = (e as { status?: number }).status ?? 500;
    const message = (e as { message?: string }).message ?? "Internal error";
    return err(message, status);
  }
});

