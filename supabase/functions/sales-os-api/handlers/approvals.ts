import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import {
  json,
  err,
  canApproveCommercialAction,
  canManageSalesPipeline,
  evaluateConversion,
  reviewFromRecord,
  persistConversionReview,
  tenderReviewRecord,
  executeTenderConversion,
  approveAndExecute,
} from "../shared.ts";

async function decide_approval(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canApproveCommercialAction(caller.roles))
    return err("Commercial approval authority required", 403);
  const approvalId = String(payload.approvalId ?? "");
  const decision = String(payload.decision ?? "");
  const notes = (payload.notes as string) ?? null;
  if (!approvalId) return err("approvalId is required");
  const svc = ctx.svc;

  if (decision === "approved") {
    const out = await approveAndExecute(svc, approvalId, caller.userId, notes);
    if (out.httpErr) return out.httpErr;
    await auditLog(
      svc,
      caller.userId,
      "approval.approved",
      "approval",
      approvalId,
      out.execution,
      caller.roles,
    );
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
  await auditLog(
    svc,
    caller.userId,
    `approval.${decision}`,
    "approval",
    approvalId,
    data,
    caller.roles,
  );
  return json({ ok: true, approval: data });
}

// Close a quotation Won/Lost. Enforces the rule: no close without a reason,
// and keeps the opportunity stage in sync.

async function request_owner_assignment(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const opportunityId = String(payload.opportunityId ?? "");
  if (!opportunityId) return err("opportunityId is required");
  const newOwnerId = (payload.ownerId as string) || (payload.newOwnerId as string) || null;
  const svc = ctx.svc;
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
  await auditLog(
    svc,
    caller.userId,
    "owner_assignment.requested",
    "opportunity",
    opportunityId,
    {
      approval: appr?.id,
      owner_id: newOwnerId,
    },
    caller.roles,
  );
  return json({ ok: true, pending_approval: true, approval: appr });
}

// Change an opportunity's CRM stage. Commercial stages (won/lost/archived)
// require commercial authority; everything else is allowed for the owner or a
// pipeline manager. Never a direct client table write.

async function request_stage_change(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const opportunityId = String(payload.opportunityId ?? "");
  const stage = String(payload.stage ?? "");
  if (!opportunityId || !stage) return err("opportunityId and stage are required");
  const svc = ctx.svc;
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
  await auditLog(
    svc,
    caller.userId,
    "stage_change.requested",
    "opportunity",
    opportunityId,
    {
      approval: appr?.id,
      stage,
    },
    caller.roles,
  );
  return json({ ok: true, pending_approval: true, approval: appr });
}

// Accept an AI recommendation — the human-in-the-loop step. Opens the matching
// approval when the recommendation names one. AI never acts directly.

async function request_tender_conversion(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const tenderId = String(payload.tenderId ?? "");
  if (!tenderId) return err("tenderId is required");
  const svc = ctx.svc;
  const { data: tender, error: tErr } = await svc
    .from("tenders")
    .select("*")
    .eq("id", tenderId)
    .single();
  if (tErr || !tender) return err("Tender not found", 404);
  if (tender.tender_stage !== "awarded_to_contractor") {
    return err("Tender must be 'awarded_to_contractor' before conversion review", 409);
  }

  // Build + persist the PHC conversion review (UI answers over stored columns).
  const override = (payload.review as Record<string, unknown>) ?? {};
  const review = reviewFromRecord(
    tenderReviewRecord(tender as Record<string, unknown>),
    override,
    !!tender.main_contractor_id,
  );
  await persistConversionReview(svc, "tenders", tenderId, review);
  const decision = evaluateConversion(review);

  // Hard blocks: never convert. Clear reason codes + audit.
  if (decision.blocked.length) {
    await auditLog(
      svc,
      caller.userId,
      "tender.conversion_blocked",
      "tender",
      tenderId,
      { reasons: decision.blocked },
      caller.roles,
    );
    return err(`Conversion blocked: ${decision.blocked.join(", ")}`, 409, {
      reasons: decision.blocked,
    });
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
      await svc
        .from("tenders")
        .update({ below_300k_exception_approval_id: exAppr?.id })
        .eq("id", tenderId);
      await auditLog(
        svc,
        caller.userId,
        "tender.exception_requested",
        "tender",
        tenderId,
        {
          approval: exAppr?.id,
          estimated_signage_value: review.estimated_signage_value,
        },
        caller.roles,
      );
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
  await auditLog(
    svc,
    caller.userId,
    "tender.conversion_requested",
    "tender",
    tenderId,
    { approval: appr?.id },
    caller.roles,
  );
  return json({ ok: true, pending_approval: true, approval: appr });
}

// Manager approves a tender conversion — creates the JIH opportunity. Routes
// through the Approval Execution Engine when an approval id is supplied (the
// normal path), guaranteeing single execution + consistent audit. Falls back
// to a direct conversion only when no approval record exists.

async function approve_tender_conversion(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canApproveCommercialAction(caller.roles))
    return err("Commercial approval authority required", 403);
  const tenderId = String(payload.tenderId ?? "");
  const approvalId = (payload.approvalId as string) || null;
  const svc = ctx.svc;

  if (approvalId) {
    const out = await approveAndExecute(
      svc,
      approvalId,
      caller.userId,
      (payload.notes as string) ?? null,
    );
    if (out.httpErr) return out.httpErr;
    await auditLog(
      svc,
      caller.userId,
      "approval.approved",
      "approval",
      approvalId,
      out.execution,
      caller.roles,
    );
    return json({ ok: true, approval: out.approval, execution: out.execution });
  }

  if (!tenderId) return err("tenderId is required");
  const { data: tender, error: tErr } = await svc
    .from("tenders")
    .select("*")
    .eq("id", tenderId)
    .single();
  if (tErr || !tender) return err("Tender not found", 404);
  if (tender.tender_stage === "converted_to_jih") return err("Tender already converted", 409);
  const opp = await executeTenderConversion(
    svc,
    tender as Record<string, unknown>,
    caller.userId,
    null,
  );
  return json({ ok: true, opportunity: opp });
}

// ===== AI agent layer (real data only) =====================================

// Lead Scoring Engine — scores real leads and records evidence-backed
// recommendations for the promising ones. No external model.

export const approvalsModule: HandlerModule = {
  name: "approvals",
  handlers: {
    decide_approval,
    request_owner_assignment,
    request_stage_change,
    request_tender_conversion,
    approve_tender_conversion,
  },
};
