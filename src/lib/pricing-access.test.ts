import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  canBuildPrice, canEditCostRates, canEditFileInputs, canEditLineCost, canEditPackage, canSuggestExtras, canEditSelling,
  canOpenPricing, canSeePricingNav, canSetGlobalMargins, COST_READER_ROLES, daysWaiting, defaultQueueFilter,
  defaultTab, GM_QUEUE_STATES, inQueue, nextOwner, NO_RIGHTS, parsePricingTab, PRICER_QUEUE_STATES,
  visibleTabs, type PricingRights, canIssue, canMarkSent, canReturnLinesFromReview, canReview, canStartClientRound,
} from "@/lib/pricing-access";
import { PRICING_STATES } from "@/lib/pricing";

const read = (file: string) =>
  readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8").replace(/--[^\n]*/g, "");

const zayed: PricingRights = { ...NO_RIGHTS, is_pricer: true, can_read_cost: true, can_set_margins: true, is_finance: true };
const estimator: PricingRights = { ...NO_RIGHTS, is_pricer: true, can_read_cost: true };
const kalas: PricingRights = { ...NO_RIGHTS, is_gm: true, can_read_cost: true, can_set_margins: true };
const omar: PricingRights = { ...NO_RIGHTS, can_read_cost: true, can_issue_quotation: true };
const marie: PricingRights = { ...NO_RIGHTS, can_issue_quotation: true };

describe("who opens pricing", () => {
  it("pricers, the GM and cost readers; not a rep", () => {
    expect(canOpenPricing(zayed)).toBe(true);
    expect(canOpenPricing(kalas)).toBe(true);
    expect(canOpenPricing(omar)).toBe(true);
    expect(canOpenPricing(NO_RIGHTS)).toBe(false);
  });
  it("the sidebar shows Pricing to the cost-reading roles only", () => {
    expect(canSeePricingNav(["salesperson"])).toBe(false);
    expect(canSeePricingNav(["bd_manager"])).toBe(false);
    expect(canSeePricingNav(["sales_manager"])).toBe(true);
    expect(canSeePricingNav(["estimation_manager"])).toBe(true);
  });
  it("COST_READER_ROLES equals can_read_commercial_cost's role list in SQL", () => {
    const sql = read("20261103150000_sales_manager_reads_cost.sql");
    const list = sql.match(/ARRAY\[([\s\S]*?)\]::public\.app_role\[\]/)?.[1] ?? "";
    const roles = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(roles.length).toBeGreaterThan(3);
    expect([...COST_READER_ROLES].sort()).toEqual(roles);
  });
  it("the rights are the keys pricing_my_rights returns (its latest definition, PR 4)", () => {
    const body = read("20261110100000_pricing_review.sql");
    const fn = body.slice(body.indexOf("FUNCTION public.pricing_my_rights()"));
    const keys = [...fn.slice(0, fn.indexOf("$$;", 100)).matchAll(/'(\w+)',\s+coalesce/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(Object.keys(NO_RIGHTS).sort());
  });
});

describe("settings", () => {
  it("the global margin and the floor are the GM's or finance's, not an estimation-only pricer's", () => {
    expect(canSetGlobalMargins(kalas)).toBe(true);
    expect(canSetGlobalMargins(zayed)).toBe(true);
    expect(canSetGlobalMargins(estimator)).toBe(false);
    expect(canSetGlobalMargins(omar)).toBe(false);
  });
  it("cost rates, the fallback % and the catalog stay with any pricer", () => {
    expect(canEditCostRates(estimator)).toBe(true);
    expect(canEditCostRates(kalas)).toBe(false);
  });
});

describe("tabs", () => {
  it("cost readers see the cost tabs; nobody else does", () => {
    expect(visibleTabs(zayed)).toEqual(["package", "supplier", "cost", "selling", "approval", "quotations"]);
    expect(visibleTabs(NO_RIGHTS)).toEqual(["package", "supplier", "quotations"]);
  });
  it("opens on the tab the state is about", () => {
    expect(defaultTab("package_review", zayed)).toBe("package");
    expect(defaultTab("at_supplier", zayed)).toBe("supplier");
    expect(defaultTab("supplier_priced", kalas)).toBe("cost");
    expect(defaultTab("selling_build", kalas)).toBe("selling");
    expect(defaultTab("selling_build", NO_RIGHTS)).toBe("package");
  });
  it("parses the search param", () => {
    expect(parsePricingTab("cost")).toBe("cost");
    expect(parsePricingTab("approval")).toBe("approval");
    expect(parsePricingTab("invoices")).toBeUndefined();
  });
});

describe("the queue", () => {
  it("every state has someone who owes the next step", () => {
    for (const s of PRICING_STATES) expect(typeof nextOwner(s)).toBe("string");
    expect(nextOwner("needs_info")).toBe("sales");
    expect(nextOwner("at_supplier")).toBe("supplier");
    expect(nextOwner("supplier_priced")).toBe("gm");
    expect(nextOwner("price_review")).toBe("pricer");
  });
  it("Zayed's filter and Kalas's filter do not overlap", () => {
    expect(PRICER_QUEUE_STATES.filter((s) => GM_QUEUE_STATES.includes(s))).toEqual([]);
    expect(inQueue("supplier_priced", "gm")).toBe(true);
    expect(inQueue("supplier_priced", "pricer")).toBe(false);
    expect(inQueue("closed", "all")).toBe(false);
  });
  it("each opens on their own filter", () => {
    expect(defaultQueueFilter(zayed)).toBe("pricer");
    expect(defaultQueueFilter(kalas)).toBe("gm");
    expect(defaultQueueFilter(omar)).toBe("all");
  });
  it("counts whole days waiting, never negative", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    expect(daysWaiting("2026-11-01T11:00:00Z", now)).toBe(3);
    expect(daysWaiting("2026-11-05T11:00:00Z", now)).toBe(0);
  });
});

describe("edit gates mirror SQL", () => {
  it("package: a pricer in package review", () => {
    expect(canEditPackage("package_review", zayed)).toBe(true);
    expect(canEditPackage("package_review", kalas)).toBe(false);
    expect(canEditPackage("boq_frozen", zayed)).toBe(false);
  });
  it("file inputs: pricer or GM from the freeze to the selling build", () => {
    expect(canEditFileInputs("boq_frozen", zayed)).toBe(true);
    expect(canEditFileInputs("selling_build", kalas)).toBe(true);
    expect(canEditFileInputs("price_review", zayed)).toBe(false);
    expect(canEditFileInputs("selling_build", { ...kalas, can_read_cost: false })).toBe(false);
  });
  it("line cost choices: pricer or GM once the supplier has priced", () => {
    expect(canEditLineCost("supplier_priced", zayed)).toBe(true);
    expect(canEditLineCost("at_supplier", zayed)).toBe(false);
    expect(canEditLineCost("selling_build", { ...kalas, can_read_cost: false })).toBe(false);
  });
  it("suggesting extras opens earlier than deciding them: from the BOQ freeze to the selling build", () => {
    expect(canSuggestExtras("boq_frozen", zayed)).toBe(true);
    expect(canSuggestExtras("at_supplier", kalas)).toBe(true);
    expect(canSuggestExtras("selling_build", zayed)).toBe(true);
    expect(canSuggestExtras("package_review", zayed)).toBe(false);
    expect(canSuggestExtras("price_review", zayed)).toBe(false);
    expect(canSuggestExtras("at_supplier", { ...zayed, is_pricer: false })).toBe(false);
    expect(canEditLineCost("boq_frozen", zayed)).toBe(false);
  });
  it("selling: the GM in the selling build only", () => {
    expect(canEditSelling("selling_build", kalas)).toBe(true);
    expect(canEditSelling("selling_build", zayed)).toBe(false);
    expect(canEditSelling("supplier_priced", kalas)).toBe(false);
    expect(canEditSelling("selling_build", { ...kalas, can_read_cost: false })).toBe(false);
  });
  it("build: the GM who reads cost, in the selling build", () => {
    expect(canBuildPrice("selling_build", kalas)).toBe(true);
    expect(canBuildPrice("selling_build", { ...kalas, can_read_cost: false })).toBe(false);
  });
});

describe("PR 4: review, quotation, client round", () => {
  it("finance reviews, only in price review", () => {
    expect(canReview("price_review", zayed)).toBe(true);
    expect(canReview("selling_build", zayed)).toBe(false);
    expect(canReview("price_review", estimator)).toBe(false);
    expect(canReview("price_review", kalas)).toBe(false);
  });
  it("a pricer returns lines from price review", () => {
    expect(canReturnLinesFromReview("price_review", zayed)).toBe(true);
    expect(canReturnLinesFromReview("approved", zayed)).toBe(false);
    expect(canReturnLinesFromReview("price_review", kalas)).toBe(false);
  });
  it("the BD and sales manager issue an approved file and mark it sent", () => {
    expect(canIssue("approved", marie)).toBe(true);
    expect(canIssue("approved", omar)).toBe(true);
    expect(canIssue("quoted", marie)).toBe(false);
    expect(canIssue("approved", zayed)).toBe(false);
    expect(canMarkSent(marie)).toBe(true);
    expect(canMarkSent(NO_RIGHTS)).toBe(false);
  });
  it("a pricer opens a client round from a quoted file", () => {
    expect(canStartClientRound("quoted", zayed)).toBe(true);
    expect(canStartClientRound("approved", zayed)).toBe(false);
    expect(canStartClientRound("quoted", marie)).toBe(false);
  });
  it("cost readers see all six tabs; others see the quotations without cost", () => {
    expect(visibleTabs(zayed)).toEqual(["package", "supplier", "cost", "selling", "approval", "quotations"]);
    expect(visibleTabs(marie)).toEqual(["package", "supplier", "quotations"]);
  });
  it("the default tab follows the state", () => {
    expect(defaultTab("price_review", zayed)).toBe("approval");
    expect(defaultTab("approved", zayed)).toBe("quotations");
    expect(defaultTab("quoted", marie)).toBe("quotations");
    expect(defaultTab("selling_build", kalas)).toBe("selling");
  });
});
