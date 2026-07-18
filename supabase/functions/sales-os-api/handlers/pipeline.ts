import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import {
  json,
  err,
  canApproveCommercialAction,
  canAssignOwner,
  canChangeCommercialStage,
  canManageSalesPipeline,
  evaluateConversion,
  reviewFromRecord,
  persistConversionReview,
  SALES_GATED,
  STAGE_APPROVAL,
  TENDER_TRANSITIONS,
  logTransition,
  missing,
  validateSalesStage,
  applySalesStage,
} from "../shared.ts";

async function close_quotation(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  const quotationId = String(payload.quotationId ?? "");
  const status = String(payload.status ?? "");
  const reason = (payload.reason as string) ?? "";
  if (!quotationId) return err("quotationId is required");
  if (status !== "won" && status !== "lost") return err("status must be won or lost");
  if (!reason.trim()) return err("A win/loss reason is required to close a quotation");

  const svc = ctx.svc;
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
  await auditLog(
    svc,
    caller.userId,
    "quotation.status_changed",
    "quotation",
    quotationId,
    {
      status,
      reason,
    },
    caller.roles,
  );

  if (quote.related_opportunity_id) {
    await svc
      .from("opportunities")
      .update({ stage: status })
      .eq("id", quote.related_opportunity_id);
    await auditLog(
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
}

// Human-gated lead conversion (only from scored / human_review).

async function convert_lead(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const leadId = String(payload.leadId ?? "");
  if (!leadId) return err("leadId is required");
  const svc = ctx.svc;
  const { data: lead, error: lErr } = await svc.from("leads").select("*").eq("id", leadId).single();
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
  await auditLog(
    svc,
    caller.userId,
    "lead.converted",
    "lead",
    leadId,
    { opportunity_id: opp.id },
    caller.roles,
  );
  return json({ ok: true, opportunity: opp });
}

// Reassign an account owner — managers only.

async function change_account_owner(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canAssignOwner(caller.roles)) return err("Owner assignment authority required", 403);
  const companyId = String(payload.companyId ?? "");
  if (!companyId) return err("companyId is required");
  const newOwnerId = (payload.newOwnerId as string) || null;
  const svc = ctx.svc;
  const { data, error } = await svc
    .from("companies")
    .update({ account_owner_id: newOwnerId })
    .eq("id", companyId)
    .select()
    .single();
  if (error) return err(error.message, 400);
  await auditLog(
    svc,
    caller.userId,
    "company.owner_changed",
    "company",
    companyId,
    {
      account_owner_id: newOwnerId,
    },
    caller.roles,
  );
  return json({ ok: true, company: data });
}

// Assign an opportunity owner directly — commercial managers only.

async function assign_owner(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canAssignOwner(caller.roles)) return err("Owner assignment authority required", 403);
  const opportunityId = String(payload.opportunityId ?? "");
  if (!opportunityId) return err("opportunityId is required");
  const newOwnerId = (payload.ownerId as string) || (payload.newOwnerId as string) || null;
  const svc = ctx.svc;
  const { error } = await svc
    .from("opportunities")
    .update({ owner_id: newOwnerId })
    .eq("id", opportunityId);
  if (error) return err(error.message, 400);
  await auditLog(
    svc,
    caller.userId,
    "opportunity.assigned",
    "opportunity",
    opportunityId,
    {
      owner_id: newOwnerId,
      notes: (payload.notes as string) ?? null,
    },
    caller.roles,
  );
  return json({ ok: true, owner_id: newOwnerId });
}

// A pipeline operator without assignment authority REQUESTS an owner change.

async function update_opportunity_stage(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  const opportunityId = String(payload.opportunityId ?? "");
  const stage = String(payload.stage ?? "");
  if (!opportunityId || !stage) return err("opportunityId and stage are required");
  const COMMERCIAL_STAGES = new Set(["won", "lost", "archived"]);
  const svc = ctx.svc;
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
  await logTransition(
    svc,
    "opportunity",
    opportunityId,
    opp.stage ?? null,
    stage,
    caller.userId,
    (payload.notes as string) ?? null,
  );
  await auditLog(
    svc,
    caller.userId,
    "opportunity.stage_changed",
    "opportunity",
    opportunityId,
    { stage },
    caller.roles,
  );
  return json({ ok: true, stage });
}

// A pipeline operator REQUESTS a commercial stage change (approval-gated).

async function convert_rfq_to_jih(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const rfqId = String(payload.rfqId ?? "");
  if (!rfqId) return err("rfqId is required");
  const svc = ctx.svc;
  const { data: rfq, error: rErr } = await svc.from("rfqs").select("*").eq("id", rfqId).single();
  if (rErr || !rfq) return err("RFQ not found", 404);
  // Requirements for RFQ_RECEIVED -> JIH.
  const miss = missing(rfq as Record<string, unknown>, [
    "project_id",
    "company_id",
    "sales_owner_id",
  ]);
  const fields = (payload.fields as Record<string, unknown>) ?? {};
  const signage = fields.signage_relevant ?? rfq.estimated_value;
  if (miss.length) return err(`Missing before JIH: ${miss.join(", ")}`, 409);
  if (!signage && !fields.value_pending)
    return err("Estimated value or 'pending verification' is required", 409);
  if (!fields.next_action || !fields.follow_up_date)
    return err("Next action and follow-up date are required", 409);

  // PHC conversion rules (shared engine with tenders).
  const review = reviewFromRecord(
    rfq as Record<string, unknown>,
    (payload.review as Record<string, unknown>) ?? {},
    !!rfq.company_id,
  );
  await persistConversionReview(svc, "rfqs", rfqId, review);
  const decision = evaluateConversion(review);
  if (decision.blocked.length) {
    await auditLog(
      svc,
      caller.userId,
      "rfq.conversion_blocked",
      "rfq",
      rfqId,
      { reasons: decision.blocked },
      caller.roles,
    );
    return err(`Conversion blocked: ${decision.blocked.join(", ")}`, 409, {
      reasons: decision.blocked,
    });
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
      await svc
        .from("rfqs")
        .update({ below_300k_exception_approval_id: exAppr?.id })
        .eq("id", rfqId);
      await auditLog(
        svc,
        caller.userId,
        "rfq.exception_requested",
        "rfq",
        rfqId,
        { approval: exAppr?.id },
        caller.roles,
      );
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
  await auditLog(
    svc,
    caller.userId,
    "rfq.converted_to_jih",
    "rfq",
    rfqId,
    { opportunity_id: opp.id },
    caller.roles,
  );
  return json({ ok: true, opportunity: opp });
}

// Advance an opportunity along the sales_stage pipeline with requirement +
// approval enforcement. Gated stages requested by a salesperson create an
// approval instead of changing the stage.

async function advance_sales_stage(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  const opportunityId = String(payload.opportunityId ?? "");
  const toStage = String(payload.toStage ?? "");
  if (!opportunityId || !toStage) return err("opportunityId and toStage are required");
  const fields = (payload.fields as Record<string, unknown>) ?? {};
  const notes = (payload.notes as string) ?? null;
  const evidence = (payload.evidence as string) ?? null;

  const svc = ctx.svc;
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
    await auditLog(
      svc,
      caller.userId,
      "sales_stage.requested",
      "opportunity",
      opportunityId,
      {
        to: toStage,
        approval: appr?.id,
      },
      caller.roles,
    );
    return json({ ok: true, pending_approval: true, approval: appr });
  }

  // Direct apply (manager or non-gated stage).
  const res = await applySalesStage(
    svc,
    opp,
    from,
    toStage,
    fields,
    notes,
    evidence,
    caller.userId,
  );
  return json({ ok: true, ...res });
}

// Set win confidence. SURE_WIN requires evidence + manager approval.

async function set_win_confidence(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  const opportunityId = String(payload.opportunityId ?? "");
  const value = String(payload.value ?? "");
  if (!opportunityId || !value) return err("opportunityId and value are required");
  const svc = ctx.svc;
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
    await auditLog(
      svc,
      caller.userId,
      "win_confidence.requested",
      "opportunity",
      opportunityId,
      { value },
      caller.roles,
    );
    return json({ ok: true, pending_approval: true, approval: appr });
  }
  const { error } = await svc
    .from("opportunities")
    .update({ win_confidence: value })
    .eq("id", opportunityId);
  if (error) return err(error.message, 400);
  await auditLog(
    svc,
    caller.userId,
    "win_confidence.set",
    "opportunity",
    opportunityId,
    { value },
    caller.roles,
  );
  return json({ ok: true, win_confidence: value });
}

// Advance a tender along its monitoring flow.

async function advance_tender_stage(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const tenderId = String(payload.tenderId ?? "");
  const toStage = String(payload.toStage ?? "");
  if (!tenderId || !toStage) return err("tenderId and toStage are required");
  const fields = (payload.fields as Record<string, unknown>) ?? {};
  const svc = ctx.svc;
  const { data: tender, error: tErr } = await svc
    .from("tenders")
    .select("*")
    .eq("id", tenderId)
    .single();
  if (tErr || !tender) return err("Tender not found", 404);
  const from = tender.tender_stage;
  if (!(TENDER_TRANSITIONS[from] ?? []).includes(toStage)) {
    return err(`Transition ${from} -> ${toStage} is not allowed`, 409);
  }
  if (toStage === "awarded_to_contractor") {
    if (!fields.main_contractor_id && !tender.main_contractor_id)
      return err("Winning contractor must be identified", 409);
    if (!fields.award_evidence && !tender.award_evidence)
      return err("Award evidence is required", 409);
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
  await logTransition(
    svc,
    "tender",
    tenderId,
    from,
    toStage,
    caller.userId,
    (fields.notes as string) ?? null,
  );
  await auditLog(
    svc,
    caller.userId,
    "tender_stage.changed",
    "tender",
    tenderId,
    { from, to: toStage },
    caller.roles,
  );
  return json({ ok: true, from, to: toStage });
}

// Request conversion of an AWARDED tender into a JIH opportunity. Creates a
// DRAFT review + approval — never a live opportunity automatically.

export const pipelineModule: HandlerModule = {
  name: "pipeline",
  handlers: {
    close_quotation,
    convert_lead,
    change_account_owner,
    assign_owner,
    update_opportunity_stage,
    convert_rfq_to_jih,
    advance_sales_stage,
    set_win_confidence,
    advance_tender_stage,
  },
};
