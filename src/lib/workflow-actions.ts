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
