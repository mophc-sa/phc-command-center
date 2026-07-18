// Shared domain services used by the vertical sales-os-api modules.
import { json, err } from "../_shared/respond.ts";
import { serviceClient, audit } from "../_shared/supabase.ts";
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

export {
  json,
  err,
  canApproveCommercialAction,
  canAssignOwner,
  canChangeCommercialStage,
  canCreateSalesRecords,
  canExecuteDelete,
  canManageSalesPipeline,
  canRunSensitiveSalesAction,
  isActiveDeleteRequestStatus,
  validateArchiveTarget,
  validateDeleteRequest,
  validateDuplicatePair,
  evaluateConversion,
  reviewFromRecord,
  scoreLead,
  findDuplicateGroups,
};
export type { DupRecord };

// Write an AI recommendation with its evidence items in one place. Every
// recommendation MUST carry at least one evidence item.
export async function writeRecommendation(
  svc: ReturnType<typeof serviceClient>,
  rec: Record<string, unknown>,
  evidence: Record<string, unknown>[],
): Promise<{ id: string } | null> {
  const { data } = await svc.from("ai_recommendations").insert(rec).select().single();
  if (data && evidence.length) {
    await svc
      .from("ai_evidence_items")
      .insert(evidence.map((e) => ({ recommendation_id: data.id, ...e })));
  }
  return data as { id: string } | null;
}

// Record an agent run row and return its id.
export async function startAgentRun(
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

export async function finishAgentRun(
  svc: ReturnType<typeof serviceClient>,
  runId: string | null,
  patch: Record<string, unknown>,
) {
  if (!runId) return;
  await svc
    .from("ai_agent_runs")
    .update({ completed_at: new Date().toISOString(), ...patch })
    .eq("id", runId);
}

// Honest scaffold for an agent whose external dependency is not configured.
// Records a not_configured run — never fabricated output.
export async function notConfiguredRun(
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
export async function persistConversionReview(
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
export function tenderReviewRecord(tender: Record<string, unknown>): Record<string, unknown> {
  return {
    ...tender,
    signage_package_confidence: tender.signage_package_confidence ?? tender.signage_potential,
  };
}

// Supabase's built-in embeddings model (gte-small, 384 dims). Runs natively in
// the Edge runtime — no external embeddings API / key.
declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run: (input: string, opts: { mean_pool: boolean; normalize: boolean }) => Promise<number[]>;
    };
  };
};
const embedSession = new Supabase.ai.Session("gte-small");
export async function embed(text: string): Promise<number[]> {
  return await embedSession.run(text, { mean_pool: true, normalize: true });
}

export function chunkText(text: string, size = 800): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += size) chunks.push(clean.slice(i, i + size));
  return chunks;
}

// Flatten a reference project into a single searchable string.
export function referenceContent(r: Record<string, unknown>): string {
  return [
    r.name,
    r.project_type,
    r.city,
    r.sector,
    r.year,
    r.phc_scope,
    r.sign_types,
    r.materials,
    r.challenges,
    r.solutions,
  ]
    .filter((v) => v !== null && v !== undefined && v !== "")
    .join(" | ");
}

// ---- Direct RFQ / JIH workflow ----
export const SALES_TRANSITIONS: Record<string, string[]> = {
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
export const SALES_GATED = new Set(["verbally_awarded", "contract_received", "won"]);
export const STAGE_APPROVAL: Record<string, string> = {
  verbally_awarded: "VERBAL_AWARD_APPROVAL",
  contract_received: "CONTRACT_APPROVAL",
  won: "WON_APPROVAL",
};

// ---- Tender workflow ----
export const TENDER_TRANSITIONS: Record<string, string[]> = {
  tender_identified: ["tender_under_process", "tender_lost_or_archived"],
  tender_under_process: ["award_negotiation", "awarded_to_contractor", "tender_lost_or_archived"],
  award_negotiation: ["awarded_to_contractor", "tender_lost_or_archived"],
  awarded_to_contractor: ["converted_to_jih", "tender_lost_or_archived"],
  converted_to_jih: [],
  tender_lost_or_archived: [],
};

export async function logTransition(
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

export function missing(fields: Record<string, unknown>, keys: string[]): string[] {
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
export function validateSalesStage(
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
    const m = missing(fields, [
      "verbal_award_contact_name",
      "verbal_award_contact_title",
      "expected_contract_date",
    ]);
    if (m.length) return `Missing for verbal award: ${m.join(", ")}`;
    if (!evidence && !fields.verbal_award_evidence) return "Verbal award evidence is required";
  }
  if (toStage === "contract_received") {
    const m = missing(fields, ["contract_value"]);
    if (m.length) return `Missing for contract: ${m.join(", ")}`;
    if (!fields.contract_document_url && !evidence)
      return "A signed contract/PO document is required";
  }
  if (toStage === "lost" && !fields.loss_reason) return "Loss reason is mandatory";
  if (toStage === "on_hold") {
    const m = missing(fields, ["hold_reason", "hold_review_date"]);
    if (m.length) return `Missing for hold: ${m.join(", ")}`;
  }
  return null;
}

export async function applySalesStage(
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
    patch.contract_received_date =
      fields.contract_received_date ?? new Date().toISOString().slice(0, 10);
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
  await logTransition(
    svc,
    "opportunity",
    opp.id,
    from,
    toStage,
    actorId,
    notes,
    evidence,
    approvalId,
  );
  await audit(svc, actorId, "sales_stage.changed", "opportunity", opp.id, { from, to: toStage });
  return { from, to: toStage };
}

// Create the JIH opportunity from an awarded tender. Does NOT touch approval
// state — the caller (engine or legacy handler) owns that.
export async function executeTenderConversion(
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
  await logTransition(
    svc,
    "tender",
    tender.id as string,
    "awarded_to_contractor",
    "converted_to_jih",
    actorId,
    null,
    null,
    approvalId,
  );
  await logTransition(svc, "opportunity", opp.id, null, "jih", actorId);
  await audit(svc, actorId, "tender.converted", "tender", tender.id as string, {
    opportunity_id: opp.id,
  });
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
export async function dispatchApprovalAction(
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
      const res = await applySalesStage(
        svc,
        opp,
        from,
        toStage,
        fields,
        notes,
        evidence,
        actorId,
        approvalId,
      );
      return { result: res };
    }
    case "set_win_confidence": {
      const opportunityId = String(payload.opportunityId ?? "");
      const value = String(payload.value ?? "");
      if (!opportunityId || !value) throw new Error("opportunityId and value are required");
      const { error } = await svc
        .from("opportunities")
        .update({ win_confidence: value })
        .eq("id", opportunityId);
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
      const review = reviewFromRecord(
        tenderReviewRecord(tender as Record<string, unknown>),
        {},
        !!tender.main_contractor_id,
      );
      const decision = evaluateConversion(review);
      if (decision.blocked.length)
        throw new Error(`Conversion blocked: ${decision.blocked.join(", ")}`);
      if (decision.requiresException) {
        const exId = (tender.below_300k_exception_approval_id as string | null) ?? null;
        let exApproved = false;
        if (exId) {
          const { data: ex } = await svc.from("approvals").select("status").eq("id", exId).single();
          exApproved = ex?.status === "approved";
        }
        if (!exApproved)
          throw new Error("Sub-300k conversion requires an approved executive exception");
      }
      const opp = await executeTenderConversion(
        svc,
        tender as Record<string, unknown>,
        actorId,
        approvalId,
      );
      return { result: { opportunity_id: opp.id } };
    }
    case "assign_owner": {
      const opportunityId = String(payload.opportunityId ?? "");
      const newOwnerId = (payload.newOwnerId as string) || null;
      if (!opportunityId) throw new Error("opportunityId is required");
      const { error } = await svc
        .from("opportunities")
        .update({ owner_id: newOwnerId })
        .eq("id", opportunityId);
      if (error) throw new Error(error.message);
      await audit(svc, actorId, "opportunity.assigned", "opportunity", opportunityId, {
        owner_id: newOwnerId,
      });
      return { result: { owner_id: newOwnerId } };
    }
    case "update_opportunity_stage": {
      const opportunityId = String(payload.opportunityId ?? "");
      const stage = String(payload.stage ?? "");
      if (!opportunityId || !stage) throw new Error("opportunityId and stage are required");
      const { data: before } = await svc
        .from("opportunities")
        .select("stage")
        .eq("id", opportunityId)
        .single();
      const { error } = await svc.from("opportunities").update({ stage }).eq("id", opportunityId);
      if (error) throw new Error(error.message);
      await logTransition(
        svc,
        "opportunity",
        opportunityId,
        before?.stage ?? null,
        stage,
        actorId,
        null,
        null,
        approvalId,
      );
      await audit(svc, actorId, "opportunity.stage_changed", "opportunity", opportunityId, {
        stage,
      });
      return { result: { stage } };
    }
    default:
      throw new Error(`No executor for action '${action}'`);
  }
}

export async function runApprovalExecution(
  svc: ReturnType<typeof serviceClient>,
  approval: ApprovalRow,
  actorId: string,
): Promise<{
  execution_status: string;
  reason?: string;
  error?: string;
  result?: Record<string, unknown>;
}> {
  const plan = planApprovalExecution(approval);
  const stamp = async (status: string, patch: Record<string, unknown> = {}) => {
    await svc
      .from("approvals")
      .update({
        execution_status: status,
        executed_at: new Date().toISOString(),
        executed_by: actorId,
        ...patch,
      })
      .eq("id", approval.id);
  };

  if (plan.kind === "error") {
    // not_approved / already_executed are guarded before we get here; the
    // remaining reasons mean "nothing to auto-execute" — record and move on.
    await stamp("skipped", { execution_error: `not_executed:${plan.reason}` });
    await audit(svc, actorId, "approval.execution_skipped", "approval", approval.id, {
      reason: plan.reason,
    });
    return { execution_status: "skipped", reason: plan.reason };
  }
  if (plan.kind === "authorize_only") {
    await stamp("executed");
    await audit(svc, actorId, "approval.authorized", "approval", approval.id, {
      approval_type: plan.approvalType,
    });
    return { execution_status: "executed" };
  }
  try {
    const { result } = await dispatchApprovalAction(
      svc,
      plan.action,
      plan.payload,
      actorId,
      approval.id,
    );
    await stamp("executed", { execution_error: null });
    await audit(svc, actorId, "approval.executed", "approval", approval.id, {
      action: plan.action,
      ...result,
    });
    return { execution_status: "executed", result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await stamp("failed", { execution_error: message });
    await audit(svc, actorId, "approval.execution_failed", "approval", approval.id, {
      action: plan.action,
      error: message,
    });
    return { execution_status: "failed", error: message };
  }
}

// Approve an approval and run its execution atomically-ish. Idempotent: a
// second approve on an already-executed approval is a safe error.
export async function approveAndExecute(
  svc: ReturnType<typeof serviceClient>,
  approvalId: string,
  actorId: string,
  notes: string | null,
): Promise<{ httpErr?: Response; approval?: unknown; execution?: unknown }> {
  const { data: current, error: cErr } = await svc
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .single();
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
