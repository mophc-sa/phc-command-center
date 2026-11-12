// B3 (2026-11-12): invoices, receipts, claims and lateness. Every rule and
// figure is in SQL (20261112120000); these label and present them.
import type { AppRole } from "@/lib/roles";
import type { Bi } from "@/lib/pricing-text";

export type ClaimChannel = "email" | "letter" | "call" | "meeting" | "other";
export const CHANNEL_LABEL: Record<ClaimChannel, Bi> = {
  email: { en: "Email", ar: "بريد إلكتروني" },
  letter: { en: "Letter", ar: "خطاب" },
  call: { en: "Call", ar: "اتصال" },
  meeting: { en: "Meeting", ar: "اجتماع" },
  other: { en: "Other", ar: "أخرى" },
};

/** contract_receivables.tier: 0 on time, 1 late (the rep), 2 from 30 days (sales manager), 3 from 60 (the GM). */
export const TIER_LABEL: Record<0 | 1 | 2 | 3, Bi> = {
  0: { en: "On time", ar: "في موعده" },
  1: { en: "Late: claim it", ar: "متأخر: طالب به" },
  2: { en: "30+ days late", ar: "متأخر 30 يوماً فأكثر" },
  3: { en: "60+ days late: escalate", ar: "متأخر 60 يوماً فأكثر: صعّد" },
};

/** Who opens /collections: finance and management. Reps see their own deals' figures on the deal page. */
export const COLLECTIONS_ROLES: readonly AppRole[] = ["finance_manager", "sales_manager", "managing_director", "general_manager", "ceo"];
export const canSeeCollections = (roles: readonly AppRole[]): boolean => roles.some((r) => COLLECTIONS_ROLES.includes(r));

/** The meeting's two measures, in percent to one decimal. */
export function gauges(s: { contract_value: number; invoiced_excl_vat: number; invoiced_incl_vat: number; received: number }) {
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  return { invoicedPct: pct(Number(s.invoiced_excl_vat), Number(s.contract_value)), collectedPct: pct(Number(s.received), Number(s.invoiced_incl_vat)) };
}
