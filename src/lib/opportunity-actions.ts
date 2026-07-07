import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";

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

export async function assignOwner(input: {
  opportunityId: Uuid;
  ownerId: Uuid | null;
  notes?: string;
}) {
  const { data, error } = await supabase
    .from("opportunities")
    .update({ owner_id: input.ownerId })
    .eq("id", input.opportunityId)
    .select()
    .single();
  if (error) throw error;
  await audit(
    "opportunity.assigned",
    "opportunity",
    input.opportunityId,
    null,
    { owner_id: input.ownerId, notes: input.notes ?? null },
  );
  return data;
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
  const { data, error } = await supabase
    .from("opportunities")
    .update({ stage: input.stage })
    .eq("id", input.opportunityId)
    .select()
    .single();
  if (error) throw error;
  await audit("opportunity.stage_changed", "opportunity", input.opportunityId, null, {
    stage: input.stage,
    notes: input.notes ?? null,
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
