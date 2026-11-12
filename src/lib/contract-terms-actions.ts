// B1: RPC wrappers and reads for the contract's terms. Authorization and every
// rule are in SQL (20261112100000); errors carry the bilingual message (dbMessage).
import { supabase } from "@/integrations/supabase/client";
import type { PaymentKind, TermsStatus } from "@/lib/contract-terms";

const db = supabase as unknown as { from: (t: string) => any };

async function call<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

export type TermsInput = {
  reference: string;
  signed_on: string;
  value: number;
  value_difference_reason: string;
  drawings_days: number;
  supply_install_days: number;
  handover_days: number;
  credit_days: number;
  payments: { kind: PaymentKind; pct: number; label?: string; expected_on?: string }[];
};
/** Creates or updates the deal's open draft; returns the contract id. */
export const saveContractTerms = (opportunityId: string, terms: TermsInput) =>
  call<string>("contract_terms_save", { _opportunity_id: opportunityId, _terms: terms });
export const submitContractTerms = (contractId: string) => call("contract_terms_submit", { _contract_id: contractId });
export const reviewContractTerms = (contractId: string, decision: "approve" | "return", reason?: string) =>
  call("contract_terms_review", { _contract_id: contractId, _decision: decision, _reason: reason ?? null });

export type ContractTermsRow = {
  id: string;
  opportunity_id: string;
  terms_status: TermsStatus;
  contract_value: number;
  contract_reference_number: string | null;
  quotation_revision_id: string | null;
  value_difference_reason: string | null;
  signed_on: string | null;
  drawings_days: number | null;
  supply_install_days: number | null;
  handover_days: number | null;
  credit_days: number | null;
  terms_saved_by: string | null;
  submitted_by: string | null;
  return_reason: string | null;
  reviewed_at: string | null;
  consultant_delay_days: number;
};
const TERMS_COLUMNS =
  "id, opportunity_id, terms_status, contract_value, contract_reference_number, quotation_revision_id, value_difference_reason, signed_on, drawings_days, supply_install_days, handover_days, credit_days, terms_saved_by, submitted_by, return_reason, reviewed_at, consultant_delay_days";
/** The deal's newest contract with terms (open, or the approved one). */
export async function getDealContractTerms(opportunityId: string): Promise<ContractTermsRow | null> {
  const { data, error } = await db.from("contracts").select(TERMS_COLUMNS).eq("opportunity_id", opportunityId)
    .not("terms_status", "is", null).order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return ((data ?? [])[0] ?? null) as ContractTermsRow | null;
}

export type ContractPaymentRow = {
  id: string; position: number; kind: PaymentKind; label: string | null; pct: number; amount: number;
  expected_on: string | null; event_on: string | null; due_on: string | null;
};
export async function listContractPayments(contractId: string): Promise<ContractPaymentRow[]> {
  const { data, error } = await db.from("contract_payments")
    .select("id, position, kind, label, pct, amount, expected_on, event_on, due_on").eq("contract_id", contractId).order("position");
  if (error) throw error;
  return (data ?? []) as ContractPaymentRow[];
}

export type CurrentQuote = { revision_id: string; revision_number: number; subtotal_excl_vat: number; status: string };
/** The client's current quotation for the deal (what the contract starts from). */
export async function getCurrentQuote(opportunityId: string): Promise<CurrentQuote | null> {
  const { data, error } = await db.from("quotation_current_revision")
    .select("revision_id, revision_number, subtotal_excl_vat, status").eq("related_opportunity_id", opportunityId)
    .in("status", ["approved", "submitted"]).order("revision_number", { ascending: false }).limit(1);
  if (error) throw error;
  return ((data ?? [])[0] ?? null) as CurrentQuote | null;
}

// ---- B2: execution approvals and dues ----------------------------------------------

export const recordContractApproval = (a: {
  contractId: string; paymentId: string; approvedOn: string; sharePct: number;
  submittedOn: string | null; reference: string | null; documentPath: string | null; note: string | null;
}) =>
  call<string>("contract_approval_record", {
    _contract_id: a.contractId, _payment_id: a.paymentId, _approved_on: a.approvedOn, _share_pct: a.sharePct,
    _submitted_on: a.submittedOn, _reference: a.reference, _document_path: a.documentPath, _note: a.note,
  });
export const voidContractApproval = (approvalId: string, reason: string) =>
  call("contract_approval_void", { _approval_id: approvalId, _reason: reason });

export type ScheduleRow = {
  payment_id: string; position: number; kind: PaymentKind; label: string | null; pct: number; amount: number;
  expected_on: string | null; expected_on_adjusted: string | null; share_due: number; amount_due: number; next_due_on: string | null;
};
export async function listPaymentSchedule(contractId: string): Promise<ScheduleRow[]> {
  const { data, error } = await db.from("contract_payment_schedule")
    .select("payment_id, position, kind, label, pct, amount, expected_on, expected_on_adjusted, share_due, amount_due, next_due_on")
    .eq("contract_id", contractId).order("position");
  if (error) throw error;
  return (data ?? []) as ScheduleRow[];
}

export type ApprovalRow = {
  id: string; payment_id: string; approved_on: string; share_pct: number; submitted_on: string | null;
  reference: string | null; document_path: string | null; voided_at: string | null; void_reason: string | null;
};
export async function listContractApprovals(contractId: string): Promise<ApprovalRow[]> {
  const { data, error } = await db.from("contract_approvals")
    .select("id, payment_id, approved_on, share_pct, submitted_on, reference, document_path, voided_at, void_reason")
    .eq("contract_id", contractId).order("approved_on", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ApprovalRow[];
}
