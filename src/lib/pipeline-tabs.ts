// =============================================================================
// The /quotations tab contract.
//
// This lived inline in the route's `validateSearch` as a nested ternary, and
// the only thing guarding it was a contract test grepping the route file for
// the strings `s.tab === "rfq_jih"` and `s.tab === "boq"`. That grep proves the
// comparisons are written; it cannot say what the parser returns, and it stays
// green if a fourth tab is added to the UI and not to the parser — which is the
// same shape as the drilldown bug the opportunities list carried.
//
// /rfq-jih and /boq are retired routes that redirect in here carrying a tab, so
// the parser is a real entry point, not an internal detail.
// =============================================================================

export const PIPELINE_TABS = ["quotations", "rfq_jih", "boq"] as const;

export type PipelineTab = (typeof PIPELINE_TABS)[number];

/** The tab shown when the URL says nothing, or says something unrecognised. */
export const DEFAULT_PIPELINE_TAB: PipelineTab = "quotations";

export function isPipelineTab(v: unknown): v is PipelineTab {
  return typeof v === "string" && (PIPELINE_TABS as readonly string[]).includes(v);
}

/**
 * Parses the route's search params. Anything unrecognised falls back to the
 * default rather than throwing — a bad bookmark should open the page, not an
 * error boundary.
 */
export function parsePipelineSearch(s: Record<string, unknown>): { tab: PipelineTab } {
  return { tab: isPipelineTab(s.tab) ? s.tab : DEFAULT_PIPELINE_TAB };
}
