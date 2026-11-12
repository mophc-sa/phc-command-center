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
  // B4: a variation's quotation is not the contract's; skip the files tagged as variations.
  const [{ data, error }, { data: vos, error: e2 }] = await Promise.all([
    db.from("quotation_revisions").select("id, revision_number, subtotal_excl_vat, status, pricing_file_id, quotations!inner(related_opportunity_id)")
      .eq("quotations.related_opportunity_id", opportunityId).eq("is_current", true).in("status", ["approved", "submitted"])
      .order("created_at", { ascending: false }),
    db.from("pricing_files").select("id").eq("opportunity_id", opportunityId).not("variation_contract_id", "is", null),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const vo = new Set(((vos ?? []) as { id: string }[]).map((v) => v.id));
  const r = ((data ?? []) as { id: string; revision_number: number; subtotal_excl_vat: number; status: string; pricing_file_id: string | null }[])
    .find((x) => !x.pricing_file_id || !vo.has(x.pricing_file_id));
  return r ? { revision_id: r.id, revision_number: r.revision_number, subtotal_excl_vat: r.subtotal_excl_vat, status: r.status } : null;
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

// ---- B3: invoices, receipts, claims ------------------------------------------------

export const recordInvoice = (contractId: string, number: string, invoiceDate: string, dueIds: string[], note: string | null) =>
  call<string>("contract_invoice_record", { _contract_id: contractId, _number: number, _invoice_date: invoiceDate, _due_ids: dueIds, _note: note });
export const voidInvoice = (invoiceId: string, reason: string) => call("contract_invoice_void", { _invoice_id: invoiceId, _reason: reason });
export const recordReceipt = (invoiceId: string, receivedOn: string, amount: number, reference: string | null, note: string | null) =>
  call<string>("contract_receipt_record", { _invoice_id: invoiceId, _received_on: receivedOn, _amount: amount, _reference: reference, _note: note });
export const voidReceipt = (receiptId: string, reason: string) => call("contract_receipt_void", { _receipt_id: receiptId, _reason: reason });
export const recordClaim = (c: { contractId: string; invoiceId: string | null; claimedOn: string; channel: string; note: string; followUpOn: string | null }) =>
  call<string>("contract_claim_record", {
    _contract_id: c.contractId, _invoice_id: c.invoiceId, _claimed_on: c.claimedOn, _channel: c.channel, _note: c.note, _follow_up_on: c.followUpOn,
  });

export type BillingSummary = {
  contract_id: string; opportunity_id: string; contract_value: number; invoiced_excl_vat: number; left_to_invoice: number;
  invoiced_incl_vat: number; received: number; outstanding: number; late_outstanding: number;
  dues_not_invoiced: number; amount_not_invoiced: number;
};
const SUMMARY_COLUMNS =
  "contract_id, opportunity_id, contract_value, invoiced_excl_vat, left_to_invoice, invoiced_incl_vat, received, outstanding, late_outstanding, dues_not_invoiced, amount_not_invoiced";
export async function getBillingSummary(contractId: string): Promise<BillingSummary | null> {
  const { data, error } = await db.from("contract_billing_summary").select(SUMMARY_COLUMNS).eq("contract_id", contractId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as BillingSummary | null;
}
export async function listBillingSummaries(): Promise<BillingSummary[]> {
  const { data, error } = await db.from("contract_billing_summary").select(SUMMARY_COLUMNS).limit(1000);
  if (error) throw error;
  return (data ?? []) as BillingSummary[];
}

export type ReceivableRow = {
  invoice_id: string; contract_id: string; opportunity_id: string; invoice_number: string; invoice_date: string; due_on: string;
  amount_excl_vat: number; total_incl_vat: number; received: number; outstanding: number; days_late: number; tier: 0 | 1 | 2 | 3;
};
const RECEIVABLE_COLUMNS =
  "invoice_id, contract_id, opportunity_id, invoice_number, invoice_date, due_on, amount_excl_vat, total_incl_vat, received, outstanding, days_late, tier";
export async function listReceivables(contractId?: string): Promise<ReceivableRow[]> {
  let q = db.from("contract_receivables").select(RECEIVABLE_COLUMNS);
  q = contractId ? q.eq("contract_id", contractId) : q.gt("outstanding", 0);
  const { data, error } = await q.order("days_late", { ascending: false }).order("due_on").limit(1000);
  if (error) throw error;
  return (data ?? []) as ReceivableRow[];
}

export type OpenDueRow = { id: string; payment_id: string; amount: number; share_pct: number; event_on: string; due_on: string };
/** Open dues not yet on a live invoice: what finance can invoice now. */
export async function listDuesToInvoice(contractId: string): Promise<OpenDueRow[]> {
  const [{ data: dues, error: e1 }, { data: links, error: e2 }] = await Promise.all([
    db.from("contract_dues").select("id, payment_id, amount, share_pct, event_on, due_on").eq("contract_id", contractId).eq("status", "open").order("due_on"),
    db.from("contract_invoice_dues").select("due_id, live").eq("live", true),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const invoiced = new Set(((links ?? []) as { due_id: string }[]).map((l) => l.due_id));
  return ((dues ?? []) as OpenDueRow[]).filter((d) => !invoiced.has(d.id));
}

export type ClaimRow = { id: string; invoice_id: string | null; claimed_on: string; channel: string; note: string; follow_up_on: string | null };
export async function listClaims(contractId: string): Promise<ClaimRow[]> {
  const { data, error } = await db.from("contract_claims").select("id, invoice_id, claimed_on, channel, note, follow_up_on")
    .eq("contract_id", contractId).order("claimed_on", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClaimRow[];
}

// ---- B4: variations and executed quantities ----------------------------------------

export const openVariation = (contractId: string, reason: string) =>
  call<{ id: string }>("contract_variation_open", { _contract_id: contractId, _reason: reason });
export const acceptVariation = (fileId: string, acceptedOn: string, clientReference: string | null, documentPath: string | null) =>
  call("contract_variation_accept", { _file_id: fileId, _accepted_on: acceptedOn, _client_reference: clientReference, _document_path: documentPath });
export const recordExecuted = (contractId: string, lines: { line_id: string; executed: number }[]) =>
  call("contract_executed_record", { _contract_id: contractId, _lines: lines });

export type ContractLineRow = {
  id: string; line_number: number; description: string; quantity: number; unit: string | null; line_total: number;
  executed_quantity: number | null; variation_file_id: string | null;
};
export async function listContractLines(contractId: string): Promise<ContractLineRow[]> {
  const { data, error } = await db.from("contract_lines")
    .select("id, line_number, description, quantity, unit, line_total, executed_quantity, variation_file_id")
    .eq("contract_id", contractId).order("line_number");
  if (error) throw error;
  return (data ?? []) as ContractLineRow[];
}
export type ExecutionSummary = { contract_id: string; contract_value: number; executed_value: number; shortfall: number; variations_value: number; executed_recorded: boolean | null };
export async function getExecutionSummary(contractId: string): Promise<ExecutionSummary | null> {
  const { data, error } = await db.from("contract_execution_summary")
    .select("contract_id, contract_value, executed_value, shortfall, variations_value, executed_recorded").eq("contract_id", contractId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as ExecutionSummary | null;
}

// ---- B5: costs and profit (cost readers only) ------------------------------------------

export type CostCategory = "manufacturing" | "installation" | "logistics" | "extras" | "other";
export type CostEntryKind = "actual_cost" | "planned_payment" | "payment";
export const loadCosts = (contractId: string) => call<number>("contract_costs_load", { _contract_id: contractId });
export const addCostItem = (contractId: string, category: CostCategory, label: string, planned: number) =>
  call<string>("contract_cost_item_add", { _contract_id: contractId, _category: category, _label: label, _planned: planned });
export const recordCostEntry = (itemId: string, kind: CostEntryKind, entryOn: string, amount: number, reference: string | null, note: string | null) =>
  call<string>("contract_cost_entry_record", { _item_id: itemId, _kind: kind, _entry_on: entryOn, _amount: amount, _reference: reference, _note: note });
export const voidCostEntry = (entryId: string, reason: string) => call("contract_cost_entry_void", { _entry_id: entryId, _reason: reason });
export const setFinanceSetting = (key: "late_financing_pct_month", value: number) => call("finance_setting_set", { _key: key, _value: value });

export type CostItemRow = { id: string; category: CostCategory; source: string; label: string | null; planned_amount: number };
export type CostEntryRow = { id: string; item_id: string; kind: CostEntryKind; entry_on: string; amount: number; reference: string | null; voided_at: string | null };
export async function listCostItems(contractId: string): Promise<{ items: CostItemRow[]; entries: CostEntryRow[] }> {
  const [a, b] = await Promise.all([
    db.from("contract_cost_items").select("id, category, source, label, planned_amount").eq("contract_id", contractId).order("category"),
    db.from("contract_cost_entries").select("id, item_id, kind, entry_on, amount, reference, voided_at").eq("contract_id", contractId).order("entry_on"),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  return { items: (a.data ?? []) as CostItemRow[], entries: (b.data ?? []) as CostEntryRow[] };
}

export type ProfitRow = {
  contract_id: string; opportunity_id: string; project_name: string | null; project_code: string | null;
  sold: number; executed_value: number | null; planned_cost: number; expected_cost: number; actual_cost_recorded: number;
  gross_profit_planned: number; gross_profit_expected: number; financing_cost: number; net_profit: number;
  received: number | null; outstanding: number | null; late_outstanding: number | null; cash_out_paid: number; cash_out_planned: number;
};
const PROFIT_COLUMNS =
  "contract_id, opportunity_id, project_name, project_code, sold, executed_value, planned_cost, expected_cost, actual_cost_recorded, gross_profit_planned, gross_profit_expected, financing_cost, net_profit, received, outstanding, late_outstanding, cash_out_paid, cash_out_planned";
export async function listProfit(): Promise<ProfitRow[]> {
  const { data, error } = await db.from("contract_profit").select(PROFIT_COLUMNS).order("net_profit").limit(1000);
  if (error) throw error;
  return (data ?? []) as ProfitRow[];
}
export async function getProfit(contractId: string): Promise<ProfitRow | null> {
  const { data, error } = await db.from("contract_profit").select(PROFIT_COLUMNS).eq("contract_id", contractId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as ProfitRow | null;
}
export async function getLateFinancingRate(): Promise<number | null> {
  const { data, error } = await db.from("finance_settings").select("value").eq("key", "late_financing_pct_month").maybeSingle();
  if (error) throw error;
  return data ? Number((data as { value: number }).value) : null;
}

/** Finance's to-do across deals: open dues past or near their date with no live invoice. */
export type DueToInvoiceRow = OpenDueRow & { contract_id: string };
export async function listAllDuesToInvoice(): Promise<DueToInvoiceRow[]> {
  const [{ data: dues, error: e1 }, { data: links, error: e2 }] = await Promise.all([
    db.from("contract_dues").select("id, contract_id, payment_id, amount, share_pct, event_on, due_on").eq("status", "open").order("due_on").limit(1000),
    db.from("contract_invoice_dues").select("due_id, live").eq("live", true),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const invoiced = new Set(((links ?? []) as { due_id: string }[]).map((l) => l.due_id));
  return ((dues ?? []) as DueToInvoiceRow[]).filter((d) => !invoiced.has(d.id));
}
export async function listContractDeals(contractIds: string[]): Promise<Map<string, string>> {
  if (contractIds.length === 0) return new Map();
  const { data, error } = await db.from("contracts").select("id, opportunity_id").in("id", contractIds);
  if (error) throw error;
  return new Map(((data ?? []) as { id: string; opportunity_id: string }[]).map((c) => [c.id, c.opportunity_id]));
}
