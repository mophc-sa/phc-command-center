import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";
import { scoreOpportunity, type OpportunityScoreResult, type OpportunityScoreTier } from "@/lib/opportunity-scoring";
import { createFlag, resolveFlag, type RiskFlag } from "@/lib/workflow-actions";

type Uuid = string;

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function audit(
  action: string,
  entityType: string,
  entityId: Uuid,
  before?: unknown,
  after?: unknown,
) {
  const actor = await currentUserId();
  await supabase.from("audit_log").insert({
    actor_id: actor,
    actor_type: "user",
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_value: (before ?? null) as never,
    after_value: (after ?? null) as never,
  });
}

/* ---------------- Approvals ---------------- */

export async function requestReview(input: {
  opportunityId: Uuid;
  approvalType: string; // e.g. "quotation", "management_review", "exception"
  recommendation?: "proceed" | "management_review" | "do_not_quote" | null;
  notes?: string;
}) {
  const requested_by = await currentUserId();
  const { data, error } = await supabase
    .from("approvals")
    .insert({
      related_opportunity_id: input.opportunityId,
      approval_type: input.approvalType,
      status: "pending",
      recommendation: input.recommendation ?? null,
      decision_notes: input.notes ?? null,
      requested_by,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("approval.requested", "opportunity", input.opportunityId, null, data);
  return data;
}

// Routed through the backend layer — approval decisions are a sensitive
// commercial action enforced server-side (manager-only + audit).
export async function decideApproval(input: {
  approvalId: Uuid;
  opportunityId: Uuid;
  decision: "approved" | "returned" | "escalated";
  notes?: string;
}) {
  const res = await callBackend<{ approval: unknown }>("decide_approval", {
    approvalId: input.approvalId,
    decision: input.decision,
    notes: input.notes ?? null,
  });
  return res.approval;
}

/* ---------------- Follow-ups ---------------- */

export async function scheduleFollowUp(input: {
  opportunityId: Uuid;
  dueDate: string; // YYYY-MM-DD
  channel?: string;
  cadenceTier?: "A" | "B" | "C";
  notes?: string;
  ownerId?: Uuid | null; // null = unassigned, undefined = self-assign
}) {
  let owner_id: Uuid | null;
  if (input.ownerId === undefined) owner_id = await currentUserId();
  else owner_id = input.ownerId;
  const { data, error } = await supabase
    .from("follow_ups")
    .insert({
      opportunity_id: input.opportunityId,
      due_date: input.dueDate,
      channel: input.channel ?? null,
      cadence_tier: input.cadenceTier ?? "B",
      status: "scheduled",
      notes: input.notes ?? null,
      owner_id,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("follow_up.scheduled", "opportunity", input.opportunityId, null, data);
  return data;
}

export async function rescheduleFollowUp(input: {
  followUpId: Uuid;
  opportunityId: Uuid;
  dueDate: string;
  notes?: string;
}) {
  const { data: before } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("id", input.followUpId)
    .maybeSingle();
  const { data, error } = await supabase
    .from("follow_ups")
    .update({
      due_date: input.dueDate,
      status: "scheduled",
      notes: input.notes ?? undefined,
    })
    .eq("id", input.followUpId)
    .select()
    .single();
  if (error) throw error;
  await audit(
    "follow_up.rescheduled",
    "opportunity",
    input.opportunityId,
    before ? { due_date: before.due_date, notes: before.notes } : null,
    { due_date: data.due_date, notes: data.notes },
  );
  return data;
}

export async function completeFollowUp(input: {
  followUpId: Uuid;
  opportunityId: Uuid;
  outcome: string;
}) {
  const { data, error } = await supabase
    .from("follow_ups")
    .update({
      status: "completed",
      last_contact_at: new Date().toISOString(),
      notes: input.outcome,
    })
    .eq("id", input.followUpId)
    .select()
    .single();
  if (error) throw error;
  await audit(
    "follow_up.outcome_logged",
    "opportunity",
    input.opportunityId,
    null,
    { outcome: input.outcome, completed_at: data.last_contact_at },
  );
  return data;
}

/* ---------------- Opportunity ownership / stage ---------------- */

// Owner assignment is a sensitive commercial action — enforced server-side
// (manager-only + audit). The DB also blocks a direct client owner change.
export async function assignOwner(input: {
  opportunityId: Uuid;
  ownerId: Uuid | null;
  notes?: string;
}) {
  return await callBackend("assign_owner", {
    opportunityId: input.opportunityId,
    ownerId: input.ownerId,
    notes: input.notes ?? null,
  });
}

export async function escalateOpportunity(input: {
  opportunityId: Uuid;
  reason: string;
}) {
  const { data, error } = await supabase
    .from("opportunities")
    .update({ management_review_reason: input.reason })
    .eq("id", input.opportunityId)
    .select()
    .single();
  if (error) throw error;
  const requested_by = await currentUserId();
  await supabase.from("approvals").insert({
    related_opportunity_id: input.opportunityId,
    approval_type: "escalation",
    status: "escalated",
    recommendation: "management_review",
    decision_notes: input.reason,
    requested_by,
  });
  await audit("opportunity.escalated", "opportunity", input.opportunityId, null, {
    reason: input.reason,
  });
  return data;
}

// Stage changes go through the backend. Commercial stages (won/lost/archived)
// are manager-gated server-side; the DB blocks a direct client commercial write.
export async function updateOpportunityStage(input: {
  opportunityId: Uuid;
  stage:
    | "discovery"
    | "qualification"
    | "preparation"
    | "quotation"
    | "follow_up"
    | "won"
    | "lost"
    | "archived";
  notes?: string;
}) {
  return await callBackend("update_opportunity_stage", {
    opportunityId: input.opportunityId,
    stage: input.stage,
    notes: input.notes ?? null,
  });
}

/* ---------------- Scoring (Sprint 4) ---------------- */
// Direct RLS-gated writes (owner or manager, same as any other opportunity
// edit) rather than a backend call: scoring is advisory/informational, not a
// commercial-decision gate like stage or owner changes. Every write — auto
// or override — is still audited.

// Marks flags this feature created, so re-scoring can resolve/refresh them
// without touching flags a human raised by hand.
const SCORE_FLAG_MARKER = "[auto-score]";

async function syncScoreFlags(opportunityId: Uuid, result: OpportunityScoreResult) {
  const { data: existing } = await supabase
    .from("opportunity_flags")
    .select("id, flag_kind, reason")
    .eq("linked_record_type", "opportunity")
    .eq("linked_record_id", opportunityId)
    .eq("status", "open");

  const scorerActionFlag = (existing ?? []).find((f) => f.flag_kind === "action_required" && f.reason?.startsWith(SCORE_FLAG_MARKER));
  const scorerRiskFlag = (existing ?? []).find((f) => f.flag_kind === "risk" && f.reason?.startsWith(SCORE_FLAG_MARKER));

  // Missing data feeds the action queue (opportunity_flags), per the Sprint 4 rule.
  if (result.missing_data.length > 0) {
    if (!scorerActionFlag) {
      await createFlag({
        linkedRecordType: "opportunity",
        linkedRecordId: opportunityId,
        kind: "action_required",
        actionType: "technical_review_required",
        reason: `${SCORE_FLAG_MARKER} Missing: ${result.missing_data.join(", ")}`,
      });
    }
  } else if (scorerActionFlag) {
    await resolveFlag(scorerActionFlag.id);
  }

  if (result.risk_flags.length > 0) {
    if (!scorerRiskFlag) {
      await createFlag({
        linkedRecordType: "opportunity",
        linkedRecordId: opportunityId,
        kind: "risk",
        riskFlag: result.risk_flags[0] as RiskFlag,
        reason: `${SCORE_FLAG_MARKER} Risks: ${result.risk_flags.join(", ")}`,
      });
    }
  } else if (scorerRiskFlag) {
    await resolveFlag(scorerRiskFlag.id);
  }
}

export async function recomputeOpportunityScore(opportunityId: Uuid) {
  const { data: o, error } = await supabase.from("opportunities").select("*").eq("id", opportunityId).single();
  if (error) throw error;

  const result = scoreOpportunity(o);
  const uid = await currentUserId();
  const patch = {
    score: result.score,
    score_tier: result.tier,
    score_confidence: result.confidence,
    score_missing_data: result.missing_data,
    score_reasons: result.reasons,
    score_risk_flags: result.risk_flags,
    score_recommended_action: result.recommended_next_action,
    score_manual_override: false,
    score_override_reason: null,
    scored_at: new Date().toISOString(),
    scored_by: uid,
  };
  const { data, error: updErr } = await supabase.from("opportunities").update(patch).eq("id", opportunityId).select().single();
  if (updErr) throw updErr;
  await audit("opportunity.scored", "opportunity", opportunityId, null, patch);

  await syncScoreFlags(opportunityId, result);

  return { opportunity: data, result };
}

// Manual override — requires a reason and is always audited (enforced here
// as well as by the UI's required field, in case this is ever called from
// somewhere that skips the dialog).
export async function overrideOpportunityScore(input: {
  opportunityId: Uuid;
  tier: OpportunityScoreTier;
  reason: string;
}) {
  if (!input.reason || !input.reason.trim()) {
    throw new Error("An override reason is required.");
  }
  const { data: before } = await supabase
    .from("opportunities")
    .select("score_tier, score_manual_override, score_override_reason")
    .eq("id", input.opportunityId)
    .maybeSingle();
  const { data, error } = await supabase
    .from("opportunities")
    .update({
      score_tier: input.tier,
      score_manual_override: true,
      score_override_reason: input.reason,
    })
    .eq("id", input.opportunityId)
    .select()
    .single();
  if (error) throw error;
  await audit("opportunity.score_overridden", "opportunity", input.opportunityId, before, {
    score_tier: input.tier,
    reason: input.reason,
  });
  return data;
}

/* ---------------- Team lookup ---------------- */

export async function listTeamMembers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .order("full_name", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}
