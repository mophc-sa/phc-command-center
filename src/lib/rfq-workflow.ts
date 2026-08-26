// =============================================================================
// Phase 5.1 §16 — RFQ age and workflow state, DERIVED, not invented.
//
// The donut this replaces read "Open: 8 — 100%", which is a chart of one fact.
// `rfq_status` has four values (open / converted / lost / on_hold) and three of
// them are terminal, so on a live desk almost everything is "open" and the
// widget says nothing.
//
// The useful distinctions already exist one join away: an RFQ points at an
// opportunity, and that opportunity's quotations carry a ten-value status. That
// chain answers "has anything gone out?" and "is someone pricing it?" without
// adding a second lifecycle for people to keep in sync.
//
//   rfqs.status ─────────────┐
//                            ├──▶ workflowStateOf() ──▶ one state + overdue flag
//   opportunity.quotations ──┘
//
// WHAT COULD NOT BE DERIVED, AND IS THEREFORE ABSENT:
//
//   awaiting_clarification   No field records that we asked the client
//                            something and are waiting. `inbox_items` has a
//                            need_information state, but that is intake, a
//                            different record, before an RFQ exists.
//   missing_information      Same gap.
//
// Both are reported in the Package C findings rather than approximated. An RFQ
// silently filed under "pricing" while it actually waits on the client is worse
// than a state that is honestly missing.
// =============================================================================

/** Statuses that mean a quotation has left the building. Shared meaning with
 *  `hasSubmittedQuotation` in sales-kpis.ts — lost and expired are outcomes OF
 *  a submission, not work still to be sent. */
const SUBMITTED_OR_BEYOND = new Set([
  "submitted",
  "follow_up",
  "negotiation",
  "revised",
  "won",
  "lost",
  "expired",
]);

/** Quotation exists but has not gone out. Someone is working on it. */
const IN_PRICING = new Set(["draft", "under_internal_review", "approved_for_submission"]);

/** Client has it and we are waiting on them. */
const WITH_CLIENT = new Set(["submitted", "follow_up", "negotiation", "revised"]);

export type RfqRow = {
  id: string;
  rfq_number?: string | null;
  received_date?: string | null;
  response_due_date?: string | null;
  status?: string | null;
  estimated_value?: number | string | null;
  opportunity_id?: string | null;
  classification?: string | null;
};

export type QuotationRow = {
  id: string;
  related_opportunity_id?: string | null;
  status?: string | null;
};

export type RfqWorkflowState =
  | "not_started"
  | "pricing"
  | "awaiting_client"
  | "converted"
  | "lost"
  | "on_hold";

export type RfqAgeBucket = "0-3" | "4-7" | "8-14" | "15+";

export const RFQ_AGE_BUCKETS: Array<{ key: RfqAgeBucket; maxDays: number | null }> = [
  { key: "0-3", maxDays: 3 },
  { key: "4-7", maxDays: 7 },
  { key: "8-14", maxDays: 14 },
  { key: "15+", maxDays: null },
];

export function ageBucketOf(days: number): RfqAgeBucket {
  return RFQ_AGE_BUCKETS.find((b) => b.maxDays !== null && days <= b.maxDays)?.key ?? "15+";
}

export function daysSince(fromIso: string, today: string): number | null {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export type RfqWorkflow = {
  rfqId: string;
  rfqNumber: string | null;
  state: RfqWorkflowState;
  /** Days since received_date. Null only when the date is unreadable. */
  ageDays: number | null;
  ageBucket: RfqAgeBucket | null;
  /**
   * Past its response date with nothing submitted. Kept as a FLAG rather than
   * a state, because an RFQ can be actively priced AND late — collapsing those
   * into one label would hide whichever half the ordering happened to favour.
   */
  overdue: boolean;
  daysOverdue: number | null;
  dueDate: string | null;
  value: number | null;
};

export function workflowStateOf(rfq: RfqRow, quotations: QuotationRow[]): RfqWorkflowState {
  // An explicit terminal status on the RFQ itself always wins — somebody set it.
  if (rfq.status === "converted") return "converted";
  if (rfq.status === "lost") return "lost";
  if (rfq.status === "on_hold") return "on_hold";

  const linked = rfq.opportunity_id
    ? quotations.filter((q) => q.related_opportunity_id === rfq.opportunity_id)
    : [];
  if (linked.some((q) => q.status && WITH_CLIENT.has(q.status))) return "awaiting_client";
  if (linked.some((q) => q.status && IN_PRICING.has(q.status))) return "pricing";
  // A quotation that reached a terminal outcome without the RFQ being updated
  // still means the work left the building, so it is not "not started".
  if (linked.some((q) => q.status && SUBMITTED_OR_BEYOND.has(q.status))) return "awaiting_client";
  return "not_started";
}

export function buildRfqWorkflow(
  rfqs: RfqRow[],
  quotations: QuotationRow[],
  today: string,
): RfqWorkflow[] {
  return rfqs.map((r) => {
    const state = workflowStateOf(r, quotations);
    const ageDays = r.received_date ? daysSince(r.received_date, today) : null;
    const dueOverBy = r.response_due_date ? daysSince(r.response_due_date, today) : null;
    // Only work still owed can be late. A converted or lost RFQ is finished,
    // and a submitted one met its deadline by definition.
    const stillOwed = state === "not_started" || state === "pricing";
    return {
      rfqId: r.id,
      rfqNumber: r.rfq_number ?? null,
      state,
      ageDays,
      ageBucket: ageDays === null ? null : ageBucketOf(ageDays),
      overdue: stillOwed && dueOverBy !== null && dueOverBy > 0,
      daysOverdue: stillOwed && dueOverBy !== null && dueOverBy > 0 ? dueOverBy : null,
      dueDate: r.response_due_date ?? null,
      value: r.estimated_value == null ? null : Number(r.estimated_value),
    };
  });
}

export type RfqAgeSummary = {
  bucket: RfqAgeBucket;
  count: number;
  value: number;
  ids: string[];
};

export function summarizeByAge(rows: RfqWorkflow[]): RfqAgeSummary[] {
  // Only RFQs that are still work in progress. Ageing a converted RFQ measures
  // how long ago we won it, which is not what this widget is for.
  const live = rows.filter((r) => r.state === "not_started" || r.state === "pricing" || r.state === "awaiting_client");
  return RFQ_AGE_BUCKETS.map(({ key }) => {
    const hit = live.filter((r) => r.ageBucket === key);
    return {
      bucket: key,
      count: hit.length,
      value: hit.reduce((s, r) => s + (r.value ?? 0), 0),
      ids: hit.map((r) => r.rfqId),
    };
  });
}

export function summarizeByState(rows: RfqWorkflow[]): Array<{ state: RfqWorkflowState; count: number; ids: string[] }> {
  const states: RfqWorkflowState[] = ["not_started", "pricing", "awaiting_client", "converted", "lost", "on_hold"];
  return states.map((state) => {
    const hit = rows.filter((r) => r.state === state);
    return { state, count: hit.length, ids: hit.map((r) => r.rfqId) };
  });
}
