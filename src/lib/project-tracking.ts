// Project tracking (manager feedback group 4, 2026-10-19).
// Spec: docs/superpowers/specs/2026-10-19-project-tracking-design.md

/**
 * What happened on a project. The same closed list as the database CHECK on
 * opportunity_updates.kind (20261022100000) -- a test holds the two together.
 * The manager's own examples were "offer sent", "PO received" and "awaiting
 * payment"; the rest are the steps either side of those.
 */
export const UPDATE_KINDS = [
  "offer_sent",
  "revised_offer_sent",
  "po_received",
  "contract_signed",
  "awaiting_payment",
  "payment_received",
  "awaiting_client",
  "site_visit",
  "progress_update",
  "other",
] as const;

export type UpdateKind = (typeof UPDATE_KINDS)[number];

export const UPDATE_KIND_LABEL: Record<UpdateKind, { en: string; ar: string }> = {
  offer_sent: { en: "Offer sent", ar: "تم إرسال العرض" },
  revised_offer_sent: { en: "Revised offer sent", ar: "تم إرسال عرض معدّل" },
  po_received: { en: "PO received", ar: "تم استلام أمر الشراء" },
  contract_signed: { en: "Contract signed", ar: "تم توقيع العقد" },
  awaiting_payment: { en: "Awaiting payment", ar: "بانتظار الدفعة" },
  payment_received: { en: "Payment received", ar: "تم استلام الدفعة" },
  awaiting_client: { en: "Awaiting client reply", ar: "بانتظار رد العميل" },
  site_visit: { en: "Site visit", ar: "زيارة موقع" },
  progress_update: { en: "Progress update", ar: "تحديث نسبة الإنجاز" },
  other: { en: "Other", ar: "أخرى" },
};

export const isUpdateKind = (v: string): v is UpdateKind =>
  (UPDATE_KINDS as readonly string[]).includes(v);

export type UpdateValidation =
  | { ok: true; pct: number | null }
  | { ok: false; reason: "note_required" | "pct_required" | "pct_invalid" };

/**
 * The form's answer before it reaches the database, which enforces the same
 * rules -- saying so here names the field instead of surfacing a constraint.
 * Blank % means "not reported", which is not 0.
 */
export function validateUpdate(input: { kind: UpdateKind; note: string; pct: string }): UpdateValidation {
  const raw = input.pct.trim();
  let pct: number | null = null;
  if (raw !== "") {
    if (!/^\d{1,3}$/.test(raw) || Number(raw) > 100) return { ok: false, reason: "pct_invalid" };
    pct = Number(raw);
  }
  if (input.kind === "progress_update" && pct === null) return { ok: false, reason: "pct_required" };
  if (input.kind === "other" && input.note.trim() === "") return { ok: false, reason: "note_required" };
  return { ok: true, pct };
}

/**
 * "Project — Contractor", the way the manager asked lists to read. Two deals
 * with the same project name for different contractors are different deals,
 * and a list showing the name alone makes them look like a duplicate.
 */
export function projectWithContractor(name: string | null | undefined, contractor: string | null | undefined): string {
  const n = name?.trim() ?? "";
  const c = contractor?.trim() ?? "";
  if (!c || c.toLowerCase() === n.toLowerCase()) return n;
  if (!n) return c;
  return `${n} — ${c}`;
}

type Money = number | string | null | undefined;
const toNumber = (v: Money): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * What the deal was awarded at. Kept apart from the estimate: the manager
 * asked for the two to stop sharing one figure. The contract value when there
 * is one; otherwise the quotation, but only once the deal is won. Before
 * award there is no awarded value, and the screen says "—".
 */
export function awardedValue(o: {
  stage?: string | null;
  sales_stage?: string | null;
  contract_value?: Money;
  quotation_value?: Money;
}): number | null {
  const contract = toNumber(o.contract_value);
  if (contract !== null) return contract;
  const won = o.stage === "won" || o.sales_stage === "won";
  return won ? toNumber(o.quotation_value) : null;
}
