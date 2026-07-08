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
      const sheetName = file.sheet_name ?? wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) return err(`Sheet "${sheetName}" not found`);
      const jsonData: string[][] = utils.sheet_to_json(ws, { header: 1, raw: false });
      if (jsonData.length > 0) {
        headers = jsonData[0].map(String);
        rows = jsonData.slice(1);
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

  // Update file with column names and row count
  await svc.from("import_files").update({
    column_names: headers,
    row_count: rows.length,
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

  // Get rows
  const { data: rows } = await svc.from("import_rows")
    .select("id, row_number, raw_data")
    .eq("batch_id", batchId)
    .order("row_number");
  if (!rows) return err("No rows found");

  const errors: Array<{
    batch_id: string; row_id: string; row_number: number;
    column_name: string; error_type: string; message: string; severity: string;
  }> = [];
  let validCount = 0;
  let errorCount = 0;

  for (const row of rows) {
    const raw = row.raw_data as Record<string, unknown>;
    const mapped: Record<string, unknown> = {};
    let rowHasError = false;

    for (const m of mappings) {
      const value = raw[m.source_column];
      const strVal = value != null ? String(value).trim() : "";

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
    valid: validCount, errors: errorCount,
  });

  return json({ valid_rows: validCount, error_rows: errorCount, total_errors: errors.length });
};

// DETECT_DUPLICATES: deterministic matching against existing companies
handlers["detect_duplicates"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  if (!batchId) return err("batch_id required");

  const svc = serviceClient();

  // Get valid rows with mapped data
  const { data: rows } = await svc.from("import_rows")
    .select("id, row_number, mapped_data")
    .eq("batch_id", batchId)
    .eq("status", "valid")
    .order("row_number");
  if (!rows || rows.length === 0) return json({ duplicates: 0 });

  // Get existing companies for matching
  const { data: companies } = await svc.from("companies")
    .select("id, name, cr_number, website_domain");

  const existingByName = new Map((companies ?? []).map((c) => [c.name?.toLowerCase().trim(), c]));
  const existingByCr = new Map((companies ?? []).filter((c) => c.cr_number).map((c) => [c.cr_number, c]));
  const existingByDomain = new Map((companies ?? []).filter((c) => c.website_domain).map((c) => [c.website_domain, c]));

  const dupes: Array<{
    batch_id: string; row_id: string; existing_record_id: string;
    existing_table: string; match_type: string; confidence: number; resolution: string;
  }> = [];
  let dupeCount = 0;

  for (const row of rows) {
    const mapped = row.mapped_data as Record<string, string | null> | null;
    if (!mapped) continue;

    const name = mapped.name?.toLowerCase().trim();
    const crNumber = mapped.cr_number?.trim();
    const domain = mapped.website_domain?.trim();

    let match: { id: string; type: string; confidence: number } | null = null;

    // CR number match (highest confidence)
    if (crNumber && existingByCr.has(crNumber)) {
      match = { id: existingByCr.get(crNumber)!.id, type: "cr_number", confidence: 98 };
    }
    // Domain match
    else if (domain && existingByDomain.has(domain)) {
      match = { id: existingByDomain.get(domain)!.id, type: "domain", confidence: 90 };
    }
    // Exact name match
    else if (name && existingByName.has(name)) {
      match = { id: existingByName.get(name)!.id, type: "exact", confidence: 85 };
    }

    if (match) {
      dupes.push({
        batch_id: batchId, row_id: row.id, existing_record_id: match.id,
        existing_table: "companies", match_type: match.type,
        confidence: match.confidence, resolution: "pending",
      });
      await svc.from("import_rows").update({ status: "duplicate" }).eq("id", row.id);
      dupeCount++;
    }
  }

  if (dupes.length > 0) {
    for (let i = 0; i < dupes.length; i += 500) {
      await svc.from("import_duplicate_candidates").insert(dupes.slice(i, i + 500));
    }
  }

  await svc.from("import_batches").update({
    status: "pending_approval",
    duplicate_rows: dupeCount,
  }).eq("id", batchId);

  await audit(svc, caller.userId, "import_detect_duplicates", "import_batches", batchId, {
    duplicates: dupeCount,
  });

  return json({ duplicates: dupeCount });
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

// GENERATE_REPORT: create downloadable CSV reports
handlers["generate_report"] = async (payload, caller) => {
  const batchId = payload.batch_id as string;
  const reportType = payload.report_type as string;
  if (!batchId || !reportType) return err("batch_id and report_type required");

  const svc = serviceClient();

  const csvRows: string[] = [];

  if (reportType === "validation_errors") {
    const { data: errors } = await svc.from("import_errors")
      .select("row_number, column_name, error_type, message, severity")
      .eq("batch_id", batchId)
      .order("row_number");

    csvRows.push("row_number,column_name,error_type,message,severity");
    for (const e of errors ?? []) {
      csvRows.push([
        e.row_number, quote(e.column_name), e.error_type, quote(e.message), e.severity,
      ].join(","));
    }
  } else if (reportType === "duplicate_candidates") {
    const { data: dupes } = await svc.from("import_duplicate_candidates")
      .select("row_id, existing_record_id, existing_table, match_type, confidence, resolution")
      .eq("batch_id", batchId);

    csvRows.push("row_id,existing_record_id,existing_table,match_type,confidence,resolution");
    for (const d of dupes ?? []) {
      csvRows.push([
        d.row_id, d.existing_record_id, d.existing_table, d.match_type, d.confidence, d.resolution,
      ].join(","));
    }
  } else if (reportType === "import_summary") {
    const { data: batch } = await svc.from("import_batches").select("*").eq("id", batchId).single();
    if (!batch) return err("Batch not found", 404);

    csvRows.push("field,value");
    csvRows.push(`batch_id,${batch.id}`);
    csvRows.push(`status,${batch.status}`);
    csvRows.push(`total_rows,${batch.total_rows}`);
    csvRows.push(`valid_rows,${batch.valid_rows}`);
    csvRows.push(`error_rows,${batch.error_rows}`);
    csvRows.push(`duplicate_rows,${batch.duplicate_rows}`);
    csvRows.push(`dry_run,${batch.dry_run}`);
    csvRows.push(`created_at,${batch.created_at}`);
    csvRows.push(`ai_suggestions_enabled,${batch.ai_suggestions_enabled}`);
  } else {
    return err("Invalid report_type. Use: validation_errors, duplicate_candidates, import_summary");
  }

  await audit(svc, caller.userId, "import_generate_report", "import_batches", batchId, { report_type: reportType });

  return new Response(csvRows.join("\n"), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${reportType}_${batchId.slice(0, 8)}.csv"`,
    },
  });
};

function quote(s: string | null | undefined): string {
  if (!s) return "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// -- Main router ---------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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
      return err("Unknown action. Available: parse, validate, detect_duplicates, approve, dry_run_commit, generate_report");
    }

    return await handlers[action](body, caller);
  } catch (e: unknown) {
    const status = (e as { status?: number }).status ?? 500;
    const message = (e as { message?: string }).message ?? "Internal error";
    return err(message, status);
  }
});
