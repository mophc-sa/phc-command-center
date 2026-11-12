// The supplier quote check (PR 5): labels for pricing_quote_check()'s issues,
// which lines to send back, and the message the supplier reads in the portal.
// The rules themselves are in SQL (20261111100000); quote-check.test.ts pins this.
import type { Bi } from "@/lib/pricing-text";

export type QuoteIssue = "no_price" | "screen_price_missing" | "quantity_differs" | "spec_differs";

/** pricing_quote_check() row. No price column exists on it. */
export type QuoteIssueRow = {
  boq_line_id: string;
  line_number: number | null;
  sign_type: string;
  issues: QuoteIssue[];
  boq_quantity: number;
  quoted_quantity: number | null;
  spec_note: string | null;
};

export const ISSUE_LABEL: Record<QuoteIssue, Bi> = {
  no_price: { en: "No price", ar: "بلا سعر" },
  screen_price_missing: { en: "Price with the screen missing", ar: "سعر الشاشة ناقص" },
  quantity_differs: { en: "Quantity differs from the BOQ", ar: "الكمية تختلف عن جدول الكميات" },
  spec_differs: { en: "Spec differs (supplier's note)", ar: "المواصفة مختلفة (ملاحظة المورد)" },
};

/** What the supplier must fix. A written spec difference is a choice for Zayed, not a gap. */
const MUST_FIX: readonly QuoteIssue[] = ["no_price", "screen_price_missing", "quantity_differs"];
const needsSupplier = (r: QuoteIssueRow) => r.issues.some((i) => MUST_FIX.includes(i));

export const linesToReturn = (rows: readonly QuoteIssueRow[]): string[] =>
  rows.filter(needsSupplier).map((r) => r.boq_line_id);

const qty = (n: number | null) => (n == null ? "" : String(Number(n)));

function lineText(r: QuoteIssueRow, lang: "en" | "ar"): string {
  const parts = r.issues.filter((i) => MUST_FIX.includes(i)).map((i) => {
    if (i === "no_price") return lang === "en" ? "no price" : "بلا سعر";
    if (i === "screen_price_missing")
      return lang === "en" ? "the price with the screen is missing" : "سعر الشاشة ناقص";
    return lang === "en"
      ? `the quantity requested is ${qty(r.boq_quantity)}; you priced ${qty(r.quoted_quantity)}`
      : `الكمية المطلوبة ${qty(r.boq_quantity)}؛ سعّرتم ${qty(r.quoted_quantity)}`;
  });
  const label = lang === "en" ? `Line ${r.line_number ?? "?"}` : `البند ${r.line_number ?? "?"}`;
  return `- ${label} (${r.sign_type}): ${parts.join(lang === "en" ? "; " : "؛ ")}.`;
}

/** supplier_invitations.return_message and pricing_return_lines_to_supplier allow 1000 characters. */
export const MAX_MESSAGE = 1000;

/** The short form for a long list: line numbers per issue, in both languages. */
function compactMessage(fix: readonly QuoteIssueRow[]): string {
  const nums = (i: QuoteIssue) => fix.filter((r) => r.issues.includes(i)).map((r) => String(r.line_number ?? "?"));
  const used = MUST_FIX.filter((i) => nums(i).length > 0);
  return [
    "Please complete these lines and submit again:",
    ...used.map((i) => `${ISSUE_LABEL[i].en}: lines ${nums(i).join(", ")}.`),
    "يرجى استكمال هذه البنود وإعادة الإرسال:",
    ...used.map((i) => `${ISSUE_LABEL[i].ar}: البنود ${nums(i).join("، ")}.`),
  ].join("\n");
}

/**
 * The message for the portal: lines by number and sign type only (what the
 * supplier already sees), English then Arabic. A list too long for the portal
 * falls back to line numbers per issue, and is cut at MAX_MESSAGE as a last
 * resort (the lines themselves are what reopens). Empty when nothing needs the supplier.
 */
export function supplierMessage(rows: readonly QuoteIssueRow[]): string {
  const fix = rows.filter(needsSupplier);
  if (fix.length === 0) return "";
  const full = [
    "Please complete these lines and submit again:",
    ...fix.map((r) => lineText(r, "en")),
    "يرجى استكمال هذه البنود وإعادة الإرسال:",
    ...fix.map((r) => lineText(r, "ar")),
  ].join("\n");
  if (full.length <= MAX_MESSAGE) return full;
  const short = compactMessage(fix);
  return short.length <= MAX_MESSAGE ? short : `${short.slice(0, MAX_MESSAGE - 1)}…`;
}
