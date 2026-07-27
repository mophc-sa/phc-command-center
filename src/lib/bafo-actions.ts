// BAFO / commercial-discount approval chain — client spec (2026-07-27,
// "دور مدير تطوير الأعمال داخل النظام", section 12). A fixed 4-step
// sequential chain (commercial review → cost approval → finance review →
// final approval); see 20260727220000_bafo_approval_chain.sql for the
// server-side ordering/role enforcement this file's actions rely on.
import { supabase } from "@/integrations/supabase/client";

type Uuid = string;

export type BafoStepStatus = "pending" | "approved" | "rejected";
export type BafoStatus = "pending" | "approved" | "rejected";

export type BafoStep = "commercial_review" | "cost_approval" | "finance_review" | "final_approval";

export const BAFO_STEPS: BafoStep[] = ["commercial_review", "cost_approval", "finance_review", "final_approval"];

export type BafoRequest = {
  id: Uuid;
  opportunity_id: Uuid;
  quotation_id: Uuid | null;
  requested_by: Uuid;
  proposed_value: number | null;
  proposed_discount_pct: number | null;
  proposed_payment_terms: string | null;
  justification: string;
  status: BafoStatus;
  commercial_review_status: BafoStepStatus;
  commercial_review_by: Uuid | null;
  commercial_review_notes: string | null;
  commercial_review_at: string | null;
  cost_approval_status: BafoStepStatus;
  cost_approval_by: Uuid | null;
  cost_approval_notes: string | null;
  cost_approval_at: string | null;
  finance_review_status: BafoStepStatus;
  finance_review_by: Uuid | null;
  finance_review_notes: string | null;
  finance_review_at: string | null;
  final_approval_status: BafoStepStatus;
  final_approval_by: Uuid | null;
  final_approval_notes: string | null;
  final_approval_at: string | null;
  sent_to_client_at: string | null;
  sent_to_client_by: Uuid | null;
  created_at: string;
  updated_at: string;
};

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function listBafoRequests(opportunityId: Uuid): Promise<BafoRequest[]> {
  const { data, error } = await supabase
    .from("bafo_requests")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BafoRequest[];
}

export async function createBafoRequest(input: {
  opportunityId: Uuid;
  quotationId?: Uuid | null;
  proposedValue?: number | null;
  proposedDiscountPct?: number | null;
  proposedPaymentTerms?: string | null;
  justification: string;
}): Promise<BafoRequest> {
  const uid = await currentUserId();
  if (!uid) throw new Error("Must be signed in to request a BAFO");
  const { data, error } = await supabase
    .from("bafo_requests")
    .insert({
      opportunity_id: input.opportunityId,
      quotation_id: input.quotationId ?? null,
      requested_by: uid,
      proposed_value: input.proposedValue ?? null,
      proposed_discount_pct: input.proposedDiscountPct ?? null,
      proposed_payment_terms: input.proposedPaymentTerms ?? null,
      justification: input.justification,
    })
    .select()
    .single();
  if (error) throw error;
  return data as BafoRequest;
}

// Server-side (protect_bafo_step_transitions trigger) enforces both the
// step's required role and that prior steps are already approved — this
// only shapes the update payload; it isn't the source of truth for
// authorization.
export async function decideBafoStep(input: {
  requestId: Uuid;
  step: BafoStep;
  decision: "approved" | "rejected";
  notes?: string;
}): Promise<BafoRequest> {
  const notes = input.notes ?? null;
  const patch =
    input.step === "commercial_review" ? { commercial_review_status: input.decision, commercial_review_notes: notes }
    : input.step === "cost_approval" ? { cost_approval_status: input.decision, cost_approval_notes: notes }
    : input.step === "finance_review" ? { finance_review_status: input.decision, finance_review_notes: notes }
    : { final_approval_status: input.decision, final_approval_notes: notes };
  const { data, error } = await supabase
    .from("bafo_requests")
    .update(patch)
    .eq("id", input.requestId)
    .select()
    .single();
  if (error) throw error;
  return data as BafoRequest;
}

// Only succeeds once status = 'approved' (server-enforced) — see the
// trigger's "Cannot mark a BAFO request as sent to client..." exception.
export async function markBafoSentToClient(requestId: Uuid): Promise<BafoRequest> {
  const { data, error } = await supabase
    .from("bafo_requests")
    .update({ sent_to_client_at: new Date().toISOString() })
    .eq("id", requestId)
    .select()
    .single();
  if (error) throw error;
  return data as BafoRequest;
}
