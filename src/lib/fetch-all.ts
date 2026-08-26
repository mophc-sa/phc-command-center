// =============================================================================
// Complete retrieval for authoritative metrics — or an admission that it isn't.
//
// THE DEFECT THIS REMOVES
// -----------------------
// The Command Center fetched `.limit(200)` opportunities, `.limit(100)`
// follow-ups and `.limit(400)` quotations, then computed open pipeline,
// weighted pipeline, forecast, coverage, At Risk, Needs Attention and Data
// Quality from whatever came back. At 49 records that is the whole book. At 201
// it is a confident, precise, WRONG total, with nothing on screen to say so —
// the same class of defect as the invented 0.20 weight and the invented 14-day
// SLA, except this one silently under-reports instead of over-reporting.
//
// A number that is quietly computed over 200 of 3,000 rows is worse than no
// number, because it looks exactly like a correct one.
//
// WHAT REPLACES IT
// ----------------
// Page through PostgREST with .range() until a short page arrives. RLS still
// decides what exists — this is the user's own client, so pagination cannot
// widen a result set, only finish reading it.
//
// A hard ceiling remains, because "fetch everything" with no bound is its own
// failure mode. The difference is that hitting the ceiling is REPORTED:
// `complete: false` travels with the rows, and the KPI layer turns that into a
// visible "not calculated" rather than a plausible total. Truncation is
// allowed; silent truncation is not.
// =============================================================================

/** PostgREST's own per-request maximum is typically 1000; stay under it. */
export const PAGE_SIZE = 500;

/**
 * Ceiling for one management view. Chosen to be far above the real book (49
 * today, low thousands plausibly) and low enough that a runaway query cannot
 * pull an entire database into a browser tab.
 */
export const MAX_ROWS = 10_000;

export type FetchAllResult<T> = {
  rows: T[];
  /** False when the ceiling stopped us — the caller MUST surface this. */
  complete: boolean;
};

/**
 * Read every row a filter matches, in pages.
 *
 * Takes a builder factory rather than a builder, because a PostgREST builder is
 * single-use: calling .range() twice on one instance mutates and re-sends the
 * same request. The factory produces a fresh query per page.
 */
/** The one method this needs from a PostgREST builder. Typed structurally so
 *  the helper does not depend on postgrest-js generics, which vary by table. */
export type RangeQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
};

export async function fetchAllRows<T>(
  makeQuery: () => RangeQuery<T>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<FetchAllResult<T>> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxRows = opts.maxRows ?? MAX_ROWS;
  const rows: T[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await makeQuery().range(from, to);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);

    // A short page means the filter is exhausted. This is the normal exit and
    // the only one that reports completeness.
    if (page.length < to - from + 1) return { rows, complete: true };
  }

  // We stopped because of the ceiling, not because the data ran out. Whether
  // more exists is unknown, so completeness cannot be claimed.
  return { rows, complete: false };
}

/**
 * Combine the completeness of several fetches.
 *
 * One truncated source makes every metric derived from the set unreliable, so
 * completeness is an AND. A dashboard where three of four queries were complete
 * is not three-quarters right; it is wrong in a way nobody can localise.
 */
export function allComplete(...results: Array<{ complete: boolean }>): boolean {
  return results.every((r) => r.complete);
}
