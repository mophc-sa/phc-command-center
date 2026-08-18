import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";
import { logActivity } from "@/lib/activity-actions";
import type { Database } from "@/integrations/supabase/types";

type Uuid = string;
export type SalesStage = Database["public"]["Enums"]["sales_stage"];
export type WinConfidence = Database["public"]["Enums"]["win_confidence"];
export type ActionType = Database["public"]["Enums"]["action_type"];
export type RiskFlag = Database["public"]["Enums"]["risk_flag"];
export type FlagStatus = Database["public"]["Enums"]["flag_status"];
export type QueueActionType = Database["public"]["Enums"]["queue_action_type"];

export const SALES_STAGES: SalesStage[] = [
  "rfq_received", "jih", "jih_bafo", "under_negotiation", "verbally_awarded",
  "contract_received", "contract_signed", "won", "lost", "on_hold",
];
export const WIN_CONFIDENCES: WinConfidence[] = ["low", "possible", "strong", "sure_win"];
export const ACTION_TYPES: ActionType[] = [
  "request_boq", "request_scope_clarification", "follow_up_required", "site_visit_required",
  "price_approval_required", "discount_approval_required", "technical_review_required",
  "vendor_quotation_required", "contract_review_required", "contact_verification_required",
  "tender_decision_required", "project_stage_verification_required", "finance_or_risk_review_required",
];

// Sprint 5 — the Sales Action Queue's "type" vocabulary: why a queue item
// exists, distinct from ACTION_TYPES (what to do) and risk_flag (what risk).
export const QUEUE_ACTION_TYPES: QueueActionType[] = [
  "follow_up_due", "follow_up_overdue", "missing_data", "rfq_review_needed",
  "tender_review_needed", "approval_needed", "quotation_follow_up", "no_next_action",
  "inactive_tier_a_opportunity", "contract_evidence_missing",
];

// Active (not-yet-terminal) statuses a queue item can be worked from.
export const ACTIVE_FLAG_STATUSES: FlagStatus[] = ["open", "in_progress", "escalated", "blocked"];
// Terminal statuses — the item has left the working queue.
export const TERMINAL_FLAG_STATUSES: FlagStatus[] = ["completed", "resolved", "dismissed"];

// Which stages the current sales_stage may move to (mirror of the backend map).
const TRANSITIONS: Record<string, SalesStage[]> = {
  rfq_received: ["jih", "lost", "on_hold"],
  jih: ["jih_bafo", "under_negotiation", "verbally_awarded", "lost", "on_hold"],
  jih_bafo: ["under_negotiation", "verbally_awarded", "lost", "on_hold"],
  under_negotiation: ["verbally_awarded", "lost", "on_hold"],
  verbally_awarded: ["contract_received", "lost", "on_hold"],
  contract_received: ["contract_signed", "won", "on_hold"],
  contract_signed: ["won", "on_hold"],
  won: [],
  lost: [],
  on_hold: ["jih", "jih_bafo", "under_negotiation", "verbally_awarded", "rfq_received"],
};
export function nextSalesStages(from: SalesStage | null): SalesStage[] {
  return TRANSITIONS[from ?? "jih"] ?? [];
}

// All sensitive transitions run through the backend layer (requirement checks,
// approval gating, transition history + audit are enforced server-side).
export async function advanceSalesStage(input: {
  opportunityId: Uuid;
  toStage: SalesStage;
  notes?: string;
  evidence?: string;
  fields?: Record<string, unknown>;
}) {
  return await callBackend("advance_sales_stage", { ...input });
}

export async function setWinConfidence(opportunityId: Uuid, value: WinConfidence, evidence?: string) {
  return await callBackend("set_win_confidence", { opportunityId, value, evidence });
}

export async function runAutomations() {
  return await callBackend<{ raised: number }>("run_automations", {});
}

/* ---------------- Flags / Sales Action Queue (action required / risk) ---------------- */

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function auditFlag(action: string, flagId: Uuid, before?: unknown, after?: unknown) {
  const actor = await currentUserId();
  await supabase.from("audit_log").insert({
    actor_id: actor,
    actor_type: "user",
    action,
    entity_type: "opportunity_flag",
    entity_id: flagId,
    before_value: (before ?? null) as never,
    after_value: (after ?? null) as never,
  });
}

export async function createFlag(input: {
  linkedRecordType: string;
  linkedRecordId: Uuid;
  kind: "action_required" | "risk";
  actionType?: ActionType;
  riskFlag?: RiskFlag;
  queueActionType?: QueueActionType;
  recommendedAction?: string;
  aiGenerated?: boolean;
  actionOwnerId?: Uuid | null;
  dueDate?: string | null;
  priority?: "A" | "B" | "C";
  reason?: string;
}) {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("opportunity_flags")
    .insert({
      linked_record_type: input.linkedRecordType,
      linked_record_id: input.linkedRecordId,
      flag_kind: input.kind,
      action_type: input.actionType ?? null,
      risk_flag: input.riskFlag ?? null,
      queue_action_type: input.queueActionType ?? null,
      recommended_action: input.recommendedAction ?? null,
      ai_generated: input.aiGenerated ?? false,
      action_owner_id: input.actionOwnerId ?? null,
      due_date: input.dueDate ?? null,
      priority: input.priority ?? null,
      reason: input.reason ?? null,
      created_by: userData.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("audit_log").insert({
    actor_id: userData.user?.id ?? null,
    actor_type: "user",
    action: "flag.created",
    entity_type: "opportunity_flag",
    entity_id: data.id,
    after_value: data as never,
  });
  return data;
}

// Kept for backward compatibility (Sprint 4 scoring auto-resolution and any
// other existing caller). Now converges on 'completed' — the canonical
// terminal-success status introduced in Sprint 5 — instead of the older
// 'resolved' value, so the queue only has one "done" status going forward.
export async function resolveFlag(id: Uuid) {
  const uid = await currentUserId();
  const { error } = await supabase
    .from("opportunity_flags")
    .update({ status: "completed", completed_at: new Date().toISOString(), completed_by: uid })
    .eq("id", id);
  if (error) throw error;
}

// Move a queue item from open to actively being worked.
export async function startAction(id: Uuid) {
  const { error } = await supabase.from("opportunity_flags").update({ status: "in_progress" }).eq("id", id);
  if (error) throw error;
  await auditFlag("flag.started", id);
}

// Complete a queue item. Requirement: completing an action logs activity —
// for opportunity-linked items this writes a real activity entry so it
// shows up on the opportunity's timeline; every item also gets an audit
// entry regardless of the linked record type.
export async function completeAction(id: Uuid, note?: string) {
  const uid = await currentUserId();
  const { data: before } = await supabase.from("opportunity_flags").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase
    .from("opportunity_flags")
    .update({ status: "completed", completed_at: new Date().toISOString(), completed_by: uid })
    .eq("id", id);
  if (error) throw error;
  await auditFlag("flag.completed", id, before, { status: "completed", note: note ?? null });
  if (before?.linked_record_type === "opportunity") {
    await logActivity({
      type: "note",
      summary: note || before.recommended_action || before.reason || "Action completed",
      opportunityId: before.linked_record_id,
    });
  }
}

export async function dismissAction(id: Uuid, reason: string) {
  if (!reason || !reason.trim()) throw new Error("A reason is required to dismiss this action.");
  const { data: before } = await supabase.from("opportunity_flags").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("opportunity_flags").update({ status: "dismissed" }).eq("id", id);
  if (error) throw error;
  await auditFlag("flag.dismissed", id, before, { status: "dismissed", reason });
}

export async function escalateAction(id: Uuid, note?: string) {
  const { data: before } = await supabase.from("opportunity_flags").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("opportunity_flags").update({ status: "escalated", priority: "A" }).eq("id", id);
  if (error) throw error;
  await auditFlag("flag.escalated", id, before, { status: "escalated", note: note ?? null });
}

export async function blockAction(id: Uuid, reason: string) {
  if (!reason || !reason.trim()) throw new Error("A reason is required to mark this action as blocked.");
  const { data: before } = await supabase.from("opportunity_flags").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("opportunity_flags").update({ status: "blocked" }).eq("id", id);
  if (error) throw error;
  await auditFlag("flag.blocked", id, before, { status: "blocked", reason });
}

/* ---------------- Phase 3 — win probability, kept as two separate facts ---- */

/**
 * The AI's score and a manager's own number are different claims and are
 * stored separately (migration 20260818140000).
 *
 * Before Phase 3 a human estimate was written through `score_manual_override`,
 * which overwrote the model's value — after which nobody could ask the useful
 * question: where does the desk disagree with the model, and who was right?
 * Setting one never clears the other.
 */
export async function setHumanWinProbability(
  opportunityId: Uuid,
  probability: number,
  reason?: string,
) {
  if (!Number.isInteger(probability) || probability < 0 || probability > 100) {
    throw new Error("Probability must be a whole number between 0 and 100.");
  }
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id ?? null;
  const { error } = await supabase
    .from("opportunities")
    .update({
      human_win_probability: probability,
      human_probability_reason: reason?.trim() || null,
      human_probability_at: new Date().toISOString(),
      human_probability_by: uid,
      // score / score_reasons / scored_at are deliberately untouched.
    })
    .eq("id", opportunityId);
  if (error) throw error;
  await supabase.from("audit_log").insert({
    actor_id: uid, actor_type: "user", action: "opportunity.human_probability.set",
    entity_type: "opportunity", entity_id: opportunityId,
    after_value: { probability, reason: reason ?? null } as never,
  });
}

/** Commercial handoff status — independent of the sales stage (PRD §19). */
export const COMMERCIAL_HANDOFF_STATES = [
  "with_sales", "waiting_management", "with_commercial", "waiting_vendor",
  "waiting_gm", "final_review", "ready_for_sales", "submitted", "waiting_client",
] as const;
export type CommercialHandoffState = (typeof COMMERCIAL_HANDOFF_STATES)[number];

/**
 * The states Sales actually drives today. The rest of the vocabulary exists so
 * Commercial & Finance inherits it rather than inventing a parallel one, but
 * Sales cannot set them — a salesperson marking a file "waiting GM" when it
 * never reached Commercial would be a lie the next phase has to unpick.
 */
export const SALES_SETTABLE_HANDOFF: readonly CommercialHandoffState[] = [
  "with_sales", "waiting_management", "with_commercial",
];

export async function setCommercialHandoff(
  opportunityId: Uuid,
  state: CommercialHandoffState,
  note?: string,
) {
  if (!SALES_SETTABLE_HANDOFF.includes(state)) {
    throw new Error(`Sales cannot set the handoff state "${state}" — it belongs to a later stage of the flow.`);
  }
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id ?? null;
  const { error } = await supabase
    .from("opportunities")
    .update({
      commercial_handoff_status: state,
      commercial_handoff_at: new Date().toISOString(),
      commercial_handoff_by: uid,
      commercial_handoff_note: note?.trim() || null,
    })
    .eq("id", opportunityId);
  if (error) throw error;
  await supabase.from("audit_log").insert({
    actor_id: uid, actor_type: "user", action: "opportunity.handoff.changed",
    entity_type: "opportunity", entity_id: opportunityId,
    after_value: { state, note: note ?? null } as never,
  });
}
