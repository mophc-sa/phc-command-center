// A typed number in a pricing box. The box keeps the text and this turns it into a
// number only when it is saved, so "1.0", "1.05" and "20.05" survive typing, and
// the same ambiguous commas the BOQ import refuses are refused here.
import { parseNumberResult, westernDigits } from "@/lib/boq-import";

export type DraftRules = {
  min?: number;
  /** The value must be above this (a price above 0). */
  above?: number;
  max?: number;
  /** The value must be below this (a margin below 100). */
  below?: number;
  integer?: boolean;
};
export type DraftFailure = "not_a_number" | "ambiguous" | "range" | "not_integer";
export type DraftResult = { ok: true; value: number | null } | { ok: false; reason: DraftFailure };

export function parseDraft(text: string, rules: DraftRules = {}): DraftResult {
  const s = westernDigits(text).trim();
  if (s === "") return { ok: true, value: null };
  // The import accepts "12 pcs"; a box that says "12 pcs" or "1.2.3" is a typo, not a number.
  if (!/^-?\d[\d,]*(?:\.\d+)?$/.test(s)) return { ok: false, reason: "not_a_number" };
  const r = parseNumberResult(s);
  if (!r.ok) return { ok: false, reason: r.reason };
  const v = r.value;
  if (v == null) return { ok: true, value: null };
  if (rules.integer && !Number.isInteger(v)) return { ok: false, reason: "not_integer" };
  if (
    (rules.min != null && v < rules.min) || (rules.above != null && v <= rules.above) ||
    (rules.max != null && v > rules.max) || (rules.below != null && v >= rules.below)
  ) return { ok: false, reason: "range" };
  return { ok: true, value: v };
}

/** The text a saved number starts as in its box. */
export const draftText = (n: number | null | undefined): string => (n == null ? "" : String(n));
