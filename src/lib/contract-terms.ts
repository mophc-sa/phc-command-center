// B1 (2026-11-12): the contract's terms and payment schedule. SQL computes and
// enforces everything (20261112100000); these mirror it for the form's preview.
// contract-terms.test.ts pins them to the same worked examples as the pgTAP file.
import type { Bi } from "@/lib/pricing-text";

export type PaymentKind = "advance" | "drawings_approval" | "mir" | "wir" | "other";
export type TermsStatus = "draft" | "in_review" | "returned" | "approved";

export const PAYMENT_KIND_LABEL: Record<PaymentKind, Bi> = {
  advance: { en: "Advance", ar: "دفعة مقدمة" },
  drawings_approval: { en: "After drawing approval", ar: "بعد اعتماد الرسومات" },
  mir: { en: "After supply (MIR)", ar: "بعد التوريد (MIR)" },
  wir: { en: "Final, after installation (WIR)", ar: "نهائية بعد التركيب (WIR)" },
  other: { en: "Other", ar: "أخرى" },
};
export const TERMS_STATUS_LABEL: Record<TermsStatus, Bi> = {
  draft: { en: "Draft", ar: "مسودة" },
  in_review: { en: "With finance", ar: "لدى المالية" },
  returned: { en: "Returned", ar: "مُرجع" },
  approved: { en: "Approved", ar: "معتمد" },
};

export type PaymentDraft = { kind: PaymentKind; pct: number; label?: string; expected_on?: string };
/** The meeting's usual sequence (advance 20-30%); every percentage is editable. */
export const DEFAULT_PAYMENTS: readonly PaymentDraft[] = [
  { kind: "advance", pct: 30 },
  { kind: "drawings_approval", pct: 20 },
  { kind: "mir", pct: 30 },
  { kind: "wir", pct: 20 },
];
export const DEFAULT_PERIOD = { drawingsDays: 5, supplyInstallDays: 45, handoverDays: 10, creditDays: 30 } as const;

const cents = (n: number) => Math.round(n * 100);
/** Sum of percentages, to 3 decimals (pct is numeric(6,3) in SQL). */
export const pctTotal = (rows: readonly { pct: number }[]): number =>
  rows.reduce((s, r) => s + Math.round(r.pct * 1000), 0) / 1000;

/** round(value * pct / 100, 2) for each payment but the last, which takes the remainder. */
export function paymentAmounts(value: number, rows: readonly { pct: number }[]): number[] {
  let running = 0;
  return rows.map((r, i) => {
    const amt = i < rows.length - 1 ? cents((value * r.pct) / 100) : cents(value) - running;
    running += amt;
    return amt / 100;
  });
}

export type Period = { signedOn: string; drawingsDays: number; supplyInstallDays: number; handoverDays: number };
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The expected date of a payment from the signing date and the execution period (null without a signing date). */
export function expectedDate(kind: PaymentKind, p: Period): string | null {
  if (!p.signedOn) return null;
  switch (kind) {
    case "advance": return p.signedOn;
    case "drawings_approval": return addDays(p.signedOn, p.drawingsDays);
    case "mir": return addDays(p.signedOn, p.drawingsDays + p.supplyInstallDays);
    case "wir": return addDays(p.signedOn, p.drawingsDays + p.supplyInstallDays + p.handoverDays);
    case "other": return null;
  }
}

/** The contract value against the quotation's; null when they are equal. */
export function valueDifference(value: number, quoted: number): { amount: number; pct: number } | null {
  if (cents(value) === cents(quoted)) return null;
  const amount = (cents(value) - cents(quoted)) / 100;
  return { amount, pct: quoted ? Math.round((amount / quoted) * 10000) / 100 : 0 };
}

/** B2: what is left of a payment's share, to 3 decimals (the default for the next approval). */
export const shareLeft = (shareDue: number): number => Math.max(0, Math.round((100 - shareDue) * 1000) / 1000);
