/**
 * A quotation whose deal is archived (a duplicate or a soft-deleted deal) is
 * history, not activity: counting it put the same tender into "quotations
 * sent" once per copy (2026-11-16 dedupe). Read quotations with
 * QUOTE_DEAL_STAGE embedded and pass them through liveQuotes before counting.
 * A quotation with no deal is kept.
 */
export const QUOTE_DEAL_STAGE = "deal:opportunities(stage)";

export function liveQuotes<T>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(
    (q) => (q as { deal?: { stage?: string | null } | null }).deal?.stage !== "archived",
  );
}
