// =============================================================================
// PHC Sales OS — Backend layer (Supabase Edge Function)
//
// This is the single server-side chokepoint for SENSITIVE COMMERCIAL DECISIONS.
// Per the Sales OS spec, these actions must be enforced server-side (not by the
// browser): approval decisions, closing a quotation Won/Lost, converting a lead,
// reassigning an account owner, and accepting an AI recommendation.
//
// Each handler: (1) resolves the caller + roles from the JWT, (2) authorizes in
// code, (3) performs the write with the service-role client, (4) writes audit.
// It is also the future integration point for the workflow engine (n8n),
// AI layer, and external systems.
// =============================================================================
import { corsHeaders } from "../_shared/cors.ts";
import { json, err } from "../_shared/respond.ts";
import {
  resolveCaller,
  serviceClient,
  audit,
  type AppRole,
} from "../_shared/supabase.ts";
import {
  canApproveCommercialAction,
  canAssignOwner,
  canChangeCommercialStage,
  canCreateSalesRecords,
  canExecuteDelete,
  canManageSalesPipeline,
  canRunSensitiveSalesAction,
} from "../_shared/roles.ts";
import {
  isActiveDeleteRequestStatus,
  validateArchiveTarget,
  validateDeleteRequest,
  validateDuplicatePair,
} from "../_shared/record-lifecycle.ts";
import { planApprovalExecution, type ApprovalRow } from "../_shared/approvals.ts";
import {
  evaluateConversion,
  reviewFromRecord,
  type ConversionReview,
} from "../_shared/conversion.ts";
import { scoreLead } from "../_shared/lead-scoring.ts";
import { findDuplicateGroups, type DupRecord } from "../_shared/duplicates.ts";

// Write an AI recommendation with its evidence items in one place. Every
// recommendation MUST carry at least one evidence item.
async function writeRecommendation(
  svc: ReturnType<typeof serviceClient>,
  rec: Record<string, unknown>,
  evidence: Record<string, unknown>[],
): Promise<{ id: string } | null> {
  const { data } = await svc.from("ai_recommendations").insert(rec).select().single();
  if (data && evidence.length) {
    await svc.from("ai_evidence_items").insert(evidence.map((e) => ({ recommendation_id: data.id, ...e })));
  }
  return data as { id: string } | null;
}

// Record an agent run row and return its id.
async function startAgentRun(
  svc: ReturnType<typeof serviceClient>,
  agentKey: string,
  actorId: string,
): Promise<string | null> {
  const { data } = await svc
    .from("ai_agent_runs")
    .insert({ agent_key: agentKey, status: "running", created_by: actorId })
    .select("id")
    .single();
  return (data as { id: string } | null)?.id ?? null;
}

async function finishAgentRun(
  svc: ReturnType<typeof serviceClient>,
  runId: string | null,
  patch: Record<string, unknown>,
) {
  if (!runId) return;
  await svc.from("ai_agent_runs").update({ completed_at: new Date().toISOString(), ...patch }).eq("id", runId);
}

// Honest scaffold for an agent whose external dependency is not configured.
// Records a not_configured run — never fabricated output.
async function notConfiguredRun(
  svc: ReturnType<typeof serviceClient>,
  agentKey: string,
  actorId: string,
  detail: string,
): Promise<Response> {
  const runId = await startAgentRun(svc, agentKey, actorId);
  await finishAgentRun(svc, runId, { status: "not_configured", summary: detail });
  return json({ ok: true, configured: false, status: "not_configured", detail, run_id: runId });
}

// Persist a conversion review snapshot onto the source record (tender | rfq).
// Confidence lives in different columns: tenders reuse `signage_potential`,
// RFQs use their own `signage_package_confidence` column.
async function persistConversionReview(
  svc: ReturnType<typeof serviceClient>,
  table: "tenders" | "rfqs",
  recordId: string,
  review: ConversionReview,
) {
  const patch: Record<string, unknown> = {
    project_stage_suitable: review.project_stage_suitable,
    package_not_closed: review.package_not_closed,
    estimated_signage_value: review.estimated_signage_value,
    contact_plan_ready: review.contact_plan_ready,
    main_contractor_confirmed: review.main_contractor_confirmed,
    signage_package_status: review.signage_package_status ?? "unknown",
    conversion_reason: review.conversion_reason,
  };
  if (review.signage_package_confidence) {
    if (table === "rfqs") patch.signage_package_confidence = review.signage_package_confidence;
    else patch.signage_potential = review.signage_package_confidence;
  }
  await svc.from(table).update(patch).eq("id", recordId);
}

// Normalise a tender row so the shared conversion review reads confidence from
// the tender's `signage_potential` column.
function tenderReviewRecord(tender: Record<string, unknown>): Record<string, unknown> {
  return {
    ...tender,
    signage_package_confidence: tender.signage_package_confidence ?? tender.signage_potential,
  };
}

type Handler = (
  payload: Record<string, unknown>,
  caller: { userId: string; roles: AppRole[] },
) => Promise<Response>;

// Supabase's built-in embeddings model (gte-small, 384 dims). Runs natively in
// the Edge runtime — no external embeddings API / key.
declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run: (
        input: string,
        opts: { mean_pool: boolean; normalize: boolean },
      ) => Promise<number[]>;
    };
  };
};
const embedSession = new Supabase.ai.Session("gte-small");
async function embed(text: string): Promise<number[]> {
  return await embedSession.run(text, { mean_pool: true, normalize: true });
}

function chunkText(text: string, size = 800): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += size) chunks.push(clean.slice(i, i + size));
  return chunks;
}

// Flatten a reference project into a single searchable string.
function referenceContent(r: Record<string, unknown>): string {
  return [
    r.name, r.project_type, r.city, r.sector, r.year,
    r.phc_scope, r.sign_types, r.materials, r.challenges, r.solutions,
  ]
    .filter((v) => v !== null && v !== undefined && v !== "")
    .join(" | ");
}

// ---- Direct RFQ / JIH workflow ----
const SALES_TRANSITIONS: Record<string, string[]> = {
  rfq_received: ["jih", "lost", "on_hold"],
  jih: ["under_negotiation", "verbally_awarded", "lost", "on_hold"],
  under_negotiation: ["verbally_awarded", "lost", "on_hold"],
  verbally_awarded: ["contract_received", "lost", "on_hold"],
  contract_received: ["won", "on_hold"],
  won: [],
  lost: [],
  on_hold: ["jih", "under_negotiation", "verbally_awarded", "rfq_received"],
};
// Stages that require manager sign-off (salespeople may only request them).
const SALES_GATED = new Set(["verbally_awarded", "contract_received", "won"]);
const STAGE_APPROVAL: Record<string, string> = {
  verbally_awarded: "VERBAL_AWARD_APPROVAL",
  contract_received: "CONTRACT_APPROVAL",
  won: "WON_APPROVAL",
};

// ---- Tender workflow ----
const TENDER_TRANSITIONS: Record<string, string[]> = {
  tender_identified: ["tender_under_process", "tender_lost_or_archived"],
  tender_under_process: ["award_negotiation", "awarded_to_contractor", "tender_lost_or_archived"],
  award_negotiation: ["awarded_to_contractor", "tender_lost_or_archived"],
  awarded_to_contractor: ["converted_to_jih", "tender_lost_or_archived"],
  converted_to_jih: [],
  tender_lost_or_archived: [],
};

async function logTransition(
  svc: ReturnType<typeof serviceClient>,
  recordType: string,
  recordId: string,
  from: string | null,
  to: string,
  actorId: string,
  notes?: string | null,
  evidence?: string | null,
  approvalId?: string | null,
) {
  await svc.from("stage_transition_history").insert({
    record_type: recordType,
    record_id: recordId,
    from_stage: from,
    to_stage: to,
    actor_id: actorId,
    notes: notes ?? null,
    evidence: evidence ?? null,
    approval_id: approvalId ?? null,
  });
}

function missing(fields: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((k) => {
    const v = fields[k];
    return v === undefined || v === null || String(v).trim() === "";
  });
}

// =============================================================================
// Sales-stage transition — shared between the direct manager path and the
// Approval Execution Engine so both enforce the SAME requirements and side
// effects.
// =============================================================================
function validateSalesStage(
  from: string,
  toStage: string,
  fields: Record<string, unknown>,
  notes: string | null,
  evidence: string | null,
): string | null {
  if (!(SALES_TRANSITIONS[from] ?? []).includes(toStage)) {
    return `Transition ${from} -> ${toStage} is not allowed`;
  }
  if (toStage === "under_negotiation" && !notes && !evidence) {
    return "Negotiation evidence (a note or evidence) is required";
  }
  if (toStage === "verbally_awarded") {
    const m = missing(fields, ["verbal_award_contact_name", "verbal_award_contact_title", "expected_contract_date"]);
    if (m.length) return `Missing for verbal award: ${m.join(", ")}`;
    if (!evidence && !fields.verbal_award_evidence) return "Verbal award evidence is required";
  }
  if (toStage === "contract_received") {
    const m = missing(fields, ["contract_value"]);
    if (m.length) return `Missing for contract: ${m.join(", ")}`;
    if (!fields.contract_document_url && !evidence) return "A signed contract/PO document is required";
  }
  if (toStage === "lost" && !fields.loss_reason) return "Loss reason is mandatory";
  if (toStage === "on_hold") {
    const m = missing(fields, ["hold_reason", "hold_review_date"]);
    if (m.length) return `Missing for hold: ${m.join(", ")}`;
  }
  return null;
}

async function applySalesStage(
  svc: ReturnType<typeof serviceClient>,
  opp: { id: string; owner_id: string | null },
  from: string,
  toStage: string,
  fields: Record<string, unknown>,
  notes: string | null,
  evidence: string | null,
  actorId: string,
  approvalId: string | null = null,
): Promise<{ from: string; to: string }> {
  const patch: Record<string, unknown> = { sales_stage: toStage, action_required: false };
  if (toStage === "verbally_awarded") {
    patch.verbal_award_contact_name = fields.verbal_award_contact_name;
    patch.verbal_award_contact_title = fields.verbal_award_contact_title;
    patch.verbal_award_method = fields.verbal_award_method ?? null;
    patch.verbal_award_date = fields.verbal_award_date ?? new Date().toISOString().slice(0, 10);
    patch.verbal_award_evidence = fields.verbal_award_evidence ?? evidence;
    patch.expected_contract_date = fields.expected_contract_date;
  }
  if (toStage === "contract_received") {
    patch.contract_value = fields.contract_value;
    patch.contract_reference_number = fields.contract_reference_number ?? null;
    patch.contract_received_date = fields.contract_received_date ?? new Date().toISOString().slice(0, 10);
  }
  if (toStage === "won") {
    patch.stage = "won";
    patch.handover_status = "pending";
  }
  if (toStage === "lost") {
    patch.stage = "lost";
    patch.loss_reason = fields.loss_reason;
    patch.loss_notes = fields.loss_notes ?? null;
  }
  if (toStage === "on_hold") {
    patch.hold_reason = fields.hold_reason;
    patch.hold_review_date = fields.hold_review_date;
  }
  const { error } = await svc.from("opportunities").update(patch).eq("id", opp.id);
  if (error) throw new Error(error.message);

  if (toStage === "won") {
    await svc.from("operations_handovers").insert({
      opportunity_id: opp.id,
      commercial_owner_id: opp.owner_id,
      handover_checklist_status: "pending",
      created_by: actorId,
    });
  }
  if (evidence || fields.verbal_award_evidence || fields.contract_document_url) {
    await svc.from("award_evidence").insert({
      linked_record_type: "opportunity",
      linked_record_id: opp.id,
      evidence_type: toStage,
      uploaded_by: actorId,
      document_url: (fields.contract_document_url as string) ?? null,
      note: evidence ?? (fields.verbal_award_evidence as string) ?? null,
      date_received: new Date().toISOString().slice(0, 10),
    });
  }
  await logTransition(svc, "opportunity", opp.id, from, toStage, actorId, notes, evidence, approvalId);
  await audit(svc, actorId, "sales_stage.changed", "opportunity", opp.id, { from, to: toStage });
  return { from, to: toStage };
}

// Create the JIH opportunity from an awarded tender. Does NOT touch approval
// state — the caller (engine or legacy handler) owns that.
async function executeTenderConversion(
  svc: ReturnType<typeof serviceClient>,
  tender: Record<string, unknown>,
  actorId: string,
  approvalId: string | null = null,
): Promise<{ id: string }> {
  const { data: opp, error } = await svc
    .from("opportunities")
    .insert({
      project_name: tender.tender_name,
      project_id: tender.project_id,
      main_contractor_id: tender.main_contractor_id,
      company_id: tender.main_contractor_id,
      estimated_value_max: tender.estimated_project_value,
      flow_type: "tender_converted",
      sales_stage: "jih",
      stage: "qualification",
      pipeline_step: "qualified_lead",
      owner_id: tender.tender_owner_id ?? actorId,
      created_by: actorId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  await svc
    .from("tenders")
    .update({ tender_stage: "converted_to_jih", converted_opportunity_id: opp.id })
    .eq("id", tender.id as string);
  await logTransition(svc, "tender", tender.id as string, "awarded_to_contractor", "converted_to_jih", actorId, null, null, approvalId);
  await logTransition(svc, "opportunity", opp.id, null, "jih", actorId);
  await audit(svc, actorId, "tender.converted", "tender", tender.id as string, { opportunity_id: opp.id });
  return opp as { id: string };
}

// =============================================================================
// Approval Execution Engine.
//
// Given an APPROVED approval, apply the original requested action exactly once,
// writing stage_transition_history + audit_log and stamping the execution
// fields. Business-rule failures are captured, not swallowed. Unknown / legacy
// approvals that carry no executable action are marked 'skipped' (the approval
// is still approved — this preserves pre-engine behaviour), never mutating data.
// =============================================================================
async function dispatchApprovalAction(
  svc: ReturnType<typeof serviceClient>,
  action: string,
  payload: Record<string, unknown>,
  actorId: string,
  approvalId: string,
): Promise<{ result: Record<string, unknown> }> {
  switch (action) {
    case "advance_sales_stage": {
      const opportunityId = String(payload.opportunityId ?? "");
      const toStage = String(payload.toStage ?? "");
      const fields = (payload.fields as Record<string, unknown>) ?? {};
      const notes = (payload.notes as string) ?? null;
      const evidence = (payload.evidence as string) ?? null;
      const { data: opp } = await svc
        .from("opportunities")
        .select("id, sales_stage, owner_id")
        .eq("id", opportunityId)
        .single();
      if (!opp) throw new Error("Target opportunity not found");
      const from = opp.sales_stage ?? "jih";
      const vErr = validateSalesStage(from, toStage, fields, notes, evidence);
      if (vErr) throw new Error(vErr);
      const res = await applySalesStage(svc, opp, from, toStage, fields, notes, evidence, actorId, approvalId);
      return { result: res };
    }
    case "set_win_confidence": {
      const opportunityId = String(payload.opportunityId ?? "");
      const value = String(payload.value ?? "");
      if (!opportunityId || !value) throw new Error("opportunityId and value are required");
      const { error } = await svc.from("opportunities").update({ win_confidence: value }).eq("id", opportunityId);
      if (error) throw new Error(error.message);
      await audit(svc, actorId, "win_confidence.set", "opportunity", opportunityId, { value });
      return { result: { win_confidence: value } };
    }
    case "execute_tender_conversion": {
      const tenderId = String(payload.tenderId ?? "");
      const { data: tender } = await svc.from("tenders").select("*").eq("id", tenderId).single();
      if (!tender) throw new Error("Target tender not found");
      if (tender.tender_stage === "converted_to_jih") throw new Error("Tender already converted");
      // Re-validate PHC rules server-side at execution time — no bypass.
      const review = reviewFromRecord(tenderReviewRecord(tender as Record<string, unknown>), {}, !!tender.main_contractor_id);
      const decision = evaluateConversion(review);
      if (decision.blocked.length) throw new Error(`Conversion blocked: ${decision.blocked.join(", ")}`);
      if (decision.requiresException) {
        const exId = (tender.below_300k_exception_approval_id as string | null) ?? null;
        let exApproved = false;
        if (exId) {
          const { data: ex } = await svc.from("approvals").select("status").eq("id", exId).single();
          exApproved = ex?.status === "approved";
        }
        if (!exApproved) throw new Error("Sub-300k conversion requires an approved executive exception");
      }
      const opp = await executeTenderConversion(svc, tender as Record<string, unknown>, actorId, approvalId);
      return { result: { opportunity_id: opp.id } };
    }
    case "assign_owner": {
      const opportunityId = String(payload.opportunityId ?? "");
      const newOwnerId = (payload.newOwnerId as string) || null;
      if (!opportunityId) throw new Error("opportunityId is required");
      const { error } = await svc.from("opportunities").update({ owner_id: newOwnerId }).eq("id", opportunityId);
      if (error) throw new Error(error.message);
      await audit(svc, actorId, "opportunity.assigned", "opportunity", opportunityId, { owner_id: newOwnerId });
      return { result: { owner_id: newOwnerId } };
    }
    case "update_opportunity_stage": {
      const opportunityId = String(payload.opportunityId ?? "");
      const stage = String(payload.stage ?? "");
      if (!opportunityId || !stage) throw new Error("opportunityId and stage are required");
      const { data: before } = await svc.from("opportunities").select("stage").eq("id", opportunityId).single();
      const { error } = await svc.from("opportunities").update({ stage }).eq("id", opportunityId);
      if (error) throw new Error(error.message);
      await logTransition(svc, "opportunity", opportunityId, before?.stage ?? null, stage, actorId, null, null, approvalId);
      await audit(svc, actorId, "opportunity.stage_changed", "opportunity", opportunityId, { stage });
      return { result: { stage } };
    }
    default:
      throw new Error(`No executor for action '${action}'`);
  }
}

async function runApprovalExecution(
  svc: ReturnType<typeof serviceClient>,
  approval: ApprovalRow,
  actorId: string,
): Promise<{ execution_status: string; reason?: string; error?: string; result?: Record<string, unknown> }> {
  const plan = planApprovalExecution(approval);
  const stamp = async (status: string, patch: Record<string, unknown> = {}) => {
    await svc
      .from("approvals")
      .update({ execution_status: status, executed_at: new Date().toISOString(), executed_by: actorId, ...patch })
      .eq("id", approval.id);
  };

  if (plan.kind === "error") {
    // not_approved / already_executed are guarded before we get here; the
    // remaining reasons mean "nothing to auto-execute" — record and move on.
    await stamp("skipped", { execution_error: `not_executed:${plan.reason}` });
    await audit(svc, actorId, "approval.execution_skipped", "approval", approval.id, { reason: plan.reason });
    return { execution_status: "skipped", reason: plan.reason };
  }
  if (plan.kind === "authorize_only") {
    await stamp("executed");
    await audit(svc, actorId, "approval.authorized", "approval", approval.id, { approval_type: plan.approvalType });
    return { execution_status: "executed" };
  }
  try {
    const { result } = await dispatchApprovalAction(svc, plan.action, plan.payload, actorId, approval.id);
    await stamp("executed", { execution_error: null });
    await audit(svc, actorId, "approval.executed", "approval", approval.id, { action: plan.action, ...result });
    return { execution_status: "executed", result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await stamp("failed", { execution_error: message });
    await audit(svc, actorId, "approval.execution_failed", "approval", approval.id, { action: plan.action, error: message });
    return { execution_status: "failed", error: message };
  }
}

// Approve an approval and run its execution atomically-ish. Idempotent: a
// second approve on an already-executed approval is a safe error.
async function approveAndExecute(
  svc: ReturnType<typeof serviceClient>,
  approvalId: string,
  actorId: string,
  notes: string | null,
): Promise<{ httpErr?: Response; approval?: unknown; execution?: unknown }> {
  const { data: current, error: cErr } = await svc.from("approvals").select("*").eq("id", approvalId).single();
  if (cErr || !current) return { httpErr: err("Approval not found", 404) };
  if (current.execution_status === "executed") {
    return { httpErr: err("This approval has already been executed", 409) };
  }
  const { data: approval, error: uErr } = await svc
    .from("approvals")
    .update({
      status: "approved",
      decision: "proceed",
      decision_notes: notes ?? current.decision_notes,
      decided_at: new Date().toISOString(),
    })
    .eq("id", approvalId)
    .select()
    .single();
  if (uErr || !approval) return { httpErr: err(uErr?.message ?? "Approval update failed", 400) };
  const execution = await runApprovalExecution(svc, approval as ApprovalRow, actorId);
  return { approval, execution };
}

const handlers: Record<string, Handler> = {
  // Manager decides a pending approval. On "approved" the ORIGINAL requested
  // action is executed by the Approval Execution Engine (once). "returned" and
  // "escalated" never execute anything.
  async decide_approval(payload, caller) {
    if (!canApproveCommercialAction(caller.roles)) return err("Commercial approval authority required", 403);
    const approvalId = String(payload.approvalId ?? "");
    const decision = String(payload.decision ?? "");
    const notes = (payload.notes as string) ?? null;
    if (!approvalId) return err("approvalId is required");
    const svc = serviceClient();

    if (decision === "approved") {
      const out = await approveAndExecute(svc, approvalId, caller.userId, notes);
      if (out.httpErr) return out.httpErr;
      await audit(svc, caller.userId, "approval.approved", "approval", approvalId, out.execution, caller.roles);
      return json({ ok: true, approval: out.approval, execution: out.execution });
    }

    const map: Record<string, { status: string; decision: string }> = {
      returned: { status: "returned", decision: "management_review" },
      escalated: { status: "escalated", decision: "management_review" },
    };
    const m = map[decision];
    if (!m) return err("Invalid decision");
    const { data, error } = await svc
      .from("approvals")
      .update({
        status: m.status,
        decision: m.decision,
        decision_notes: notes,
        decided_at: new Date().toISOString(),
      })
      .eq("id", approvalId)
      .select()
      .single();
    if (error) return err(error.message, 400);
    await audit(svc, caller.userId, `approval.${decision}`, "approval", approvalId, data, caller.roles);
    return json({ ok: true, approval: data });
  },

  // Close a quotation Won/Lost. Enforces the rule: no close without a reason,
  // and keeps the opportunity stage in sync.
  async close_quotation(payload, caller) {
    const quotationId = String(payload.quotationId ?? "");
    const status = String(payload.status ?? "");
    const reason = (payload.reason as string) ?? "";
    if (!quotationId) return err("quotationId is required");
    if (status !== "won" && status !== "lost") return err("status must be won or lost");
    if (!reason.trim()) return err("A win/loss reason is required to close a quotation");

    const svc = serviceClient();
    const { data: quote, error: qErr } = await svc
      .from("quotations")
      .select("id, owner_id, related_opportunity_id, status")
      .eq("id", quotationId)
      .single();
    if (qErr || !quote) return err("Quotation not found", 404);

    const isOwner = quote.owner_id === caller.userId;
    if (!isOwner && !canApproveCommercialAction(caller.roles)) {
      return err("Only the owner or a commercial manager can close this quotation", 403);
    }

    const { data, error } = await svc
      .from("quotations")
      .update({ status, win_loss_reason: reason })
      .eq("id", quotationId)
      .select()
      .single();
    if (error) return err(error.message, 400);
    await audit(svc, caller.userId, "quotation.status_changed", "quotation", quotationId, {
      status,
      reason,
    }, caller.roles);

    if (quote.related_opportunity_id) {
      await svc
        .from("opportunities")
        .update({ stage: status })
        .eq("id", quote.related_opportunity_id);
      await audit(
        svc,
        caller.userId,
        "opportunity.stage_changed",
        "opportunity",
        quote.related_opportunity_id,
        { stage: status, notes: `Auto-synced from quotation ${status}` },
        caller.roles,
      );
    }
    return json({ ok: true, quotation: data });
  },

  // Human-gated lead conversion (only from scored / human_review).
  async convert_lead(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const leadId = String(payload.leadId ?? "");
    if (!leadId) return err("leadId is required");
    const svc = serviceClient();
    const { data: lead, error: lErr } = await svc
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();
    if (lErr || !lead) return err("Lead not found", 404);
    if (lead.lead_stage !== "human_review" && lead.lead_stage !== "scored") {
      return err("Lead must reach 'scored' or 'human_review' before conversion", 409);
    }
    const { data: opp, error } = await svc
      .from("opportunities")
      .insert({
        project_name: lead.project_name,
        main_contractor: lead.main_contractor_guess,
        location: lead.location,
        estimated_value_max: lead.estimated_value,
        stage: "qualification",
        pipeline_step: "qualified_lead",
        owner_id: lead.owner_id ?? caller.userId,
        created_by: caller.userId,
      })
      .select()
      .single();
    if (error) return err(error.message, 400);
    await svc
      .from("leads")
      .update({ lead_stage: "converted", converted_opportunity_id: opp.id })
      .eq("id", leadId);
    await audit(svc, caller.userId, "lead.converted", "lead", leadId, { opportunity_id: opp.id }, caller.roles);
    return json({ ok: true, opportunity: opp });
  },

  // Reassign an account owner — managers only.
  async change_account_owner(payload, caller) {
    if (!canAssignOwner(caller.roles)) return err("Owner assignment authority required", 403);
    const companyId = String(payload.companyId ?? "");
    if (!companyId) return err("companyId is required");
    const newOwnerId = (payload.newOwnerId as string) || null;
    const svc = serviceClient();
    const { data, error } = await svc
      .from("companies")
      .update({ account_owner_id: newOwnerId })
      .eq("id", companyId)
      .select()
      .single();
    if (error) return err(error.message, 400);
    await audit(svc, caller.userId, "company.owner_changed", "company", companyId, {
      account_owner_id: newOwnerId,
    }, caller.roles);
    return json({ ok: true, company: data });
  },

  // Assign an opportunity owner directly — commercial managers only.
  async assign_owner(payload, caller) {
    if (!canAssignOwner(caller.roles)) return err("Owner assignment authority required", 403);
    const opportunityId = String(payload.opportunityId ?? "");
    if (!opportunityId) return err("opportunityId is required");
    const newOwnerId = (payload.ownerId as string) || (payload.newOwnerId as string) || null;
    const svc = serviceClient();
    const { error } = await svc.from("opportunities").update({ owner_id: newOwnerId }).eq("id", opportunityId);
    if (error) return err(error.message, 400);
    await audit(svc, caller.userId, "opportunity.assigned", "opportunity", opportunityId, {
      owner_id: newOwnerId,
      notes: (payload.notes as string) ?? null,
    }, caller.roles);
    return json({ ok: true, owner_id: newOwnerId });
  },

  // A pipeline operator without assignment authority REQUESTS an owner change.
  async request_owner_assignment(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const opportunityId = String(payload.opportunityId ?? "");
    if (!opportunityId) return err("opportunityId is required");
    const newOwnerId = (payload.ownerId as string) || (payload.newOwnerId as string) || null;
    const svc = serviceClient();
    const { data: appr } = await svc
      .from("approvals")
      .insert({
        related_opportunity_id: opportunityId,
        approval_type: "owner_assignment",
        requested_by: caller.userId,
        status: "pending",
        recommendation: "management_review",
        decision_notes: (payload.notes as string) ?? null,
        linked_record_type: "opportunity",
        linked_record_id: opportunityId,
        requested_action: "assign_owner",
        requested_payload: { opportunityId, newOwnerId },
      })
      .select()
      .single();
    await audit(svc, caller.userId, "owner_assignment.requested", "opportunity", opportunityId, {
      approval: appr?.id,
      owner_id: newOwnerId,
    }, caller.roles);
    return json({ ok: true, pending_approval: true, approval: appr });
  },

  // Change an opportunity's CRM stage. Commercial stages (won/lost/archived)
  // require commercial authority; everything else is allowed for the owner or a
  // pipeline manager. Never a direct client table write.
  async update_opportunity_stage(payload, caller) {
    const opportunityId = String(payload.opportunityId ?? "");
    const stage = String(payload.stage ?? "");
    if (!opportunityId || !stage) return err("opportunityId and stage are required");
    const COMMERCIAL_STAGES = new Set(["won", "lost", "archived"]);
    const svc = serviceClient();
    const { data: opp, error: oErr } = await svc
      .from("opportunities")
      .select("stage, owner_id")
      .eq("id", opportunityId)
      .single();
    if (oErr || !opp) return err("Opportunity not found", 404);

    if (COMMERCIAL_STAGES.has(stage)) {
      if (!canChangeCommercialStage(caller.roles)) {
        return err("Commercial stage changes require a manager or an approval", 403);
      }
    } else {
      const isOwner = opp.owner_id === caller.userId;
      if (!isOwner && !canManageSalesPipeline(caller.roles)) {
        return err("Only the owner or a sales manager can change the stage", 403);
      }
    }
    const { error } = await svc.from("opportunities").update({ stage }).eq("id", opportunityId);
    if (error) return err(error.message, 400);
    await logTransition(svc, "opportunity", opportunityId, opp.stage ?? null, stage, caller.userId, (payload.notes as string) ?? null);
    await audit(svc, caller.userId, "opportunity.stage_changed", "opportunity", opportunityId, { stage }, caller.roles);
    return json({ ok: true, stage });
  },

  // A pipeline operator REQUESTS a commercial stage change (approval-gated).
  async request_stage_change(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const opportunityId = String(payload.opportunityId ?? "");
    const stage = String(payload.stage ?? "");
    if (!opportunityId || !stage) return err("opportunityId and stage are required");
    const svc = serviceClient();
    const { data: appr } = await svc
      .from("approvals")
      .insert({
        related_opportunity_id: opportunityId,
        approval_type: "opportunity_stage_change",
        requested_by: caller.userId,
        status: "pending",
        recommendation: "management_review",
        decision_notes: (payload.notes as string) ?? null,
        linked_record_type: "opportunity",
        linked_record_id: opportunityId,
        requested_action: "update_opportunity_stage",
        requested_payload: { opportunityId, stage },
      })
      .select()
      .single();
    await audit(svc, caller.userId, "stage_change.requested", "opportunity", opportunityId, {
      approval: appr?.id,
      stage,
    }, caller.roles);
    return json({ ok: true, pending_approval: true, approval: appr });
  },

  // Accept an AI recommendation — the human-in-the-loop step. Opens the matching
  // approval when the recommendation names one. AI never acts directly.
  async accept_recommendation(payload, caller) {
    const recommendationId = String(payload.recommendationId ?? "");
    if (!recommendationId) return err("recommendationId is required");
    const svc = serviceClient();
    const { data: rec, error: rErr } = await svc
      .from("recommendations")
      .select("id, suggested_owner_id, required_approval_type, related_opportunity_id")
      .eq("id", recommendationId)
      .single();
    if (rErr || !rec) return err("Recommendation not found", 404);

    const isOwner = rec.suggested_owner_id === caller.userId;
    if (!isOwner && !canManageSalesPipeline(caller.roles)) {
      return err("Only the suggested owner or a sales manager can accept this", 403);
    }
    await svc.from("recommendations").update({ status: "accepted" }).eq("id", recommendationId);

    let approval = null;
    if (rec.required_approval_type && rec.related_opportunity_id) {
      const { data: appr } = await svc
        .from("approvals")
        .insert({
          related_opportunity_id: rec.related_opportunity_id,
          approval_type: rec.required_approval_type,
          requested_by: caller.userId,
          status: "pending",
          recommendation: "proceed",
        })
        .select()
        .single();
      approval = appr;
    }
    await audit(svc, caller.userId, "recommendation.accepted", "recommendation", recommendationId, {
      approval: rec.required_approval_type ?? null,
    }, caller.roles);
    return json({ ok: true, approval });
  },

  // Semantic search over the PHC knowledge base (any authenticated user).
  async search_knowledge(payload) {
    const query = String(payload.query ?? "").trim();
    if (!query) return err("query is required");
    const matchCount = Number(payload.matchCount ?? 5);
    const filterSourceType = (payload.filterSourceType as string) || null;
    const queryEmbedding = await embed(query);
    const svc = serviceClient();
    const { data, error } = await svc.rpc("match_knowledge", {
      query_embedding: queryEmbedding,
      match_count: matchCount,
      filter_source_type: filterSourceType,
    });
    if (error) return err(error.message, 400);
    return json({ ok: true, matches: data ?? [] });
  },

  // Index an arbitrary piece of knowledge (managers only).
  async index_knowledge(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const sourceType = String(payload.sourceType ?? "note");
    const content = String(payload.content ?? "").trim();
    if (!content) return err("content is required");
    const sourceId = (payload.sourceId as string) || null;
    const title = (payload.title as string) || null;
    const svc = serviceClient();
    const rows = chunkText(content).map(async (c) => ({
      source_type: sourceType,
      source_id: sourceId,
      title,
      content: c,
      embedding: await embed(c),
    }));
    const resolved = await Promise.all(rows);
    const { error } = await svc.from("knowledge_chunks").insert(resolved);
    if (error) return err(error.message, 400);
    await audit(svc, caller.userId, "knowledge.indexed", "knowledge_chunk", sourceId ?? sourceType, {
      chunks: resolved.length,
    }, caller.roles);
    return json({ ok: true, indexed: resolved.length });
  },

  // (Re)build the index for the Project Reference Library (managers only).
  async reindex_reference_library(_payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const svc = serviceClient();
    const { data: refs, error: rErr } = await svc.from("reference_projects").select("*");
    if (rErr) return err(rErr.message, 400);
    // Replace any existing reference-project chunks.
    await svc.from("knowledge_chunks").delete().eq("source_type", "reference_project");
    let indexed = 0;
    for (const r of refs ?? []) {
      const content = referenceContent(r as Record<string, unknown>);
      if (!content) continue;
      const embedding = await embed(content);
      const { error } = await svc.from("knowledge_chunks").insert({
        source_type: "reference_project",
        source_id: (r as { id: string }).id,
        title: (r as { name: string }).name,
        content,
        embedding,
      });
      if (!error) indexed++;
    }
    await audit(svc, caller.userId, "knowledge.reindexed", "knowledge_chunk", "reference_library", {
      indexed,
    }, caller.roles);
    return json({ ok: true, indexed });
  },

  // Convert an RFQ into a live JIH opportunity (RFQ_RECEIVED -> JIH).
  async convert_rfq_to_jih(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const rfqId = String(payload.rfqId ?? "");
    if (!rfqId) return err("rfqId is required");
    const svc = serviceClient();
    const { data: rfq, error: rErr } = await svc.from("rfqs").select("*").eq("id", rfqId).single();
    if (rErr || !rfq) return err("RFQ not found", 404);
    // Requirements for RFQ_RECEIVED -> JIH.
    const miss = missing(rfq as Record<string, unknown>, ["project_id", "company_id", "sales_owner_id"]);
    const fields = (payload.fields as Record<string, unknown>) ?? {};
    const signage = fields.signage_relevant ?? rfq.estimated_value;
    if (miss.length) return err(`Missing before JIH: ${miss.join(", ")}`, 409);
    if (!signage && !fields.value_pending) return err("Estimated value or 'pending verification' is required", 409);
    if (!fields.next_action || !fields.follow_up_date) return err("Next action and follow-up date are required", 409);

    // PHC conversion rules (shared engine with tenders).
    const review = reviewFromRecord(rfq as Record<string, unknown>, (payload.review as Record<string, unknown>) ?? {}, !!rfq.company_id);
    await persistConversionReview(svc, "rfqs", rfqId, review);
    const decision = evaluateConversion(review);
    if (decision.blocked.length) {
      await audit(svc, caller.userId, "rfq.conversion_blocked", "rfq", rfqId, { reasons: decision.blocked }, caller.roles);
      return err(`Conversion blocked: ${decision.blocked.join(", ")}`, 409, { reasons: decision.blocked });
    }
    if (decision.requiresException) {
      const exId = (rfq.below_300k_exception_approval_id as string | null) ?? null;
      let exApproved = false;
      if (exId) {
        const { data: ex } = await svc.from("approvals").select("status").eq("id", exId).single();
        exApproved = ex?.status === "approved";
      }
      if (!exApproved) {
        const { data: exAppr } = await svc
          .from("approvals")
          .insert({
            approval_type: "below_300k_exception",
            requested_by: caller.userId,
            status: "pending",
            recommendation: "management_review",
            decision_notes: review.conversion_reason,
            linked_record_type: "rfq",
            linked_record_id: rfqId,
          })
          .select()
          .single();
        await svc.from("rfqs").update({ below_300k_exception_approval_id: exAppr?.id }).eq("id", rfqId);
        await audit(svc, caller.userId, "rfq.exception_requested", "rfq", rfqId, { approval: exAppr?.id }, caller.roles);
        return json({ ok: true, pending_exception: true, approval: exAppr });
      }
    }

    const { data: opp, error } = await svc
      .from("opportunities")
      .insert({
        project_name: String(fields.project_name ?? rfq.rfq_number ?? "RFQ Opportunity"),
        company_id: rfq.company_id,
        project_id: rfq.project_id,
        estimated_value_max: rfq.estimated_value,
        flow_type: "direct_rfq",
        sales_stage: "jih",
        stage: "qualification",
        pipeline_step: "qualified_lead",
        owner_id: rfq.sales_owner_id ?? caller.userId,
        next_action: String(fields.next_action ?? ""),
        next_action_due: (fields.follow_up_date as string) ?? null,
        created_by: caller.userId,
      })
      .select()
      .single();
    if (error) return err(error.message, 400);
    await svc.from("rfqs").update({ status: "converted", opportunity_id: opp.id }).eq("id", rfqId);
    await logTransition(svc, "opportunity", opp.id, "rfq_received", "jih", caller.userId);
    await audit(svc, caller.userId, "rfq.converted_to_jih", "rfq", rfqId, { opportunity_id: opp.id }, caller.roles);
    return json({ ok: true, opportunity: opp });
  },

  // Advance an opportunity along the sales_stage pipeline with requirement +
  // approval enforcement. Gated stages requested by a salesperson create an
  // approval instead of changing the stage.
  async advance_sales_stage(payload, caller) {
    const opportunityId = String(payload.opportunityId ?? "");
    const toStage = String(payload.toStage ?? "");
    if (!opportunityId || !toStage) return err("opportunityId and toStage are required");
    const fields = (payload.fields as Record<string, unknown>) ?? {};
    const notes = (payload.notes as string) ?? null;
    const evidence = (payload.evidence as string) ?? null;

    const svc = serviceClient();
    const { data: opp, error: oErr } = await svc
      .from("opportunities")
      .select("id, sales_stage, owner_id")
      .eq("id", opportunityId)
      .single();
    if (oErr || !opp) return err("Opportunity not found", 404);
    const from = opp.sales_stage ?? "jih";

    // Requirements are enforced identically for both the direct path and the
    // approval-execution path (validateSalesStage is shared).
    const vErr = validateSalesStage(from, toStage, fields, notes, evidence);
    if (vErr) return err(vErr, 409);

    // Manager gate: a salesperson only REQUESTS a gated stage. The full request
    // payload is persisted so the Approval Execution Engine can apply it later.
    const isManager = canChangeCommercialStage(caller.roles);
    if (SALES_GATED.has(toStage) && !isManager) {
      const { data: appr } = await svc
        .from("approvals")
        .insert({
          related_opportunity_id: opportunityId,
          approval_type: STAGE_APPROVAL[toStage],
          requested_by: caller.userId,
          status: "pending",
          recommendation: "management_review",
          decision_notes: notes,
          linked_record_type: "opportunity",
          linked_record_id: opportunityId,
          requested_action: "advance_sales_stage",
          requested_payload: { opportunityId, toStage, fields, notes, evidence },
        })
        .select()
        .single();
      await svc.from("opportunities").update({ action_required: true }).eq("id", opportunityId);
      await audit(svc, caller.userId, "sales_stage.requested", "opportunity", opportunityId, {
        to: toStage,
        approval: appr?.id,
      }, caller.roles);
      return json({ ok: true, pending_approval: true, approval: appr });
    }

    // Direct apply (manager or non-gated stage).
    const res = await applySalesStage(svc, opp, from, toStage, fields, notes, evidence, caller.userId);
    return json({ ok: true, ...res });
  },

  // Set win confidence. SURE_WIN requires evidence + manager approval.
  async set_win_confidence(payload, caller) {
    const opportunityId = String(payload.opportunityId ?? "");
    const value = String(payload.value ?? "");
    if (!opportunityId || !value) return err("opportunityId and value are required");
    const svc = serviceClient();
    if (value === "sure_win" && !canApproveCommercialAction(caller.roles)) {
      if (!payload.evidence) return err("Sure Win requires documented evidence", 409);
      const { data: appr } = await svc
        .from("approvals")
        .insert({
          related_opportunity_id: opportunityId,
          approval_type: "SURE_WIN_APPROVAL",
          requested_by: caller.userId,
          status: "pending",
          recommendation: "management_review",
          decision_notes: String(payload.evidence),
          linked_record_type: "opportunity",
          linked_record_id: opportunityId,
          requested_action: "set_win_confidence",
          requested_payload: { opportunityId, value },
        })
        .select()
        .single();
      await audit(svc, caller.userId, "win_confidence.requested", "opportunity", opportunityId, { value }, caller.roles);
      return json({ ok: true, pending_approval: true, approval: appr });
    }
    const { error } = await svc.from("opportunities").update({ win_confidence: value }).eq("id", opportunityId);
    if (error) return err(error.message, 400);
    await audit(svc, caller.userId, "win_confidence.set", "opportunity", opportunityId, { value }, caller.roles);
    return json({ ok: true, win_confidence: value });
  },

  // Advance a tender along its monitoring flow.
  async advance_tender_stage(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const tenderId = String(payload.tenderId ?? "");
    const toStage = String(payload.toStage ?? "");
    if (!tenderId || !toStage) return err("tenderId and toStage are required");
    const fields = (payload.fields as Record<string, unknown>) ?? {};
    const svc = serviceClient();
    const { data: tender, error: tErr } = await svc.from("tenders").select("*").eq("id", tenderId).single();
    if (tErr || !tender) return err("Tender not found", 404);
    const from = tender.tender_stage;
    if (!(TENDER_TRANSITIONS[from] ?? []).includes(toStage)) {
      return err(`Transition ${from} -> ${toStage} is not allowed`, 409);
    }
    if (toStage === "awarded_to_contractor") {
      if (!fields.main_contractor_id && !tender.main_contractor_id) return err("Winning contractor must be identified", 409);
      if (!fields.award_evidence && !tender.award_evidence) return err("Award evidence is required", 409);
    }
    if (toStage === "tender_lost_or_archived" && !fields.archive_reason) {
      return err("Archive or loss reason is mandatory", 409);
    }
    const patch: Record<string, unknown> = { tender_stage: toStage };
    if (fields.main_contractor_id) patch.main_contractor_id = fields.main_contractor_id;
    if (fields.award_evidence) patch.award_evidence = fields.award_evidence;
    if (fields.archive_reason) patch.archive_reason = fields.archive_reason;
    const { error } = await svc.from("tenders").update(patch).eq("id", tenderId);
    if (error) return err(error.message, 400);
    await logTransition(svc, "tender", tenderId, from, toStage, caller.userId, (fields.notes as string) ?? null);
    await audit(svc, caller.userId, "tender_stage.changed", "tender", tenderId, { from, to: toStage }, caller.roles);
    return json({ ok: true, from, to: toStage });
  },

  // Request conversion of an AWARDED tender into a JIH opportunity. Creates a
  // DRAFT review + approval — never a live opportunity automatically.
  async request_tender_conversion(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const tenderId = String(payload.tenderId ?? "");
    if (!tenderId) return err("tenderId is required");
    const svc = serviceClient();
    const { data: tender, error: tErr } = await svc.from("tenders").select("*").eq("id", tenderId).single();
    if (tErr || !tender) return err("Tender not found", 404);
    if (tender.tender_stage !== "awarded_to_contractor") {
      return err("Tender must be 'awarded_to_contractor' before conversion review", 409);
    }

    // Build + persist the PHC conversion review (UI answers over stored columns).
    const override = (payload.review as Record<string, unknown>) ?? {};
    const review = reviewFromRecord(tenderReviewRecord(tender as Record<string, unknown>), override, !!tender.main_contractor_id);
    await persistConversionReview(svc, "tenders", tenderId, review);
    const decision = evaluateConversion(review);

    // Hard blocks: never convert. Clear reason codes + audit.
    if (decision.blocked.length) {
      await audit(svc, caller.userId, "tender.conversion_blocked", "tender", tenderId, { reasons: decision.blocked }, caller.roles);
      return err(`Conversion blocked: ${decision.blocked.join(", ")}`, 409, { reasons: decision.blocked });
    }

    // Sub-300k signage value: requires an executive exception approval first.
    if (decision.requiresException) {
      const exId = (tender.below_300k_exception_approval_id as string | null) ?? null;
      let exApproved = false;
      if (exId) {
        const { data: ex } = await svc.from("approvals").select("status").eq("id", exId).single();
        exApproved = ex?.status === "approved";
      }
      if (!exApproved) {
        const { data: exAppr } = await svc
          .from("approvals")
          .insert({
            approval_type: "below_300k_exception",
            requested_by: caller.userId,
            status: "pending",
            recommendation: "management_review",
            decision_notes: review.conversion_reason,
            linked_record_type: "tender",
            linked_record_id: tenderId,
          })
          .select()
          .single();
        await svc.from("tenders").update({ below_300k_exception_approval_id: exAppr?.id }).eq("id", tenderId);
        await audit(svc, caller.userId, "tender.exception_requested", "tender", tenderId, {
          approval: exAppr?.id,
          estimated_signage_value: review.estimated_signage_value,
        }, caller.roles);
        return json({ ok: true, pending_exception: true, approval: exAppr });
      }
    }

    // Passed all gates (or has an approved exception): create the JIH approval.
    const { data: appr } = await svc
      .from("approvals")
      .insert({
        approval_type: "TENDER_TO_JIH_APPROVAL",
        requested_by: caller.userId,
        status: "pending",
        recommendation: "management_review",
        decision_notes: review.conversion_reason ?? (payload.notes as string) ?? null,
        linked_record_type: "tender",
        linked_record_id: tenderId,
        requested_action: "execute_tender_conversion",
        requested_payload: { tenderId },
      })
      .select()
      .single();
    await audit(svc, caller.userId, "tender.conversion_requested", "tender", tenderId, { approval: appr?.id }, caller.roles);
    return json({ ok: true, pending_approval: true, approval: appr });
  },

  // Manager approves a tender conversion — creates the JIH opportunity. Routes
  // through the Approval Execution Engine when an approval id is supplied (the
  // normal path), guaranteeing single execution + consistent audit. Falls back
  // to a direct conversion only when no approval record exists.
  async approve_tender_conversion(payload, caller) {
    if (!canApproveCommercialAction(caller.roles)) return err("Commercial approval authority required", 403);
    const tenderId = String(payload.tenderId ?? "");
    const approvalId = (payload.approvalId as string) || null;
    const svc = serviceClient();

    if (approvalId) {
      const out = await approveAndExecute(svc, approvalId, caller.userId, (payload.notes as string) ?? null);
      if (out.httpErr) return out.httpErr;
      await audit(svc, caller.userId, "approval.approved", "approval", approvalId, out.execution, caller.roles);
      return json({ ok: true, approval: out.approval, execution: out.execution });
    }

    if (!tenderId) return err("tenderId is required");
    const { data: tender, error: tErr } = await svc.from("tenders").select("*").eq("id", tenderId).single();
    if (tErr || !tender) return err("Tender not found", 404);
    if (tender.tender_stage === "converted_to_jih") return err("Tender already converted", 409);
    const opp = await executeTenderConversion(svc, tender as Record<string, unknown>, caller.userId, null);
    return json({ ok: true, opportunity: opp });
  },

  // ===== AI agent layer (real data only) =====================================

  // Lead Scoring Engine — scores real leads and records evidence-backed
  // recommendations for the promising ones. No external model.
  async run_lead_scoring(_payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const svc = serviceClient();
    const runId = await startAgentRun(svc, "lead_scoring", caller.userId);
    const { data: leads } = await svc
      .from("leads")
      .select("id, project_name, main_contractor_guess, project_stage_estimate, signage_potential, estimated_value, location, source, lead_stage")
      .not("lead_stage", "in", "(converted,rejected)");
    let created = 0;
    for (const l of leads ?? []) {
      const r = scoreLead(l as Record<string, unknown>);
      await svc.from("lead_scores").insert({
        lead_id: (l as { id: string }).id,
        run_id: runId,
        score: r.score,
        band: r.band,
        reason_codes: r.reason_codes,
        evidence: r.evidence,
        missing_information: r.missing_information,
        next_best_action: r.next_best_action,
      });
      await svc.from("leads").update({ lead_score: r.score }).eq("id", (l as { id: string }).id);
      // Only surface a recommendation when there is something to act on.
      if (r.band === "hot" || r.band === "warm" || r.missing_information.length >= 3) {
        const rec = await writeRecommendation(
          svc,
          {
            agent_key: "lead_scoring",
            run_id: runId,
            title: `Lead score ${r.score} (${r.band}) — ${(l as { project_name?: string }).project_name ?? "lead"}`,
            recommendation: r.next_best_action,
            rationale: `Reason codes: ${r.reason_codes.join(", ")}`,
            confidence: r.score,
            severity: r.band === "hot" ? "high" : r.band === "warm" ? "medium" : "low",
            entity_type: "lead",
            entity_id: (l as { id: string }).id,
            suggested_action: "qualify_lead",
            missing_data: r.missing_information,
          },
          r.evidence.map((e) => ({
            label: e.label,
            field: e.field,
            value: e.value,
            source_type: "record",
            source_ref: `leads:${(l as { id: string }).id}`,
            weight: e.weight,
          })),
        );
        if (rec) created++;
      }
    }
    await finishAgentRun(svc, runId, {
      status: "completed",
      records_scanned: (leads ?? []).length,
      recommendations_created: created,
      summary: `Scored ${(leads ?? []).length} leads, ${created} recommendations.`,
    });
    await audit(svc, caller.userId, "ai.lead_scoring_run", "ai_agent_run", runId ?? "lead_scoring", { created }, caller.roles);
    return json({ ok: true, run_id: runId, scored: (leads ?? []).length, recommendations: created });
  },

  // Duplicate Detection — groups likely-duplicate companies with explanations.
  // Never auto-merges.
  async run_duplicate_detection(_payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const svc = serviceClient();
    const runId = await startAgentRun(svc, "duplicate_detection", caller.userId);
    const { data: companies } = await svc
      .from("companies")
      .select("id, name, website_domain, cr_number, phone, email");
    const groups = findDuplicateGroups((companies ?? []) as DupRecord[], "company");
    let created = 0;
    for (const g of groups) {
      const { data: grp } = await svc
        .from("duplicate_groups")
        .insert({
          entity_type: g.entity_type,
          match_reason: g.match_reason,
          matched_fields: g.matched_fields,
          confidence: g.confidence * 100,
          run_id: runId,
        })
        .select("id")
        .single();
      if (!grp) continue;
      await svc.from("duplicate_group_members").insert(
        g.members.map((m) => ({
          group_id: (grp as { id: string }).id,
          entity_type: g.entity_type,
          entity_id: m.entity_id,
          display_label: m.display_label,
        })),
      );
      await writeRecommendation(
        svc,
        {
          agent_key: "duplicate_detection",
          run_id: runId,
          title: `Possible duplicate: ${g.members.map((m) => m.display_label).join(" / ")}`,
          recommendation: "Review these records and merge if they are the same entity.",
          rationale: g.match_reason,
          confidence: g.confidence * 100,
          severity: g.confidence >= 0.9 ? "high" : "medium",
          entity_type: "company",
          entity_id: g.members[0].entity_id,
          suggested_action: "review_merge",
        },
        g.members.map((m) => ({
          label: "Duplicate member",
          field: g.matched_fields.join(","),
          value: m.display_label,
          source_type: "record",
          source_ref: `companies:${m.entity_id}`,
          weight: g.confidence * 100,
        })),
      );
      created++;
    }
    await finishAgentRun(svc, runId, {
      status: "completed",
      records_scanned: (companies ?? []).length,
      recommendations_created: created,
      summary: `Found ${created} duplicate groups across ${(companies ?? []).length} companies.`,
    });
    await audit(svc, caller.userId, "ai.duplicate_detection_run", "ai_agent_run", runId ?? "dupe", { created }, caller.roles);
    return json({ ok: true, run_id: runId, groups: created });
  },

  // AI Weekly Report — aggregated from real database data only.
  async generate_ai_weekly_report(_payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const svc = serviceClient();
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const count = async (q: Promise<{ count: number | null }>) => (await q).count ?? 0;
    const report = {
      new_leads: await count(svc.from("leads").select("id", { count: "exact", head: true }).gte("created_at", weekAgo) as never),
      pending_approvals: await count(svc.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending") as never),
      open_duplicate_groups: await count(svc.from("duplicate_groups").select("id", { count: "exact", head: true }).eq("status", "open") as never),
      open_risk_flags: await count(svc.from("opportunity_flags").select("id", { count: "exact", head: true }).eq("status", "open").eq("flag_kind", "risk") as never),
      pending_ai_recommendations: await count(svc.from("ai_recommendations").select("id", { count: "exact", head: true }).eq("status", "pending") as never),
    };
    await audit(svc, caller.userId, "ai.weekly_report", "system", "ai_weekly_report", report, caller.roles);
    return json({ ok: true, generated_at: new Date().toISOString(), report });
  },

  // Human decision on an AI recommendation. AI never applies sensitive actions
  // itself — accepting a sensitive one opens an approval instead.
  async ai_recommendation_feedback(payload, caller) {
    const recommendationId = String(payload.recommendationId ?? "");
    const action = String(payload.action ?? "");
    const valid = ["accept", "dismiss", "request_review", "create_task", "create_approval"];
    if (!recommendationId || !valid.includes(action)) return err("recommendationId and a valid action are required");
    const svc = serviceClient();
    const { data: rec } = await svc.from("ai_recommendations").select("*").eq("id", recommendationId).single();
    if (!rec) return err("Recommendation not found", 404);

    const statusMap: Record<string, string> = {
      accept: "accepted",
      dismiss: "dismissed",
      request_review: "review_requested",
      create_task: "actioned",
      create_approval: "review_requested",
    };
    await svc.from("ai_recommendations").update({ status: statusMap[action] }).eq("id", recommendationId);
    await svc.from("ai_agent_feedback").insert({
      recommendation_id: recommendationId,
      user_id: caller.userId,
      action,
      note: (payload.note as string) ?? null,
    });

    // If acting is sensitive, spawn an approval rather than applying anything.
    let approval = null;
    if (action === "create_approval" || (action === "accept" && rec.required_approval_type)) {
      const { data: appr } = await svc
        .from("approvals")
        .insert({
          related_opportunity_id: rec.entity_type === "opportunity" ? rec.entity_id : null,
          approval_type: rec.required_approval_type ?? "ai_recommendation",
          requested_by: caller.userId,
          status: "pending",
          recommendation: "management_review",
          decision_notes: rec.title,
          linked_record_type: rec.entity_type,
          linked_record_id: rec.entity_id,
        })
        .select()
        .single();
      approval = appr;
    }
    await audit(svc, caller.userId, `ai_recommendation.${action}`, "ai_recommendation", recommendationId, {
      approval: approval?.id ?? null,
    }, caller.roles);
    return json({ ok: true, status: statusMap[action], approval });
  },

  // ----- Agents whose external dependency is not configured (honest scaffolds) -
  async run_data_cleanup(_payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    return notConfiguredRun(serviceClient(), "data_cleanup", caller.userId, "Data Cleanup Agent scaffold — enrichment source not configured.");
  },
  async run_project_radar(_payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    return notConfiguredRun(serviceClient(), "project_radar", caller.userId, "Project Radar signal source not configured; use ProTenders manual import.");
  },
  async run_protenders_ingest(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const svc = serviceClient();
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
      const colProjectName    = findCol(headers, "project", "مشروع");
      const colContractor     = findCol(headers, "contractor", "مقاول");
      const colPackage        = findCol(headers, "package", "حزمة");
      const colStage          = findCol(headers, "stage", "مرحلة");
      const colDate           = findCol(headers, "date", "تاريخ");
      const colValue          = findCol(headers, "value", "قيمة");
      const colLocation       = findCol(headers, "location", "موقع");

      rows = lines.slice(1).map((line) => {
        const cells = parseCSVLine(line);
        return {
          project_name:     colProjectName  >= 0 ? cells[colProjectName]  ?? null : null,
          main_contractor:  colContractor   >= 0 ? cells[colContractor]   ?? null : null,
          package:          colPackage      >= 0 ? cells[colPackage]      ?? null : null,
          stage:            colStage        >= 0 ? cells[colStage]        ?? null : null,
          source_date:      colDate         >= 0 ? cells[colDate]         ?? null : null,
          value:            colValue        >= 0 ? cells[colValue]        ?? null : null,
          location:         colLocation     >= 0 ? cells[colLocation]     ?? null : null,
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
          import_id:        importId,
          project_name:     (r.project_name as string)    ?? null,
          main_contractor:  (r.main_contractor as string) ?? null,
          package:          (r.package as string)         ?? null,
          stage:            (r.stage as string)           ?? null,
          source_date:      (r.source_date as string)     ?? null,
          evidence_url:     (r.evidence_url as string)    ?? null,
          evidence_text:    (r.evidence_text as string)   ?? null,
          raw:              r,
        })),
      );

      // Auto-create leads for active/tender/open stage rows
      const activeKeywords = ["active", "tender", "مناقصة", "open"];
      const leadRows = rows.filter((r) => {
        const stage = String(r.stage ?? "").toLowerCase();
        return activeKeywords.some((kw) => stage.includes(kw));
      });

      if (leadRows.length > 0) {
        await svc.from("leads").insert(
          leadRows.map((r) => ({
            project_name:        (r.project_name as string)   ?? "Unknown",
            location:            (r.location as string)       ?? null,
            main_contractor_guess: (r.main_contractor as string) ?? null,
            source:              "protenders",
            created_by:          caller.userId,
          })),
        );
      }

      await audit(svc, caller.userId, "ai.protenders_ingest", "protenders_import", importId, { rows: rows.length, leads_created: leadRows.length }, caller.roles);
      return json({ ok: true, import_id: importId, ingested: rows.length, leads_created: leadRows.length });
    }

    await audit(svc, caller.userId, "ai.protenders_ingest", "protenders_import", "failed", { rows: rows.length }, caller.roles);
    return err("Failed to create import record", 500);
  },
  async run_boq_extraction(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);

    const opportunityId = (payload.opportunity_id as string) ?? "";
    if (!opportunityId) return err("opportunity_id required", 400);
    if (!payload.file_path && (!Array.isArray(payload.rows) || !(payload.rows as unknown[]).length)) {
      return err("Provide file_path or rows", 400);
    }

    const svc = serviceClient();

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
      const colCode  = findCol(headers, "code", "item_code", "رقم", "كود");
      const colDesc  = findCol(headers, "description", "desc", "item", "وصف", "البند");
      const colUnit  = findCol(headers, "unit", "وحدة");
      const colQty   = findCol(headers, "qty", "quantity", "كمية");
      const colPrice = findCol(headers, "price", "unit_price", "سعر");

      rows = lines.slice(1).map((line) => {
        const cells = parseCSVLine(line);
        return {
          item_code:  colCode  >= 0 ? cells[colCode]  ?? null : null,
          description: colDesc  >= 0 ? cells[colDesc]  ?? null : null,
          unit:       colUnit  >= 0 ? cells[colUnit]  ?? null : null,
          quantity:   colQty   >= 0 ? parseFloat(cells[colQty]  ?? "0") || 0 : 0,
          unit_price: colPrice >= 0 ? parseFloat(cells[colPrice] ?? "0") || 0 : 0,
        };
      });
    } else {
      rows = (payload.rows as BoqRow[]).map((r) => ({
        item_code:   (r.item_code  as string) ?? null,
        description: (r.description as string) ?? null,
        unit:        (r.unit       as string) ?? null,
        quantity:    parseFloat(String(r.quantity  ?? 0)) || 0,
        unit_price:  parseFloat(String(r.unit_price ?? 0)) || 0,
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
          boq_id:      boqId,
          sign_type:   r.description ?? r.item_code ?? "Unknown",
          item_source: r.item_code   ?? null,
          unit:        r.unit        ?? null,
          quantity:    r.quantity,
          unit_rate:   r.unit_price,
          cost_estimate: r.quantity * r.unit_price,
          sort_order:  idx + 1,
          confidence:  "medium" as const,
        })),
      );
    }

    // Update BOQ estimated_value and updated_at
    await svc
      .from("boqs")
      .update({ estimated_value: totalValue, updated_at: new Date().toISOString() })
      .eq("id", boqId);

    await audit(svc, caller.userId, "ai.boq_extraction", "boq", boqId, { items: rows.length, total_value: totalValue }, caller.roles);
    return json({ ok: true, boq_id: boqId, items_count: rows.length, total_value: totalValue });
  },
  async run_contact_mapping(_payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    return notConfiguredRun(serviceClient(), "contact_mapping", caller.userId, "Contact Mapping Agent scaffold — enrichment source not configured.");
  },
  async run_risk_finance(_payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    return notConfiguredRun(serviceClient(), "risk_finance", caller.userId, "Risk & Finance Agent scaffold — pending finance data feed.");
  },
  async run_smart_followup(_payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    return notConfiguredRun(serviceClient(), "smart_followup", caller.userId, "Smart Follow-up Agent scaffold — drafting model not configured. Never sends automatically.");
  },

  // Evaluate the time-based automation rules and raise Sales Action Queue
  // items (opportunity_flags rows). Intended to be called on a schedule
  // (pg_cron / n8n) or manually by a manager. This is the Sprint 5 "daily
  // action engine" — it reuses the same table/route the pre-existing 3
  // rules already fed (Action Center), just tags every item with a
  // queue_action_type so the UI can group/filter by the Sprint 5 vocabulary.
  // 'missing_data' is deliberately not raised here — it is already produced
  // by the Sprint 4 scoring engine (recomputeOpportunityScore -> syncScoreFlags)
  // whenever a score is (re)computed, so it is not duplicated in this loop.
  async run_automations(_payload, caller) {
    if (!canRunSensitiveSalesAction(caller.roles)) return err("Sensitive-action authority required", 403);
    const svc = serviceClient();
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
    await audit(svc, caller.userId, "automations.run", "system", null, { raised }, caller.roles);
    return json({ ok: true, raised });
  },

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
  async archive_record(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const entityType = String(payload.entityType ?? "");
    const entityId = String(payload.entityId ?? "");
    const guard = validateArchiveTarget(entityType, entityId);
    if (!guard.ok) return err(guard.reason);
    const reason = (payload.reason as string) ?? null;
    const svc = serviceClient();
    const { data, error } = await svc
      .from(entityType)
      .update({ archived_at: new Date().toISOString(), archived_by: caller.userId, archive_reason: reason })
      .eq("id", entityId)
      .select()
      .single();
    if (error) return err(error.message, 400);
    await audit(svc, caller.userId, `${entityType}.archived`, entityType, entityId, { reason }, caller.roles);
    return json({ ok: true, record: data });
  },

  // Reverse of archive_record — clears the three archive columns. Same
  // authority as archiving.
  async unarchive_record(payload, caller) {
    if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
    const entityType = String(payload.entityType ?? "");
    const entityId = String(payload.entityId ?? "");
    const guard = validateArchiveTarget(entityType, entityId);
    if (!guard.ok) return err(guard.reason);
    const svc = serviceClient();
    const { data, error } = await svc
      .from(entityType)
      .update({ archived_at: null, archived_by: null, archive_reason: null })
      .eq("id", entityId)
      .select()
      .single();
    if (error) return err(error.message, 400);
    await audit(svc, caller.userId, `${entityType}.unarchived`, entityType, entityId, {}, caller.roles);
    return json({ ok: true, record: data });
  },

  // Any sales contributor may request a delete — this only opens an
  // approval, never touches the record. "delete_record" is deliberately NOT
  // in EXECUTABLE_ACTIONS (see _shared/approvals.ts), so a manager approving
  // this via decide_approval never auto-deletes — it only unblocks
  // execute_delete below, a genuinely separate step by a different role.
  // Opportunities are rejected here — see validateDeleteRequest — they use
  // stage='archived' instead; request a stage change via
  // update_opportunity_stage. Rejects a second active request for the same
  // record (see one_active_delete_request_per_record in the migration —
  // this check gives a clean error; the partial unique index is what
  // actually guarantees it under concurrent requests).
  async request_delete(payload, caller) {
    if (!canCreateSalesRecords(caller.roles)) return err("Sales role required", 403);
    const entityType = String(payload.entityType ?? "");
    const entityId = String(payload.entityId ?? "");
    const guard = validateDeleteRequest(entityType, entityId);
    if (!guard.ok) return err(guard.reason);
    const reason = (payload.reason as string) ?? null;
    const svc = serviceClient();

    const { data: existingRequests, error: exErr } = await svc
      .from("approvals")
      .select("status, execution_status")
      .eq("requested_action", "delete_record")
      .eq("linked_record_type", entityType)
      .eq("linked_record_id", entityId);
    if (exErr) return err(exErr.message, 400);
    const alreadyActive = (existingRequests ?? []).some((r: { status: string; execution_status: string | null }) =>
      isActiveDeleteRequestStatus(r.status, r.execution_status),
    );
    if (alreadyActive) {
      return err("A delete request for this record is already pending or approved", 409);
    }

    const { data: appr, error } = await svc
      .from("approvals")
      .insert({
        approval_type: "delete_request",
        requested_by: caller.userId,
        status: "pending",
        decision_notes: reason,
        linked_record_type: entityType,
        linked_record_id: entityId,
        requested_action: "delete_record",
        requested_payload: { entityType, entityId, reason },
      })
      .select()
      .single();
    if (error) {
      // Race fallback: two concurrent requests both pass the check above —
      // the partial unique index rejects the second insert (Postgres 23505).
      if ((error as { code?: string }).code === "23505") {
        return err("A delete request for this record is already pending or approved", 409);
      }
      return err(error.message, 400);
    }
    await audit(svc, caller.userId, "delete.requested", entityType, entityId, { approval: appr?.id, reason }, caller.roles);
    return json({ ok: true, pending_approval: true, approval: appr });
  },

  // The ONLY path that actually deletes a row. system_admin only, and only
  // once a commercial manager has approved the linked delete_request
  // approval — two separate steps by two different roles. Delegates
  // entirely to the atomic public.execute_approved_record_delete(...)
  // Postgres function (see the Sprint 8 migration): loading the
  // before-snapshot, deleting, verifying the rowcount, marking the approval
  // executed, and writing the audit row all happen in ONE transaction there.
  // This handler performs NO direct delete/update/audit calls of its own —
  // if the RPC call fails for any reason, nothing changed.
  async execute_delete(payload, caller) {
    if (!canExecuteDelete(caller.roles)) return err("System admin authority required", 403);
    const approvalId = String(payload.approvalId ?? "");
    if (!approvalId) return err("approvalId is required");
    const svc = serviceClient();

    const { data, error } = await svc.rpc("execute_approved_record_delete", {
      _approval_id: approvalId,
      _actor_id: caller.userId,
    });
    if (error) return err(error.message, 409);
    return json(data);
  },

  // Mark a record as a probable duplicate of another. Low blast radius (no
  // data is touched), so any sales contributor may flag one. A commercial
  // manager later resolves the group — this never auto-merges. Both records
  // must exist in the same table, and there must not already be an open
  // duplicate group linking this exact pair.
  async flag_duplicate(payload, caller) {
    if (!canCreateSalesRecords(caller.roles)) return err("Sales role required", 403);
    const entityType = String(payload.entityType ?? "");
    const entityId = String(payload.entityId ?? "");
    const duplicateOfId = String(payload.duplicateOfId ?? "");
    const guard = validateDuplicatePair(entityType, entityId, duplicateOfId);
    if (!guard.ok) return err(guard.reason);

    const svc = serviceClient();

    // Both records must actually exist, in the same table (entityType is a
    // single parameter shared by both ids, so "same table" holds by
    // construction — this confirms both ids are real rows in it).
    const { data: existingRows, error: exErr } = await svc
      .from(entityType)
      .select("id")
      .in("id", [entityId, duplicateOfId]);
    if (exErr) return err(exErr.message, 400);
    const foundIds = new Set((existingRows ?? []).map((r: { id: string }) => r.id));
    if (!foundIds.has(entityId)) return err(`Record not found: ${entityType}/${entityId}`, 404);
    if (!foundIds.has(duplicateOfId)) return err(`Record not found: ${entityType}/${duplicateOfId}`, 404);

    // Prevent a duplicate OPEN group for the exact same pair.
    const { data: members } = await svc
      .from("duplicate_group_members")
      .select("group_id, entity_id")
      .eq("entity_type", entityType)
      .in("entity_id", [entityId, duplicateOfId]);
    const candidateGroupIds = [...new Set((members ?? []).map((m: { group_id: string }) => m.group_id))];
    if (candidateGroupIds.length > 0) {
      const { data: openGroups } = await svc
        .from("duplicate_groups")
        .select("id")
        .in("id", candidateGroupIds)
        .eq("status", "open");
      const openGroupIds = new Set((openGroups ?? []).map((g: { id: string }) => g.id));
      const perGroupCount = new Map<string, number>();
      for (const m of members ?? []) {
        if (openGroupIds.has(m.group_id)) perGroupCount.set(m.group_id, (perGroupCount.get(m.group_id) ?? 0) + 1);
      }
      const alreadyPaired = [...perGroupCount.values()].some((c) => c >= 2);
      if (alreadyPaired) return err("An open duplicate group already links these two records", 409);
    }

    const reason = (payload.reason as string) ?? null;
    const { data: group, error: gErr } = await svc
      .from("duplicate_groups")
      .insert({ entity_type: entityType, match_reason: reason ?? "Manually flagged", status: "open" })
      .select("id")
      .single();
    if (gErr || !group) return err(gErr?.message ?? "Could not create duplicate group", 400);
    const { error: mErr } = await svc.from("duplicate_group_members").insert([
      { group_id: group.id, entity_type: entityType, entity_id: entityId },
      { group_id: group.id, entity_type: entityType, entity_id: duplicateOfId },
    ]);
    if (mErr) return err(mErr.message, 400);
    await audit(svc, caller.userId, "duplicate.flagged", entityType, entityId, {
      group_id: group.id,
      duplicate_of: duplicateOfId,
    }, caller.roles);
    return json({ ok: true, group_id: group.id });
  },

  // A commercial manager resolves an open duplicate group. "merged" records
  // the decision only — no field-level merge or child-record relinking is
  // performed; that remains a manual follow-up, out of scope for this sprint.
  async resolve_duplicate_group(payload, caller) {
    if (!canApproveCommercialAction(caller.roles)) return err("Commercial approval authority required", 403);
    const groupId = String(payload.groupId ?? "");
    const resolution = String(payload.resolution ?? "");
    if (!groupId) return err("groupId is required");
    if (resolution !== "merged" && resolution !== "dismissed") {
      return err("resolution must be 'merged' or 'dismissed'");
    }
    const svc = serviceClient();
    const { data, error } = await svc
      .from("duplicate_groups")
      .update({ status: resolution })
      .eq("id", groupId)
      .select()
      .single();
    if (error) return err(error.message, 400);
    await audit(svc, caller.userId, "duplicate.resolved", "duplicate_group", groupId, { resolution }, caller.roles);
    return json({ ok: true, group: data });
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed", 405);

  // Reject oversized bodies before parsing — prevents DoS via huge JSON payloads.
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > 1_048_576) return err("Request body exceeds 1 MB limit", 413);

  let body: { action?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body");
  }
  const action = body.action ?? "";
  const handler = handlers[action];
  if (!handler) return err(`Unknown action: ${action}`, 404);

  let caller;
  try {
    caller = await resolveCaller(req.headers.get("Authorization"));
  } catch (e) {
    const ex = e as { status?: number; message?: string };
    return err(ex.message ?? "Unauthorized", ex.status ?? 401);
  }

  try {
    return await handler(body.payload ?? {}, caller);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Internal error", 500);
  }
});
