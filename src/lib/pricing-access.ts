// Who may do what on the pricing screens: a mirror of the SQL rules
// (pricing_my_rights, the RPCs' state checks). SQL decides; this only chooses
// which buttons and tabs to show. pricing-access.test.ts pins it.
import type { AppRole } from "@/lib/roles";
import type { PricingState } from "@/lib/pricing";
import type { Bi } from "@/lib/pricing-text";

/** pricing_my_rights() (20261104120000). can_set_margins: the GM, a price-authority delegate, finance. */
export type PricingRights = {
  is_pricer: boolean;
  is_gm: boolean;
  can_read_cost: boolean;
  can_set_margins: boolean;
  /** 20261110100000: finance reviews the GM's price (pricing_file_review). */
  is_finance: boolean;
  /** 20261110100000: the BD or sales manager issues and sends the quotation. */
  can_issue_quotation: boolean;
};
export const NO_RIGHTS: PricingRights = {
  is_pricer: false,
  is_gm: false,
  can_read_cost: false,
  can_set_margins: false,
  is_finance: false,
  can_issue_quotation: false,
};

/** can_read_commercial_cost's roles (20261103150000). The sidebar shows Pricing to them. */
export const COST_READER_ROLES: readonly AppRole[] = [
  "estimation_manager",
  "finance_manager",
  "sales_manager",
  "managing_director",
  "general_manager",
  "ceo",
];
export const canSeePricingNav = (roles: readonly AppRole[]): boolean =>
  roles.some((r) => COST_READER_ROLES.includes(r));

/** A GM delegate is known only to SQL, so pages ask pricing_my_rights(). */
export const canOpenPricing = (r: PricingRights): boolean => r.is_pricer || r.is_gm || r.can_read_cost;

export type PricingTab = "package" | "supplier" | "cost" | "selling" | "approval" | "quotations";
export const PRICING_TABS: readonly PricingTab[] = ["package", "supplier", "cost", "selling", "approval", "quotations"];
export const PRICING_TAB_LABEL: Record<PricingTab, Bi> = {
  package: { en: "Package", ar: "الباكيج" },
  supplier: { en: "Supplier", ar: "المورد" },
  cost: { en: "Cost review", ar: "مراجعة التكلفة" },
  selling: { en: "Selling price", ar: "سعر البيع" },
  approval: { en: "Approval", ar: "الاعتماد" },
  quotations: { en: "Quotations", ar: "عروض الأسعار" },
};
export const parsePricingTab = (v: unknown): PricingTab | undefined =>
  typeof v === "string" && (PRICING_TABS as readonly string[]).includes(v) ? (v as PricingTab) : undefined;

/** Cost, Selling and Approval show cost (RLS returns nothing to anyone else anyway); Quotations shows selling figures only. */
export const visibleTabs = (r: PricingRights): PricingTab[] =>
  r.can_read_cost ? [...PRICING_TABS] : ["package", "supplier", "quotations"];

export function defaultTab(state: PricingState, r: PricingRights): PricingTab {
  const want: PricingTab =
    state === "supplier_priced"
      ? "cost"
      : state === "selling_build"
        ? "selling"
        : state === "price_review"
          ? "approval"
          : state === "approved" || state === "quoted"
            ? "quotations"
            : state === "boq_frozen" || state === "at_supplier"
              ? "supplier"
              : "package";
  return visibleTabs(r).includes(want) ? want : "package";
}

export type NextOwner = "pricer" | "sales" | "supplier" | "gm" | "bd" | "none";
export function nextOwner(state: PricingState): NextOwner {
  switch (state) {
    case "received":
    case "package_review":
    case "boq_frozen":
    case "price_review":
      return "pricer";
    case "needs_info":
    case "quoted":
      return "sales";
    case "at_supplier":
      return "supplier";
    case "supplier_priced":
    case "selling_build":
      return "gm";
    case "approved":
      return "bd";
    case "closed":
      return "none";
  }
}
export const NEXT_OWNER_LABEL: Record<NextOwner, Bi> = {
  pricer: { en: "Estimation & finance", ar: "التقدير والمالية" },
  sales: { en: "Sales", ar: "المبيعات" },
  supplier: { en: "Supplier", ar: "المورد" },
  gm: { en: "GM (selling price)", ar: "المدير العام (سعر البيع)" },
  bd: { en: "BD (quotation)", ar: "تطوير الأعمال (عرض السعر)" },
  none: { en: "Nobody", ar: "لا أحد" },
};

export type QueueFilter = "all" | "pricer" | "gm";
/** Zayed's stages, including the ones waiting on sales or the supplier for his files. */
export const PRICER_QUEUE_STATES: readonly PricingState[] = [
  "received", "package_review", "needs_info", "boq_frozen", "at_supplier", "price_review",
];
/** Kalas's "set selling price" queue (spec §4.5). */
export const GM_QUEUE_STATES: readonly PricingState[] = ["supplier_priced", "selling_build"];
export function inQueue(state: PricingState, filter: QueueFilter): boolean {
  if (state === "closed") return false;
  if (filter === "pricer") return PRICER_QUEUE_STATES.includes(state);
  if (filter === "gm") return GM_QUEUE_STATES.includes(state);
  return true;
}
export const defaultQueueFilter = (r: PricingRights): QueueFilter =>
  r.is_gm && !r.is_pricer ? "gm" : r.is_pricer && !r.is_gm ? "pricer" : "all";

export function daysWaiting(since: string, now: Date = new Date()): number {
  const ms = now.getTime() - Date.parse(since);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

/** pricing_boq_import / _line_delete / _attach_revision / _freeze_boq / needs info. */
export const canEditPackage = (s: PricingState, r: PricingRights): boolean => r.is_pricer && s === "package_review";
/** pricing_answer_needs_info: a pricer records the rep's answer while the file is waiting on information. */
export const canAnswerNeedsInfo = (s: PricingState, r: PricingRights): boolean => r.is_pricer && s === "needs_info";
/** pricing_file_set_inputs (cost keys). The caller must read cost (a GM delegate may not). */
export const canEditFileInputs = (s: PricingState, r: PricingRights): boolean =>
  (r.is_pricer || r.is_gm) && r.can_read_cost && ["boq_frozen", "at_supplier", "supplier_priced", "selling_build"].includes(s);
/**
 * pricing_file_set_line (cost keys; needs cost access), pricing_decide_extra, pricing_add_extra:
 * supplier_priced and selling_build only. The panels using it sit on the cost-only tabs.
 */
export const canEditLineCost = (s: PricingState, r: PricingRights): boolean =>
  (r.is_pricer || r.is_gm) && r.can_read_cost && (s === "supplier_priced" || s === "selling_build");
/** pricing_suggest_extras (20261104130000): a wider window than the above, from boq_frozen to selling_build. */
export const canSuggestExtras = (s: PricingState, r: PricingRights): boolean =>
  (r.is_pricer || r.is_gm) && ["boq_frozen", "at_supplier", "supplier_priced", "selling_build"].includes(s);
/** pricing_file_set_line (margin_pct, selling_price) and the file's default margin: the GM who reads cost. */
export const canEditSelling = (s: PricingState, r: PricingRights): boolean =>
  r.is_gm && r.can_read_cost && s === "selling_build";
/** pricing_file_build_price / pricing_file_propose. */
export const canBuildPrice = (s: PricingState, r: PricingRights): boolean =>
  r.is_gm && r.can_read_cost && s === "selling_build";

/**
 * Settings: the global default margin and the margin floor are the GM's or
 * finance's (can_set_pricing_margins); an estimation-only pricer may not.
 */
export const canSetGlobalMargins = (r: PricingRights): boolean => r.can_set_margins;
/** Settings: installation rates, logistics rates, the install fallback % and the extras catalog (is_pricer). */
export const canEditCostRates = (r: PricingRights): boolean => r.is_pricer;

// ---- PR 4 ---------------------------------------------------------------------

/** pricing_file_review: finance, while the file is in price review. */
export const canReview = (s: PricingState, r: PricingRights): boolean => r.is_finance && s === "price_review";
/** pricing_return_lines_to_supplier from price review (a pricer; finance holds estimation too). */
export const canReturnLinesFromReview = (s: PricingState, r: PricingRights): boolean =>
  r.is_pricer && r.can_read_cost && s === "price_review";
/** pricing_issue_quotation: the BD or sales manager, once the price is approved. */
export const canIssue = (s: PricingState, r: PricingRights): boolean => r.can_issue_quotation && s === "approved";
/** pricing_mark_quotation_sent: the same people, on the current approved revision. */
export const canMarkSent = (r: PricingRights): boolean => r.can_issue_quotation;
/** pricing_file_client_round: a pricer, from a quoted file. */
export const canStartClientRound = (s: PricingState, r: PricingRights): boolean => r.is_pricer && s === "quoted";
