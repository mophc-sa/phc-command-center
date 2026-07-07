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
  hasAny,
  audit,
  type AppRole,
} from "../_shared/supabase.ts";

type Handler = (
  payload: Record<string, unknown>,
  caller: { userId: string; roles: AppRole[] },
) => Promise<Response>;

const MANAGERS: AppRole[] = ["sales_manager", "ceo"];
const QUALIFIERS: AppRole[] = ["bd_manager", "sales_manager", "ceo"];

const handlers: Record<string, Handler> = {
  // Manager approves / returns / escalates a pending approval.
  async decide_approval(payload, caller) {
    if (!hasAny(caller.roles, MANAGERS)) return err("Managers only", 403);
    const approvalId = String(payload.approvalId ?? "");
    const decision = String(payload.decision ?? "");
    if (!approvalId) return err("approvalId is required");
    const map: Record<string, { status: string; decision: string }> = {
      approved: { status: "approved", decision: "proceed" },
      returned: { status: "returned", decision: "management_review" },
      escalated: { status: "escalated", decision: "management_review" },
    };
    const m = map[decision];
    if (!m) return err("Invalid decision");
    const svc = serviceClient();
    const { data, error } = await svc
      .from("approvals")
      .update({
        status: m.status,
        decision: m.decision,
        decision_notes: (payload.notes as string) ?? null,
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
    if (!isOwner && !hasAny(caller.roles, MANAGERS)) {
      return err("Only the owner or a manager can close this quotation", 403);
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
    if (!hasAny(caller.roles, QUALIFIERS)) return err("Qualifiers only", 403);
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
    if (!hasAny(caller.roles, MANAGERS)) return err("Managers only", 403);
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
    if (!isOwner && !hasAny(caller.roles, QUALIFIERS)) {
      return err("Only the suggested owner or a manager can accept this", 403);
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
