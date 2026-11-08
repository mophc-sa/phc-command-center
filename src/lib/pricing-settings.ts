// Pricing settings: the typed-number rules and the rights per row, mirroring the
// tables' CHECKs (20261103120000, 20261104120000). SQL decides; these only stop an
// obvious typo before the round trip. pricing-settings.test.ts pins it.
import { parseDraft, type DraftFailure, type DraftRules } from "@/lib/pricing-input";
import { canEditCostRates, canSetGlobalMargins, type PricingRights } from "@/lib/pricing-access";
import type { InstallationRateRow, LogisticsRateKey, RateInput } from "@/lib/pricing-actions";
import type { InstallType } from "@/lib/pricing";

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: DraftFailure; rules: DraftRules };

// Column sizes: numeric(14,2) < 1e12, numeric(14,4) < 1e10, numeric(10,2) < 1e8, numeric(6,2) < 1e4.
const MONEY: DraftRules = { min: 0, below: 1e12 };

/** logistics_rates.value: >= 0; the three percentages are below 100 (logistics_rates_pct_below_100). */
export const LOGISTICS_PCT_KEYS: readonly LogisticsRateKey[] = ["customs_pct", "install_fallback_pct", "default_margin_pct"];
export const logisticsRules = (key: LogisticsRateKey): DraftRules =>
  LOGISTICS_PCT_KEYS.includes(key) ? { min: 0, below: 100 } : { min: 0, below: 1e10 };

/** pricing_set_margin_floor: between -100 and 100, and a reason. */
export const FLOOR_RULES: DraftRules = { min: -100, max: 100 };

function required(text: string, rules: DraftRules): Parsed<number> {
  const r = parseDraft(text, rules);
  if (!r.ok) return { ok: false, reason: r.reason, rules };
  // An empty required box is not 0: it would save a rate the reader never typed.
  return r.value == null ? { ok: false, reason: "not_a_number", rules } : { ok: true, value: r.value };
}
function optional(text: string, rules: DraftRules): Parsed<number | null> {
  const r = parseDraft(text, rules);
  return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason, rules };
}

export const parseLogisticsValue = (key: LogisticsRateKey, text: string) => required(text, logisticsRules(key));
export const parseFloorValue = (text: string) => required(text, FLOOR_RULES);
export const parseCatalogRate = (text: string) => required(text, MONEY);
export const parseCatalogMinHeight = (text: string) => optional(text, { min: 0, below: 1e4 });

export type RateDraft = {
  install_type: InstallType;
  effective_from: string;
  base_rate: string;
  per_kg_over: string;
  weight_threshold_kg: string;
  per_m_over: string;
  height_threshold_m: string;
  floor_cut_add: string;
  scaffold_add: string;
  crane_add: string;
};
export type RateField = Exclude<keyof RateDraft, "install_type" | "effective_from">;
const THRESHOLD_KG: DraftRules = { min: 0, below: 1e8 };
const THRESHOLD_M: DraftRules = { min: 0, below: 1e4 };
export const RATE_RULES: Record<RateField, DraftRules> = {
  base_rate: MONEY, per_kg_over: MONEY, weight_threshold_kg: THRESHOLD_KG, per_m_over: MONEY,
  height_threshold_m: THRESHOLD_M, floor_cut_add: MONEY, scaffold_add: MONEY, crane_add: MONEY,
};
/** Base is typed; an empty add-on means 0; an empty threshold means none. */
const THRESHOLDS: readonly RateField[] = ["weight_threshold_kg", "height_threshold_m"];

export const emptyRateDraft = (today: string): RateDraft => ({
  install_type: "wall_screw", effective_from: today, base_rate: "", per_kg_over: "", weight_threshold_kg: "",
  per_m_over: "", height_threshold_m: "", floor_cut_add: "", scaffold_add: "", crane_add: "",
});

/** The rate form as the RPC takes it, or what is wrong in each box. A date before today is refused (the RPC's rule). */
export function parseRateDraft(
  d: RateDraft,
  today: string,
): { ok: true; value: RateInput } | { ok: false; errors: Partial<Record<RateField | "effective_from", Parsed<never> | "date">> } {
  const errors: Partial<Record<RateField | "effective_from", Parsed<never> | "date">> = {};
  const out: Partial<Record<RateField, number | null>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.effective_from) || d.effective_from < today) errors.effective_from = "date";
  for (const k of Object.keys(RATE_RULES) as RateField[]) {
    if (k === "base_rate") {
      const r = required(d[k], RATE_RULES[k]);
      if (r.ok) out[k] = r.value; else errors[k] = r as Parsed<never>;
    } else if (THRESHOLDS.includes(k)) {
      const r = optional(d[k], RATE_RULES[k]);
      if (r.ok) out[k] = r.value; else errors[k] = r as Parsed<never>;
    } else {
      const r = optional(d[k], RATE_RULES[k]);
      if (r.ok) out[k] = r.value ?? 0; else errors[k] = r as Parsed<never>;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      install_type: d.install_type, effective_from: d.effective_from,
      base_rate: out.base_rate as number, per_kg_over: out.per_kg_over as number, weight_threshold_kg: out.weight_threshold_kg ?? null,
      per_m_over: out.per_m_over as number, height_threshold_m: out.height_threshold_m ?? null,
      floor_cut_add: out.floor_cut_add as number, scaffold_add: out.scaffold_add as number, crane_add: out.crane_add as number,
    },
  };
}

/** A rate row is in force on `day` (YYYY-MM-DD): started, and not yet ended. */
export const rateInForce = (r: Pick<InstallationRateRow, "effective_from" | "effective_to">, day: string): boolean =>
  r.effective_from <= day && (r.effective_to == null || r.effective_to > day);

/**
 * Who may change a logistics row (logistics_rates_guard): default_margin_pct is the
 * GM's or finance's (can_set_margins); every other key, the install fallback % included, is a pricer's.
 */
export const canEditLogisticsKey = (key: LogisticsRateKey, r: PricingRights): boolean =>
  key === "default_margin_pct" ? canSetGlobalMargins(r) : canEditCostRates(r);

/** A stable catalog code from the English name: lower case, words joined by _, 2-40 characters (the table's CHECK ^[a-z_]{2,40}$). */
export const catalogCodeFrom = (name: string): string =>
  name.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40).replace(/_+$/g, "");
