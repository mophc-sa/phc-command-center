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
};
const TERMS_COLUMNS =
  "id, opportunity_id, terms_status, contract_value, contract_reference_number, quotation_revision_id, value_difference_reason, signed_on, drawings_days, supply_install_days, handover_days, credit_days, terms_saved_by, submitted_by, return_reason, reviewed_at";
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
