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

// User-facing sentinel written into mapped_data by the validate step to mark
// columns the user explicitly excluded from import.
const SKIP_KEY = "__skip__";

// Phase 2 (approved): "commit_candidates" is the one live-CRM-write path in
// this pipeline. It writes only import_record_candidates rows a human has
// already set review_status = 'approved' on (see the "Candidates" tab) —
// never a blanket per-batch commit, and never a required-field validator:
// whatever was mapped is written as-is, and a row that the target table's
// own NOT NULL constraints reject simply fails that one row (see
// import-readiness.test.ts's guard, updated alongside this to describe the
// new invariant instead of "no live writes at all").
//
// "rollback" (below) reverses it: it only ever DELETEs a row this pipeline
// created, tracked via import_record_links.

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

// GENERATE_CANDIDATES: stage a per-row create/update/duplicate decision into
// import_record_candidates, ready for human review before commit.
//
// Deterministic, not an AI call: by this point in the pipeline every row
// already has mapped_data (from column mapping) and, if applicable, a
// duplicate_candidates entry (from detect_duplicates) with a resolution.
// This step just turns "what we already know about this row" into one
// candidate record — no required-field validation, whatever was mapped is
// staged as-is (real data varies row to row; commit is where partial rows
// get a chance to fail gracefully, not here).
//
// Re-runnable: clears this batch's prior candidates first, so re-running
// after a mapping tweak or a duplicate-resolution change reflects the
// current state, not a stale snapshot.
handlers["generate_candidates"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  if (!batchId) return err("batch_id required");

  const svc = serviceClient();

  const { data: batch } = await svc.from("import_batches").select("id, target_entity").eq("id", batchId).single();
  if (!batch) return err("Batch not found", 404);

  const { data: rows } = await svc.from("import_rows")
    .select("id, mapped_data, is_excluded, row_status")
    .eq("batch_id", batchId)
    .eq("status", "valid")
    .order("row_number");
  const liveRows = (rows ?? []).filter((r) => !r.is_excluded && r.row_status !== "deleted" && r.row_status !== "excluded");

  const { data: dupeRows } = await svc.from("import_duplicate_candidates")
    .select("row_id, existing_record_id, existing_table, resolution, confidence, match_type")
    .eq("batch_id", batchId);
  const dupeByRow = new Map((dupeRows ?? []).map((d) => [d.row_id as string, d]));

  await svc.from("import_record_candidates").delete().eq("batch_id", batchId);

  const entityType = batch.target_entity as string;
  const candidates = liveRows.map((row) => {
    const dupe = dupeByRow.get(row.id as string);
    let proposedAction: string;
    let existingRecordId: string | null = null;
    let existingTable: string | null = null;
    let confidence: number | null = null;
    let reason: string;

    if (!dupe) {
      proposedAction = "create";
      reason = "No matching record found";
    } else {
      confidence = dupe.confidence != null ? Number(dupe.confidence) / 100 : null;
      existingRecordId = dupe.existing_record_id as string;
      existingTable = dupe.existing_table as string;
      if (dupe.resolution === "skip") {
        proposedAction = "duplicate";
        reason = `Matched an existing ${existingTable} record (${dupe.match_type}) — marked to skip`;
      } else if (dupe.resolution === "merge") {
        proposedAction = "update";
        reason = `Matched an existing ${existingTable} record (${dupe.match_type}) — will update`;
      } else if (dupe.resolution === "create_new") {
        proposedAction = "create";
        existingRecordId = null;
        existingTable = null;
        reason = "Possible duplicate, reviewer chose to create a new record anyway";
      } else {
        proposedAction = "needs_review";
        reason = `Possible duplicate (${dupe.match_type}) — needs a decision before commit`;
      }
    }

    return {
      batch_id: batchId,
      source_row_id: row.id,
      entity_type: entityType,
      proposed_action: proposedAction,
      existing_record_id: existingRecordId,
      existing_table: existingTable,
      proposed_payload: row.mapped_data ?? {},
      confidence,
      reason,
      review_status: "pending",
    };
  });

  for (let i = 0; i < candidates.length; i += 500) {
    if (candidates.length) await svc.from("import_record_candidates").insert(candidates.slice(i, i + 500));
  }

  await audit(svc, caller.userId, "import_generate_candidates", "import_batches", batchId, {
    candidates: candidates.length,
  });

  return json({ candidates: candidates.length });
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

// Candidate entity_type -> real table name. Most match 1:1, but a few of the
// ImportTargetEntity values predate (or were never given) a same-named
// table: 'boq' is actually public.boqs, 'sales_actuals' is actually
// public.sales_actuals_monthly. Getting this wrong would mean silently
// writing to (or deleting from) the wrong table, so both commit_candidates
// and rollback resolve every table name through this single map rather than
// assuming entity_type === table name anywhere.
const ENTITY_TABLE_MAP: Record<string, string> = {
  companies: "companies",
  contacts: "contacts",
  leads: "leads",
  opportunities: "opportunities",
  projects: "projects",
  quotations: "quotations",
  follow_ups: "follow_ups",
  account_interactions: "account_interactions",
  quotation_updates: "quotation_updates",
  sales_actuals: "sales_actuals_monthly",
  boq: "boqs",
  rfqs: "rfqs",
  tenders: "tenders",
};

// COMMIT_CANDIDATES: write approved import_record_candidates to their real
// target tables. This is the one live-CRM-write path in this pipeline —
// reachable only for candidates a human has already set
// review_status = 'approved' on (the "Candidates" tab), never a blanket
// per-batch commit.
//
// No required-field validation: proposed_payload is written as-is (minus
// empty/null values), matching "our data varies row to row — don't gate on
// required fields." The target table's own NOT NULL/CHECK constraints are
// the real backstop; a row that trips one simply fails and is reported,
// without blocking the rest of the batch.
handlers["commit_candidates"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  if (!batchId) return err("batch_id required");

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

  // Same manual readiness gate the pre-Phase-1.1 commit draft had.
  const MANUAL_KEYS = ["file_source_confirmed", "owner_confirmed", "backup_completed", "no_unnecessary_sensitive_data"];
  const checklist = (batch.readiness_checklist ?? {}) as Record<string, boolean>;
  const incomplete = MANUAL_KEYS.filter((k) => !checklist[k]);
  if (incomplete.length > 0) return err(`Readiness checklist incomplete. Unchecked items: ${incomplete.join(", ")}`);

  const { data: approved } = await svc
    .from("import_record_candidates")
    .select("id, source_row_id, entity_type, proposed_action, existing_record_id, proposed_payload")
    .eq("batch_id", batchId)
    .eq("review_status", "approved");

  const candidates = (approved ?? []) as {
    id: string; source_row_id: string; entity_type: string; proposed_action: string;
    existing_record_id: string | null; proposed_payload: Record<string, unknown>;
  }[];
  if (candidates.length === 0) return err("No approved candidates to commit");

  let committed = 0;
  let failed = 0;
  const links: Array<{ batch_id: string; row_id: string; target_table: string; target_id: string; action: string }> = [];
  const commitErrors: Array<{
    batch_id: string; row_id: string; row_number: number;
    column_name: string; error_type: string; message: string; severity: string;
  }> = [];

  for (const cand of candidates) {
    const table = ENTITY_TABLE_MAP[cand.entity_type];
    // Only create/update ever perform a write. A candidate reviewed and
    // approved as anything else (duplicate/needs_review/conflict) — or one
    // whose entity_type has no known table — is skipped, not force-written.
    if (!table || (cand.proposed_action !== "create" && cand.proposed_action !== "update")) {
      failed++;
      commitErrors.push({
        batch_id: batchId, row_id: cand.source_row_id, row_number: 0,
        column_name: "*", error_type: "commit_skipped",
        message: !table
          ? `Unknown entity_type '${cand.entity_type}' — no target table mapped`
          : `Approved candidate has proposed_action '${cand.proposed_action}', not create/update — skipped`,
        severity: "error",
      });
      continue;
    }

    // Best-effort payload: drop empty/null values rather than writing them
    // over column defaults, but otherwise write whatever was mapped.
    const payload = Object.fromEntries(
      Object.entries(cand.proposed_payload).filter(([, v]) => v != null && String(v).trim() !== ""),
    );

    try {
      if (cand.proposed_action === "create") {
        const { data: created, error } = await svc.from(table).insert(payload).select("id").single();
        if (error) throw error;
        links.push({ batch_id: batchId, row_id: cand.source_row_id, target_table: table, target_id: created.id, action: "created" });
      } else {
        if (!cand.existing_record_id) throw new Error("Missing existing_record_id for an update action");
        const { error } = await svc.from(table).update(payload).eq("id", cand.existing_record_id);
        if (error) throw error;
        links.push({ batch_id: batchId, row_id: cand.source_row_id, target_table: table, target_id: cand.existing_record_id, action: "updated" });
      }
      committed++;
    } catch (e) {
      failed++;
      commitErrors.push({
        batch_id: batchId, row_id: cand.source_row_id, row_number: 0,
        column_name: "*", error_type: "commit_error",
        message: e instanceof Error ? e.message : String(e),
        severity: "error",
      });
    }
  }

  for (let i = 0; i < commitErrors.length; i += 500) {
    await svc.from("import_errors").insert(commitErrors.slice(i, i + 500));
  }
  for (let i = 0; i < links.length; i += 500) {
    await svc.from("import_record_links").insert(links.slice(i, i + 500));
  }

  await svc.from("import_batches").update({
    status: "committed",
    committed_at: new Date().toISOString(),
  }).eq("id", batchId);

  const summary = { committed, failed, total: candidates.length };
  await audit(svc, caller.userId, "import_commit_candidates", "import_batches", batchId, summary);

  return json(summary);
};

// ROLLBACK: reverse a committed batch's CRM writes, using the audit trail
// import_record_links left behind at commit time. This only ever DELETEs a
// row this pipeline itself created — it never INSERTs/UPSERTs, matching
// commit_candidates' own action set (see import-readiness.test.ts, updated
// alongside this to describe the new invariant: live CRM writes exist, but
// only through the reviewed-candidate commit path).
//
// "updated" links can't be reversed: commit never captured the pre-update
// value, so there is nothing to restore. Those are reported as needing
// manual review rather than silently skipped or force-reverted. A delete
// that fails (most likely a foreign-key violation because something else —
// an opportunity, a follow-up, a contact — now references the record) is
// left in place rather than cascaded, and counted separately.
const ROLLBACK_TABLES = new Set(Object.values(ENTITY_TABLE_MAP));

handlers["rollback"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  if (!batchId) return err("batch_id required");

  if (hasAny(caller.roles, ["system_admin" as AppRole]) && !hasAny(caller.roles, APPROVE_COMMIT_ROLES)) {
    return err("system_admin cannot roll back imports", 403);
  }
  if (!hasAny(caller.roles, APPROVE_COMMIT_ROLES)) {
    return err("Insufficient role for rollback", 403);
  }

  const svc = serviceClient();

  const { data: batch } = await svc.from("import_batches").select("status").eq("id", batchId).single();
  if (!batch) return err("Batch not found", 404);
  if (batch.status !== "committed") return err("Only a committed batch can be rolled back");

  const { data: links } = await svc
    .from("import_record_links")
    .select("id, target_table, target_id, action")
    .eq("batch_id", batchId);

  const allLinks = (links ?? []) as { id: string; target_table: string; target_id: string; action: string }[];

  let rolledBack = 0;
  let stillReferenced = 0;
  let manualReview = 0;

  for (const link of allLinks) {
    if (link.action !== "created" || !ROLLBACK_TABLES.has(link.target_table)) {
      manualReview++;
      continue;
    }
    const { error } = await svc.from(link.target_table).delete().eq("id", link.target_id);
    if (error) {
      stillReferenced++;
      continue;
    }
    rolledBack++;
  }

  await svc.from("import_batches").update({
    status: "rolled_back",
    rolled_back_at: new Date().toISOString(),
    rolled_back_by: caller.userId,
  }).eq("id", batchId);

  const summary = {
    rolled_back: rolledBack,
    still_referenced: stillReferenced,
    manual_review_required: manualReview,
    total: allLinks.length,
  };

  await audit(svc, caller.userId, "import_rollback", "import_batches", batchId, summary);

  return json(summary);
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
      return err(`Unknown action. Available: ${Object.keys(handlers).join(", ")}`);
    }

    return await handlers[action](body, caller);
  } catch (e: unknown) {
    const status = (e as { status?: number }).status ?? 500;
    const message = (e as { message?: string }).message ?? "Internal error";
    return err(message, status);
  }
});

