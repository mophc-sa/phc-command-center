// =============================================================================
// Pricing loop — shared types and the pure mirror of the SQL rules
// (spec 2026-11-03-pricing-loop-design; migrations 20261103100000–150000).
//
// The database is the authority: these exist so screens can show the right
// buttons and figures before a round trip. pricing.contract.test.ts keeps
// PRICER_MOVES / GM_MOVES equal to the SQL transition list.
// =============================================================================

export type PricingState =
  | "received"
  | "package_review"
  | "needs_info"
  | "boq_frozen"
  | "at_supplier"
  | "supplier_priced"
  | "selling_build"
  | "price_review"
  | "approved"
  | "quoted"
  | "closed";

export const PRICING_STATES: readonly PricingState[] = [
  "received",
  "package_review",
  "needs_info",
  "boq_frozen",
  "at_supplier",
  "supplier_priced",
  "selling_build",
  "price_review",
  "approved",
  "quoted",
  "closed",
];

export const PRICING_STATE_LABEL: Record<PricingState, { en: string; ar: string }> = {
  received: { en: "Received for pricing", ar: "وارد للتسعير" },
  package_review: { en: "Package review", ar: "دراسة الباكيج" },
  needs_info: { en: "Missing items with sales", ar: "نواقص لدى المبيعات" },
  boq_frozen: { en: "BOQ frozen", ar: "الكميات مجمّدة" },
  at_supplier: { en: "At supplier", ar: "عند المورد" },
  supplier_priced: { en: "Supplier priced, with the GM", ar: "سعّر المورد — لدى المدير العام" },
  selling_build: { en: "GM setting the selling price", ar: "المدير العام يضع سعر البيع" },
  price_review: { en: "Price review (finance)", ar: "مراجعة السعر (المالية)" },
  approved: { en: "Approved", ar: "معتمد" },
  quoted: { en: "Quoted to client", ar: "أُرسل العرض للعميل" },
  closed: { en: "Closed", ar: "مغلق" },
};

/**
 * Moves a pricer (estimation or finance) makes with pricing_file_move: the
 * 'pricer' rows of pricing_file_transitions. Missing items go through
 * pricing_file_set_needs_info / _answer_needs_info; price_review, approved and
 * quoted are reached by the price's own moves ('system'); closing is separate.
 */
export const PRICER_MOVES: ReadonlyArray<readonly [PricingState, PricingState]> = [
  ["received", "package_review"],
  ["package_review", "boq_frozen"],
  ["boq_frozen", "at_supplier"],
  ["at_supplier", "supplier_priced"],
  ["supplier_priced", "at_supplier"],
  ["price_review", "at_supplier"],
  ["quoted", "boq_frozen"],
];

/** Moves the GM (or an active delegate) makes: the 'gm' rows. The supplier's prices go to him to build the selling price. */
export const GM_MOVES: ReadonlyArray<readonly [PricingState, PricingState]> = [
  ["supplier_priced", "selling_build"],
];

/** Pricer moves, including closing: any open file may be closed (with a reason) by a pricer. */
export function canPricerMove(from: PricingState, to: PricingState): boolean {
  if (to === "closed") return from !== "closed";
  return PRICER_MOVES.some(([a, b]) => a === from && b === to);
}

/** GM moves. The GM cannot close a file: pricing_file_move reserves that for pricers. */
export function canGmMove(from: PricingState, to: PricingState): boolean {
  return GM_MOVES.some(([a, b]) => a === from && b === to);
}

export type InstallType = "double_tape" | "wall_screw" | "pylon" | "ceiling" | "floor";

export type InstallationRate = {
  install_type: InstallType;
  base_rate: number;
  per_kg_over: number;
  weight_threshold_kg: number | null;
  per_m_over: number;
  height_threshold_m: number | null;
  floor_cut_add: number;
  scaffold_add: number;
  crane_add: number;
};

/**
 * Mirror of public.pricing_installation_cost (20261103130000), for a rate the
 * caller already picked as in force. Null means no rate: use the % fallback.
 *
 * Same arithmetic: base + per_kg_over x kg over the weight threshold + per_m_over
 * x metres over the height threshold + floor_cut_add if the floor is cut +
 * scaffold_add for a ceiling sign mounted above the height threshold. A null
 * threshold means nothing is "over"; missing weight/height count as 0. The SQL
 * does not use crane_add, so neither does this. SQL numeric is exact and unrounded
 * (inputs have 2 decimals, so products have at most 4); the result is rounded to
 * 4 decimals only to drop floating-point noise.
 */
export function installationCost(
  rate: InstallationRate | null,
  line: { weightKg?: number | null; mountHeightM?: number | null; floorCut?: boolean },
): number | null {
  if (!rate) return null;
  const w = line.weightKg ?? 0;
  const h = line.mountHeightM ?? 0;
  const overW = rate.weight_threshold_kg == null ? 0 : Math.max(0, w - rate.weight_threshold_kg);
  const overH = rate.height_threshold_m == null ? 0 : Math.max(0, h - rate.height_threshold_m);
  const scaffold =
    rate.install_type === "ceiling" &&
    rate.height_threshold_m != null &&
    h > rate.height_threshold_m
      ? rate.scaffold_add
      : 0;
  const total =
    rate.base_rate +
    rate.per_kg_over * overW +
    rate.per_m_over * overH +
    (line.floorCut ? rate.floor_cut_add : 0) +
    scaffold;
  return Math.round(total * 1e4) / 1e4;
}
