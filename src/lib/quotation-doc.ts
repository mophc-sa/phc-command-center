// Pure helpers for the quotation screens and the printed quotation. The figures
// come from SQL (quotation_revisions, quotation_revision_lines); these only
// format and cross-check them. quotation-doc.test.ts pins them.
import type { Bi } from "@/lib/pricing-text";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Display only: the line total is the figure; the unit price is derived from it. */
export const unitPrice = (lineTotal: number, qty: number): number | null => (qty > 0 ? round2(lineTotal / qty) : null);

/** Mirrors the generated column round(subtotal * rate, 2). */
export const vatOf = (subtotal: number, rate: number): number => round2(subtotal * rate);

/** True when the lines add up to the subtotal to the halala. */
export const linesMatch = (lines: readonly { line_total: number }[], subtotal: number): boolean =>
  lines.reduce((s, l) => s + Math.round(Number(l.line_total) * 100), 0) === Math.round(Number(subtotal) * 100);

/** 7C numbers revisions from 1; the client and the meeting call the first one Rev 0. */
export const revisionLabel = (revisionNumber: number): string => `Rev ${revisionNumber - 1}`;

export type QuoteRevisionStatus = "draft" | "pending_approval" | "approved" | "submitted" | "superseded" | "withdrawn";
export const QUOTE_STATUS_LABEL: Record<QuoteRevisionStatus, Bi> = {
  draft: { en: "Draft", ar: "مسودة" },
  pending_approval: { en: "Pending approval", ar: "بانتظار الاعتماد" },
  approved: { en: "Ready to send", ar: "جاهز للإرسال" },
  submitted: { en: "Sent to the client", ar: "أُرسل للعميل" },
  superseded: { en: "Replaced", ar: "استُبدل" },
  withdrawn: { en: "Withdrawn", ar: "سُحب" },
};
