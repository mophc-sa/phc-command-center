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

    if (leadRows.length > 0) {
      for (const r of leadRows) {
        await insertLeadServerSide(
          svc,
          {
            project_name: (r.project_name as string) ?? "Unknown",
            location: (r.location as string) ?? null,
            main_contractor_guess: (r.main_contractor as string) ?? null,
          },
          caller.userId,
          "protenders_ingest",
          caller.roles,
        );
      }
    }

    await auditLog(
      svc,
      caller.userId,
      "ai.protenders_ingest",
      "protenders_import",
      importId,
      { rows: rows.length, leads_created: leadRows.length },
      caller.roles,
    );
    return json({
      ok: true,
      import_id: importId,
      ingested: rows.length,
      leads_created: leadRows.length,
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

  // Check if a boqs record already exists for this opportunity
  // Note: boqs uses 'related_opportunity_id'; status enum: estimated_scope | verified | partially_verified | missing
  // title is NOT NULL so provide a default; estimated_value stores total
  const { data: existingBoq } = await svc
    .from("boqs")
    .select("id")
    .eq("related_opportunity_id", opportunityId)
    .maybeSingle();

  let boqId: string;

  if (!existingBoq) {
    const { data: newBoq, error: boqErr } = await svc
      .from("boqs")
      .insert({
        related_opportunity_id: opportunityId,
        title: "Imported BOQ",
        status: "estimated_scope",
        currency: "SAR",
        source: "file_import",
        source_confidence: "medium",
        created_by: caller.userId,
      })
      .select("id")
      .single();
    if (boqErr || !newBoq) return err(`Failed to create BOQ: ${boqErr?.message ?? "unknown"}`, 500);
    boqId = (newBoq as { id: string }).id;
  } else {
    boqId = (existingBoq as { id: string }).id;
  }

  // Clean re-import: delete existing items for this BOQ
  await svc.from("boq_items").delete().eq("boq_id", boqId);

  // Map parsed rows to boq_items schema:
  // boq_items uses: sign_type (NOT NULL), unit_rate, quantity, unit, item_source, sort_order
  // description → sign_type, item_code → item_source, unit_price → unit_rate
  const totalValue = rows.reduce((sum, r) => sum + r.quantity * r.unit_price, 0);

  if (rows.length > 0) {
    await svc.from("boq_items").insert(
      rows.map((r, idx) => ({
        boq_id: boqId,
        sign_type: r.description ?? r.item_code ?? "Unknown",
        item_source: r.item_code ?? null,
        unit: r.unit ?? null,
        quantity: r.quantity,
        unit_rate: r.unit_price,
        cost_estimate: r.quantity * r.unit_price,
        sort_order: idx + 1,
        confidence: "medium" as const,
      })),
    );
  }

  // Update BOQ estimated_value and updated_at
  await svc
    .from("boqs")
    .update({ estimated_value: totalValue, updated_at: new Date().toISOString() })
    .eq("id", boqId);

  await auditLog(
    svc,
    caller.userId,
    "ai.boq_extraction",
    "boq",
    boqId,
    { items: rows.length, total_value: totalValue },
    caller.roles,
  );
  return json({ ok: true, boq_id: boqId, items_count: rows.length, total_value: totalValue });
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
  _payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canRunSensitiveSalesAction(caller.roles))
    return err("Sensitive-action authority required", 403);
  const svc = ctx.svc;
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const daysAgo = (d: number) => new Date(now - d * 864e5).toISOString().slice(0, 10);
  const daysFromNow = (d: number) => new Date(now + d * 864e5).toISOString().slice(0, 10);
  let raised = 0;
  const raiseFlag = async (
    recordType: string,
    recordId: string,
    kind: "action_required" | "risk",
    opts: {
      action_type?: string;
      risk_flag?: string;
      queue_action_type: string;
      reason: string;
      recommended_action?: string;
      owner_id?: string | null;
      due_date?: string | null;
      priority?: "A" | "B" | "C";
    },
  ) => {
    // Avoid duplicates: skip if an active item of the same queue_action_type
    // already exists for this record. "Active" mirrors ACTIVE_FLAG_STATUSES
    // in workflow-actions.ts (open/in_progress/escalated/blocked) so an
    // escalated or blocked item doesn't get silently duplicated by the next
    // automation run. Scoping the dedup check to queue_action_type (not
    // just flag_kind) means two different rules on the same record no
    // longer suppress each other.
    const { data: existing } = await svc
      .from("opportunity_flags")
      .select("id")
      .eq("linked_record_id", recordId)
      .in("status", ["open", "in_progress", "escalated", "blocked"])
      .eq("queue_action_type", opts.queue_action_type)
      .limit(1);
    if (existing && existing.length) return;
    await svc.from("opportunity_flags").insert({
      linked_record_type: recordType,
      linked_record_id: recordId,
      flag_kind: kind,
      action_type: opts.action_type ?? null,
      risk_flag: opts.risk_flag ?? null,
      queue_action_type: opts.queue_action_type,
      recommended_action: opts.recommended_action ?? null,
      action_owner_id: opts.owner_id ?? null,
      due_date: opts.due_date ?? null,
      priority: opts.priority ?? null,
      reason: opts.reason,
      status: "open",
      ai_generated: true,
    });
    raised++;
  };

  // RFQ with no owner for 24h -> RFQ review needed.
  const { data: orphanRfqs } = await svc
    .from("rfqs")
    .select("id, created_at")
    .is("sales_owner_id", null)
    .eq("status", "open")
    .lt("created_at", daysAgo(1));
  for (const r of orphanRfqs ?? []) {
    await raiseFlag("rfq", r.id, "action_required", {
      action_type: "follow_up_required",
      queue_action_type: "rfq_review_needed",
      reason: "RFQ unassigned for 24h",
      recommended_action: "Assign a sales owner to this RFQ.",
      priority: "A",
    });
  }

  // Verbally awarded with no contract after 14 days -> contract evidence missing.
  const { data: staleAwards } = await svc
    .from("opportunities")
    .select("id, owner_id, verbal_award_date")
    .eq("sales_stage", "verbally_awarded")
    .lt("verbal_award_date", daysAgo(14));
  for (const o of staleAwards ?? []) {
    await raiseFlag("opportunity", o.id, "risk", {
      risk_flag: "contract_pending",
      queue_action_type: "contract_evidence_missing",
      reason: "Verbally awarded >14d without contract",
      recommended_action: "Follow up on the contract and record it once received.",
      owner_id: o.owner_id,
      priority: "A",
    });
  }
  // Verbally awarded without any recorded award evidence -> contract evidence missing.
  const { data: verbalNoEvidence } = await svc
    .from("opportunities")
    .select("id, owner_id, verbal_award_date")
    .eq("sales_stage", "verbally_awarded")
    .is("verbal_award_evidence", null)
    .lt("verbal_award_date", daysAgo(3));
  for (const o of verbalNoEvidence ?? []) {
    await raiseFlag("opportunity", o.id, "risk", {
      risk_flag: "contract_pending",
      queue_action_type: "contract_evidence_missing",
      reason: "Verbal award recorded without evidence",
      recommended_action: "Upload verbal award evidence (email, letter, or call note).",
      owner_id: o.owner_id,
      priority: "A",
    });
  }
  // Contract stage reached without a contract reference number -> contract evidence missing.
  const { data: contractNoRef } = await svc
    .from("opportunities")
    .select("id, owner_id")
    .in("sales_stage", ["contract_received", "won"])
    .is("contract_reference_number", null);
  for (const o of contractNoRef ?? []) {
    await raiseFlag("opportunity", o.id, "action_required", {
      queue_action_type: "contract_evidence_missing",
      reason: "Contract stage reached without a contract reference number",
      recommended_action: "Record the signed contract reference number.",
      owner_id: o.owner_id,
      priority: "A",
    });
  }

  // Tenders with expected award within 7 days -> tender review needed.
  const { data: dueTenders } = await svc
    .from("tenders")
    .select("id, tender_owner_id, expected_award_date")
    .not("expected_award_date", "is", null)
    .lte("expected_award_date", daysFromNow(7))
    .neq("tender_stage", "converted_to_jih")
    .neq("tender_stage", "tender_lost_or_archived");
  for (const tdr of dueTenders ?? []) {
    await raiseFlag("tender", tdr.id, "action_required", {
      action_type: "tender_decision_required",
      queue_action_type: "tender_review_needed",
      reason: "Tender award expected within 7 days",
      recommended_action: "Review the tender and confirm the go/no-go decision.",
      owner_id: tdr.tender_owner_id,
      due_date: tdr.expected_award_date,
      priority: "A",
    });
  }

  // Follow-ups due today -> follow-up due.
  const { data: dueFollowUps } = await svc
    .from("follow_ups")
    .select("id, opportunity_id, owner_id, due_date, cadence_tier")
    .eq("status", "scheduled")
    .eq("due_date", today);
  for (const f of dueFollowUps ?? []) {
    await raiseFlag("opportunity", f.opportunity_id, "action_required", {
      action_type: "follow_up_required",
      queue_action_type: "follow_up_due",
      reason: "Follow-up due today",
      recommended_action: "Complete today's scheduled follow-up.",
      owner_id: f.owner_id,
      due_date: f.due_date,
      priority: f.cadence_tier,
    });
  }

  // Follow-ups past due -> follow-up overdue.
  const { data: overdueFollowUps } = await svc
    .from("follow_ups")
    .select("id, opportunity_id, owner_id, due_date, cadence_tier")
    .not("status", "in", "(completed,cancelled)")
    .lt("due_date", today);
  for (const f of overdueFollowUps ?? []) {
    await raiseFlag("opportunity", f.opportunity_id, "risk", {
      risk_flag: "follow_up_overdue",
      queue_action_type: "follow_up_overdue",
      reason: `Follow-up overdue since ${f.due_date}`,
      recommended_action: "Contact the customer immediately and reschedule.",
      owner_id: f.owner_id,
      due_date: f.due_date,
      priority: "A",
    });
  }

  // Important (Tier A/B) opportunities with no next action -> no next action.
  const { data: noNextAction } = await svc
    .from("opportunities")
    .select("id, owner_id, tier")
    .in("tier", ["A", "B"])
    .is("next_action", null)
    .not("stage", "in", "(won,lost,archived)");
  for (const o of noNextAction ?? []) {
    await raiseFlag("opportunity", o.id, "action_required", {
      queue_action_type: "no_next_action",
      reason: "Important opportunity has no next action set",
      recommended_action: "Define and record the next action for this opportunity.",
      owner_id: o.owner_id,
      priority: o.tier,
    });
  }

  // Tier A opportunities inactive 14+ days -> inactive Tier A opportunity.
  const { data: inactiveTierA } = await svc
    .from("opportunities")
    .select("id, owner_id, last_activity_at")
    .eq("tier", "A")
    .not("stage", "in", "(won,lost,archived)")
    .or(`last_activity_at.is.null,last_activity_at.lt.${daysAgo(14)}`);
  for (const o of inactiveTierA ?? []) {
    await raiseFlag("opportunity", o.id, "risk", {
      queue_action_type: "inactive_tier_a_opportunity",
      reason: "Tier A opportunity with no activity in 14+ days",
      recommended_action: "Re-engage the client and log an activity.",
      owner_id: o.owner_id,
      priority: "A",
    });
  }

  // Pending approvals -> approval needed.
  const { data: pendingApprovals } = await svc
    .from("approvals")
    .select("id, assigned_approver, requested_by, approval_type")
    .eq("status", "pending");
  for (const a of pendingApprovals ?? []) {
    await raiseFlag("approval", a.id, "action_required", {
      queue_action_type: "approval_needed",
      reason: `Pending ${a.approval_type} approval`,
      recommended_action: "Review and decide on this approval request.",
      owner_id: a.assigned_approver ?? a.requested_by,
      priority: "A",
    });
  }

  // Quotations with no follow-up in 5+ days -> quotation follow-up.
  const { data: staleQuotations } = await svc
    .from("quotations")
    .select("id, owner_id, issued_date, last_follow_up_at, status")
    .in("status", ["submitted", "follow_up", "negotiation"]);
  const followUpCutoff = daysAgo(5);
  for (const q of staleQuotations ?? []) {
    const lastTouch = q.last_follow_up_at ?? q.issued_date;
    if (lastTouch && lastTouch < followUpCutoff) {
      await raiseFlag("quotation", q.id, "action_required", {
        queue_action_type: "quotation_follow_up",
        reason: "No follow-up on this quotation in 5+ days",
        recommended_action: "Follow up with the client on the submitted quotation.",
        owner_id: q.owner_id,
        priority: "B",
      });
    }
  }

  // entity_id is nullable — this is a system-level action with no single
  // entity, so pass null rather than a non-UUID string literal (the
  // previous "run_automations" string silently failed the column's uuid
  // check and the insert never happened).
  await auditLog(svc, caller.userId, "automations.run", "system", null, { raised }, caller.roles);
  return json({ ok: true, raised });
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
