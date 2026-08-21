import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import {
  json,
  err,
  canManageSalesPipeline,
  canRunSensitiveSalesAction,
  notConfiguredRun,
  missing,
} from "../shared.ts";
import { insertLeadServerSide, canCreateLead } from "../../_shared/leads.ts";
import { readTrigger } from "../../_shared/automation-run-log.ts";

async function run_protenders_ingest(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canCreateLead(caller.roles)) return err("Sales pipeline role required", 403);
  const svc = ctx.svc;
  const format = (payload.format as string) ?? "csv";

  // Helper: find header index by case-insensitive substring match
  function findCol(headers: string[], ...terms: string[]): number {
    return headers.findIndex((h) => terms.some((t) => h.toLowerCase().includes(t.toLowerCase())));
  }

  let rows: Record<string, unknown>[];

  if (payload.file_path) {
    // Download file from 'imports' storage bucket
    const { data: blob, error: dlErr } = await svc.storage
      .from("imports")
      .download(payload.file_path as string);
    if (dlErr || !blob) return err(`Storage download failed: ${dlErr?.message ?? "unknown"}`, 500);

    const text = await blob.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return err("File has no data rows", 400);

    // Parse CSV: headers on first line
    const parseCSVLine = (line: string): string[] =>
      line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

    const headers = parseCSVLine(lines[0]);
    const colProjectName = findCol(headers, "project", "مشروع");
    const colContractor = findCol(headers, "contractor", "مقاول");
    const colPackage = findCol(headers, "package", "حزمة");
    const colStage = findCol(headers, "stage", "مرحلة");
    const colDate = findCol(headers, "date", "تاريخ");
    const colValue = findCol(headers, "value", "قيمة");
    const colLocation = findCol(headers, "location", "موقع");

    rows = lines.slice(1).map((line) => {
      const cells = parseCSVLine(line);
      return {
        project_name: colProjectName >= 0 ? (cells[colProjectName] ?? null) : null,
        main_contractor: colContractor >= 0 ? (cells[colContractor] ?? null) : null,
        package: colPackage >= 0 ? (cells[colPackage] ?? null) : null,
        stage: colStage >= 0 ? (cells[colStage] ?? null) : null,
        source_date: colDate >= 0 ? (cells[colDate] ?? null) : null,
        value: colValue >= 0 ? (cells[colValue] ?? null) : null,
        location: colLocation >= 0 ? (cells[colLocation] ?? null) : null,
      };
    });
  } else if (Array.isArray(payload.rows) && (payload.rows as unknown[]).length > 0) {
    rows = payload.rows as Record<string, unknown>[];
  } else {
    return err("Provide file_path or rows", 400);
  }

  // Insert protenders_imports record
  const { data: imp } = await svc
    .from("protenders_imports")
    .insert({
      source: payload.file_path ? "file_upload" : "manual",
      format,
      status: "parsed",
      row_count: rows.length,
      uploaded_by: caller.userId,
    })
    .select("id")
    .single();

  const importId = (imp as { id: string } | null)?.id ?? null;

  if (importId) {
    // Insert one protenders_projects row per ingested row
    // Note: protenders_projects has no location/value columns — store extras in raw
    await svc.from("protenders_projects").insert(
      rows.map((r) => ({
        import_id: importId,
        project_name: (r.project_name as string) ?? null,
        main_contractor: (r.main_contractor as string) ?? null,
        package: (r.package as string) ?? null,
        stage: (r.stage as string) ?? null,
        source_date: (r.source_date as string) ?? null,
        evidence_url: (r.evidence_url as string) ?? null,
        evidence_text: (r.evidence_text as string) ?? null,
        raw: r,
      })),
    );

    // Auto-create leads for active/tender/open stage rows
    const activeKeywords = ["active", "tender", "مناقصة", "open"];
    const leadRows = rows.filter((r) => {
      const stage = String(r.stage ?? "").toLowerCase();
      return activeKeywords.some((kw) => stage.includes(kw));
    });

    // Best-effort per-row: one bad row must not lose the leads already
    // created, nor skip the batch audit/response below (mirrors
    // import-pipeline's commit_candidates loop, which has the same
    // continue-on-error shape for the same reason).
    let leadsCreated = 0;
    let leadsFailed = 0;
    for (const r of leadRows) {
      try {
        await insertLeadServerSide(
          svc,
          {
            project_name: (r.project_name as string) ?? "Unknown",
            location: (r.location as string) ?? null,
            main_contractor_guess: (r.main_contractor as string) ?? null,
          },
          caller.userId,
          "protenders",
          caller.roles,
        );
        leadsCreated++;
      } catch (e) {
        leadsFailed++;
        console.error(`[run_protenders_ingest] lead insert failed for row "${(r.project_name as string) ?? "Unknown"}":`, e);
      }
    }

    await auditLog(
      svc,
      caller.userId,
      "ai.protenders_ingest",
      "protenders_import",
      importId,
      { rows: rows.length, leads_created: leadsCreated, leads_failed: leadsFailed },
      caller.roles,
    );
    return json({
      ok: true,
      import_id: importId,
      ingested: rows.length,
      leads_created: leadsCreated,
      leads_failed: leadsFailed,
    });
  }

  await auditLog(
    svc,
    caller.userId,
    "ai.protenders_ingest",
    "protenders_import",
    "failed",
    { rows: rows.length },
    caller.roles,
  );
  return err("Failed to create import record", 500);
}

async function run_boq_extraction(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);

  const opportunityId = (payload.opportunity_id as string) ?? "";
  if (!opportunityId) return err("opportunity_id required", 400);
  if (!payload.file_path && (!Array.isArray(payload.rows) || !(payload.rows as unknown[]).length)) {
    return err("Provide file_path or rows", 400);
  }

  const svc = ctx.svc;

  // Helper: find column by header terms (case-insensitive substring)
  function findCol(headers: string[], ...terms: string[]): number {
    return headers.findIndex((h) => terms.some((t) => h.toLowerCase().includes(t.toLowerCase())));
  }

  interface BoqRow {
    item_code: string | null;
    description: string | null;
    unit: string | null;
    quantity: number;
    unit_price: number;
  }

  let rows: BoqRow[];

  if (payload.file_path) {
    const { data: blob, error: dlErr } = await svc.storage
      .from("imports")
      .download(payload.file_path as string);
    if (dlErr || !blob) return err(`Storage download failed: ${dlErr?.message ?? "unknown"}`, 500);

    const text = await blob.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return err("File has no data rows", 400);

    const parseCSVLine = (line: string): string[] =>
      line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

    const headers = parseCSVLine(lines[0]);
    const colCode = findCol(headers, "code", "item_code", "رقم", "كود");
    const colDesc = findCol(headers, "description", "desc", "item", "وصف", "البند");
    const colUnit = findCol(headers, "unit", "وحدة");
    const colQty = findCol(headers, "qty", "quantity", "كمية");
    const colPrice = findCol(headers, "price", "unit_price", "سعر");

    rows = lines.slice(1).map((line) => {
      const cells = parseCSVLine(line);
      return {
        item_code: colCode >= 0 ? (cells[colCode] ?? null) : null,
        description: colDesc >= 0 ? (cells[colDesc] ?? null) : null,
        unit: colUnit >= 0 ? (cells[colUnit] ?? null) : null,
        quantity: colQty >= 0 ? parseFloat(cells[colQty] ?? "0") || 0 : 0,
        unit_price: colPrice >= 0 ? parseFloat(cells[colPrice] ?? "0") || 0 : 0,
      };
    });
  } else {
    rows = (payload.rows as BoqRow[]).map((r) => ({
      item_code: (r.item_code as string) ?? null,
      description: (r.description as string) ?? null,
      unit: (r.unit as string) ?? null,
      quantity: parseFloat(String(r.quantity ?? 0)) || 0,
      unit_price: parseFloat(String(r.unit_price ?? 0)) || 0,
    }));
  }

  // ---- Stage only. Never write the canonical BOQ. --------------------------
  //
  // This used to find the one boqs row for the opportunity, DELETE every
  // boq_items row under it, and re-insert the parsed lines. Two problems, and
  // they compound: the insert named a column `unit` that boq_items does not
  // have, so it always failed — while the delete before it succeeded. On a BOQ
  // that already had priced lines the result was every line gone and nothing
  // put back, because these are four separate PostgREST calls and not one
  // transaction. It only looked harmless because boq_items was empty.
  //
  // Extraction is a proposal, not a commercial decision. It now lands in the
  // staging tables that have existed for exactly this since the AI pipeline was
  // built, and a human promotes lines into a BOQ. The database enforces the
  // same rule independently — boq_history_is_immutable() refuses the delete
  // even for the service role — so a stale deployment of this function cannot
  // destroy anything either.
  const { data: extraction, error: exErr } = await svc
    .from("boq_extractions")
    .insert({
      related_opportunity_id: opportunityId,
      source_file_url: (payload.file_path as string) ?? null,
      source_type: payload.file_path ? "file_import" : "inline_rows",
      status: "pending_review",
      uploaded_by: caller.userId,
      notes: `${rows.length} line(s) parsed. Awaiting human promotion into a BOQ.`,
    })
    .select("id")
    .single();
  if (exErr || !extraction) {
    return err(`Failed to stage extraction: ${exErr?.message ?? "unknown"}`, 500);
  }
  const extractionId = (extraction as { id: string }).id;

  // `unit` is a real column here, unlike on boq_items — this is what the parsed
  // unit was always meant to be written to.
  if (rows.length > 0) {
    const { error: itemsErr } = await svc.from("extracted_boq_items").insert(
      rows.map((r) => ({
        extraction_id: extractionId,
        item_description: r.description ?? null,
        sign_type: r.description ?? r.item_code ?? null,
        quantity: r.quantity,
        unit: r.unit ?? null,
        // Flagged when the parse produced no price or no quantity — the two
        // things a reviewer most needs to look at before promoting a line.
        uncertain: !r.unit_price || !r.quantity,
        source_ref: r.item_code ?? null,
      })),
    );
    if (itemsErr) return err(`Failed to stage extracted lines: ${itemsErr.message}`, 500);
  }

  const parsedTotal = rows.reduce((sum, r) => sum + r.quantity * r.unit_price, 0);

  await auditLog(
    svc,
    caller.userId,
    "ai.boq_extraction_staged",
    "opportunity",
    opportunityId,
    { extraction_id: extractionId, items: rows.length, parsed_total: parsedTotal, committed: false },
    caller.roles,
  );

  return json({
    ok: true,
    staged: true,
    extraction_id: extractionId,
    items_count: rows.length,
    parsed_total: parsedTotal,
    // Said plainly so no caller mistakes staging for a commit.
    message: "Lines staged for review. No BOQ was created or modified.",
  });
}

async function run_contact_mapping(
  _payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  return notConfiguredRun(
    ctx.svc,
    "contact_mapping",
    caller.userId,
    "Contact Mapping Agent scaffold — enrichment source not configured.",
  );
}

async function run_risk_finance(
  _payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  return notConfiguredRun(
    ctx.svc,
    "risk_finance",
    caller.userId,
    "Risk & Finance Agent scaffold — pending finance data feed.",
  );
}

async function run_smart_followup(
  _payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  return notConfiguredRun(
    ctx.svc,
    "smart_followup",
    caller.userId,
    "Smart Follow-up Agent scaffold — drafting model not configured. Never sends automatically.",
  );
}

// Evaluate the time-based automation rules and raise Sales Action Queue
// items (opportunity_flags rows). Intended to be called on a schedule
// (pg_cron / n8n) or manually by a manager. This is the Sprint 5 "daily
// action engine" — it reuses the same table/route the pre-existing 3
// rules already fed (Action Center), just tags every item with a
// queue_action_type so the UI can group/filter by the Sprint 5 vocabulary.
// 'missing_data' is deliberately not raised here — it is already produced
// by the Sprint 4 scoring engine (recomputeOpportunityScore -> syncScoreFlags)
// whenever a score is (re)computed, so it is not duplicated in this loop.

async function run_automations(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canRunSensitiveSalesAction(caller.roles))
    return err("Sensitive-action authority required", 403);

  // The rules live in SQL — public.run_sales_automations(), migration
  // 20260806120000. This handler is the authenticated front door for the
  // Action Center button; pg_cron calls the same function directly on its
  // nightly schedule. One implementation, so the manual run and the scheduled
  // run can never drift apart.
  //
  // They were reimplemented here in TypeScript until 2026-08-06. Moving them
  // into the database was not a style preference: scheduling them over HTTP was
  // blocked because sales-os-api requires a user token (verify_jwt), and no
  // machine caller can produce one. Rather than open a second door into a
  // function that also gates approvals and deletions, the rules moved to where
  // pg_cron already has authority. Every rule is a SELECT plus an INSERT into
  // opportunity_flags, so nothing was lost in the move.
  const svc = ctx.svc;
  const trigger = readTrigger(payload);

  const { data, error } = await svc.rpc("run_sales_automations", { _trigger: trigger });
  if (error) return err(`Automation run failed: ${error.message}`, 500);

  const row = Array.isArray(data) ? data[0] : data;
  const raised = Number(row?.raised ?? 0);
  const runId = row?.run_id ?? null;

  // entity_id is a uuid column. runId is a real UUID when the run was recorded;
  // when it wasn't, pass null — never a placeholder string. A non-UUID literal
  // here is the bug audit-helper.contract.test.ts exists to catch, and it fails
  // at the database rather than in review.
  await auditLog(
    svc,
    caller.userId,
    "automations.run",
    "automation_run",
    runId ?? null,
    { raised, trigger, run_id: runId },
    caller.roles,
  );

  return json({ ok: true, raised, run_id: runId, trigger });
}

// ---- Record lifecycle: archive / unarchive / request-delete / execute-delete / duplicate flag ----
// Direct client-side DELETE no longer works anywhere (RLS DELETE policies
// dropped + DELETE revoked at the grant layer — see
// 20260711160000_rbac_record_lifecycle_hardening.sql). These six actions
// are the only supported way to retire or restore a record. Guard logic
// lives in ../_shared/record-lifecycle.ts (pure, unit-tested) — every
// handler below checks the guard first and only then touches the database.

// Archive — the default, immediate alternative to delete. Restricted to
// pipeline operators (BD Manager and above); salespeople use
// request_delete or flag_duplicate instead.

export const automationModule: HandlerModule = {
  name: "automation",
  handlers: {
    run_protenders_ingest,
    run_boq_extraction,
    run_contact_mapping,
    run_risk_finance,
    run_smart_followup,
    run_automations,
  },
};
