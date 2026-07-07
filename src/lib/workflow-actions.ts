import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";
import type { Database } from "@/integrations/supabase/types";

type Uuid = string;
export type SalesStage = Database["public"]["Enums"]["sales_stage"];
export type WinConfidence = Database["public"]["Enums"]["win_confidence"];
export type ActionType = Database["public"]["Enums"]["action_type"];
export type RiskFlag = Database["public"]["Enums"]["risk_flag"];

export const SALES_STAGES: SalesStage[] = [
  "rfq_received", "jih", "under_negotiation", "verbally_awarded",
  "contract_received", "won", "lost", "on_hold",
];
export const WIN_CONFIDENCES: WinConfidence[] = ["low", "possible", "strong", "sure_win"];
export const ACTION_TYPES: ActionType[] = [
  "request_boq", "request_scope_clarification", "follow_up_required", "site_visit_required",
  "price_approval_required", "discount_approval_required", "technical_review_required",
  "vendor_quotation_required", "contract_review_required", "contact_verification_required",
  "tender_decision_required", "project_stage_verification_required", "finance_or_risk_review_required",
];

// Which stages the current sales_stage may move to (mirror of the backend map).
const TRANSITIONS: Record<string, SalesStage[]> = {
  rfq_received: ["jih", "lost", "on_hold"],
  jih: ["under_negotiation", "verbally_awarded", "lost", "on_hold"],
  under_negotiation: ["verbally_awarded", "lost", "on_hold"],
  verbally_awarded: ["contract_received", "lost", "on_hold"],
  contract_received: ["won", "on_hold"],
  won: [],
  lost: [],
  on_hold: ["jih", "under_negotiation", "verbally_awarded", "rfq_received"],
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

/* ---------------- Flags (action required / risk) ---------------- */

export async function createFlag(input: {
  linkedRecordType: string;
  linkedRecordId: Uuid;
  kind: "action_required" | "risk";
  actionType?: ActionType;
  riskFlag?: RiskFlag;
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

export async function resolveFlag(id: Uuid) {
  const { error } = await supabase.from("opportunity_flags").update({ status: "resolved" }).eq("id", id);
  if (error) throw error;
}
