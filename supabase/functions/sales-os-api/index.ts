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
  canManageSalesPipeline,
  canRunSensitiveSalesAction,
} from "../_shared/roles.ts";
import { planApprovalExecution, type ApprovalRow } from "../_shared/approvals.ts";

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
      await audit(svc, caller.userId, "approval.approved", "approval", approvalId, out.execution);
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
    await audit(svc, caller.userId, `approval.${decision}`, "approval", approvalId, data);
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
    });

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
    await audit(svc, caller.userId, "lead.converted", "lead", leadId, { opportunity_id: opp.id });
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
    });
    return json({ ok: true, company: data });
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
    });
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
    });
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
    });
    return json({ ok: true, indexed });
  },

  // Convert an RFQ into a live JIH opportunity (RFQ_RECEIVED -> JIH).
  async convert_rfq_to_jih(payload, caller) {
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
    await audit(svc, caller.userId, "rfq.converted_to_jih", "rfq", rfqId, { opportunity_id: opp.id });
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
      });
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
      await audit(svc, caller.userId, "win_confidence.requested", "opportunity", opportunityId, { value });
      return json({ ok: true, pending_approval: true, approval: appr });
    }
    const { error } = await svc.from("opportunities").update({ win_confidence: value }).eq("id", opportunityId);
    if (error) return err(error.message, 400);
    await audit(svc, caller.userId, "win_confidence.set", "opportunity", opportunityId, { value });
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
    await audit(svc, caller.userId, "tender_stage.changed", "tender", tenderId, { from, to: toStage });
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
    if (!tender.main_contractor_id) return err("Winning contractor must be confirmed", 409);
    const { data: appr } = await svc
      .from("approvals")
      .insert({
        approval_type: "TENDER_TO_JIH_APPROVAL",
        requested_by: caller.userId,
        status: "pending",
        recommendation: "management_review",
        decision_notes: (payload.notes as string) ?? null,
        linked_record_type: "tender",
        linked_record_id: tenderId,
        requested_action: "execute_tender_conversion",
        requested_payload: { tenderId },
      })
      .select()
      .single();
    await audit(svc, caller.userId, "tender.conversion_requested", "tender", tenderId, { approval: appr?.id });
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
      await audit(svc, caller.userId, "approval.approved", "approval", approvalId, out.execution);
      return json({ ok: true, approval: out.approval, execution: out.execution });
    }

    if (!tenderId) return err("tenderId is required");
    const { data: tender, error: tErr } = await svc.from("tenders").select("*").eq("id", tenderId).single();
    if (tErr || !tender) return err("Tender not found", 404);
    if (tender.tender_stage === "converted_to_jih") return err("Tender already converted", 409);
    const opp = await executeTenderConversion(svc, tender as Record<string, unknown>, caller.userId, null);
    return json({ ok: true, opportunity: opp });
  },

  // Evaluate the time-based automation rules and raise flags / action items.
  // Intended to be called on a schedule (pg_cron / n8n) or manually by a manager.
  async run_automations(_payload, caller) {
    if (!canRunSensitiveSalesAction(caller.roles)) return err("Sensitive-action authority required", 403);
    const svc = serviceClient();
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 864e5).toISOString();
    let raised = 0;
    const raiseFlag = async (
      recordType: string,
      recordId: string,
      kind: "action_required" | "risk",
      opts: { action_type?: string; risk_flag?: string; reason: string },
    ) => {
      // Avoid duplicates: skip if an open flag of the same kind already exists.
      const { data: existing } = await svc
        .from("opportunity_flags")
        .select("id")
        .eq("linked_record_id", recordId)
        .eq("status", "open")
        .eq("flag_kind", kind)
        .limit(1);
      if (existing && existing.length) return;
      await svc.from("opportunity_flags").insert({
        linked_record_type: recordType,
        linked_record_id: recordId,
        flag_kind: kind,
        action_type: opts.action_type ?? null,
        risk_flag: opts.risk_flag ?? null,
        reason: opts.reason,
        status: "open",
      });
      raised++;
    };

    // RFQ with no owner for 24h.
    const { data: orphanRfqs } = await svc
      .from("rfqs")
      .select("id, created_at")
      .is("sales_owner_id", null)
      .eq("status", "open")
      .lt("created_at", daysAgo(1));
    for (const r of orphanRfqs ?? []) {
      await raiseFlag("rfq", r.id, "action_required", { action_type: "follow_up_required", reason: "RFQ unassigned for 24h" });
    }
    // Verbally awarded with no contract after 14 days.
    const { data: staleAwards } = await svc
      .from("opportunities")
      .select("id, verbal_award_date")
      .eq("sales_stage", "verbally_awarded")
      .lt("verbal_award_date", new Date(now - 14 * 864e5).toISOString().slice(0, 10));
    for (const o of staleAwards ?? []) {
      await raiseFlag("opportunity", o.id, "risk", { risk_flag: "contract_pending", reason: "Verbally awarded >14d without contract" });
    }
    // Tenders with expected award within 7 days.
    const { data: dueTenders } = await svc
      .from("tenders")
      .select("id, expected_award_date")
      .not("expected_award_date", "is", null)
      .lte("expected_award_date", new Date(now + 7 * 864e5).toISOString().slice(0, 10))
      .neq("tender_stage", "converted_to_jih")
      .neq("tender_stage", "tender_lost_or_archived");
    for (const tdr of dueTenders ?? []) {
      await raiseFlag("tender", tdr.id, "action_required", { action_type: "tender_decision_required", reason: "Tender award expected within 7 days" });
    }
    await audit(svc, caller.userId, "automations.run", "system", "run_automations", { raised });
    return json({ ok: true, raised });
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed", 405);

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
