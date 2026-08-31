// =============================================================================
// Render a slice of a long list, and say how much is not shown.
//
// WHY THIS EXISTS
// The lists here render every matching row. That was invisible at 49
// opportunities and is not at 739: each row is a link wrapping a seven-column
// grid with badges and dates -- call it thirty DOM nodes -- so the list alone
// builds around twenty-two thousand of them, and React reconciles all of it on
// every keystroke in the filter box. The data was never the problem; the
// production query returns in under a millisecond. The browser was.
//
// WHY A WINDOW AND NOT A VIRTUALISER
// A virtualiser renders only what fits the viewport, which is faster still --
// and it brings a dependency, breaks Ctrl+F, breaks print, and needs measured
// row heights that this grid does not have. A window costs one useState, keeps
// the page a plain document, and takes the render from 739 rows to 50.
//
// WHY IT ALWAYS REPORTS THE TOTAL
// A list that quietly shows the first fifty of 739 is lying by omission --
// someone scrolls to the end, sees no more rows, and concludes that is
// everything. `total` and `hidden` exist so the UI can say what it is holding
// back. Filtering and sorting still run over the whole set; only the drawing
// is bounded.
// =============================================================================

import { useEffect, useMemo, useState } from "react";

/** Rows drawn before the reader asks for more. */
export const WINDOW_SIZE = 50;

/**
 * The whole calculation, as a function of rows and a limit.
 *
 * Split out from the hook so it can be tested without a renderer -- this repo
 * has no React testing library, and adding one to cover a slice() would be a
 * dependency bought for a test rather than for the product.
 */
export function windowOf<T>(rows: readonly T[], limit: number) {
  const shown = Math.min(Math.max(limit, 0), rows.length);
  return {
    visible: rows.slice(0, shown),
    total: rows.length,
    shown,
    hidden: rows.length - shown,
    hasMore: rows.length > shown,
  };
}

/**
 * Next limit after "show more", clamped so repeated presses cannot inflate it
 * past the list and make `hidden` go negative.
 */
export function nextLimit(current: number, step: number, total: number): number {
  return Math.min(current + step, Math.max(total, step));
}

export type Windowed<T> = {
  /** The slice to render. */
  visible: T[];
  /** Everything, for counts -- never render this. */
  total: number;
  shown: number;
  hidden: number;
  hasMore: boolean;
  /** Extend the window by one step. */
  showMore: () => void;
  /** Extend it to everything, for printing or a deliberate full read. */
  showAll: () => void;
};

/**
 * @param rows   the fully filtered and sorted list
 * @param resetKey changes to this collapse the window back to one step. Pass
 *   the filter and sort state: without it, narrowing a search from 739 rows to
 *   12 would keep a window of 500 and the reset would never be felt -- and
 *   worse, widening it again would render everything at once.
 */
export function useWindowedList<T>(
  rows: readonly T[],
  resetKey: unknown = null,
  step: number = WINDOW_SIZE,
): Windowed<T> {
  const [limit, setLimit] = useState(step);

  // Collapse on a new filter/sort. Keyed on the caller's own state rather than
  // on `rows.length`, which would also fire when a row is merely edited.
  useEffect(() => {
    setLimit(step);
  }, [resetKey, step]);

  const w = useMemo(() => windowOf(rows, limit), [rows, limit]);

  return {
    ...w,
    showMore: () => setLimit((n) => nextLimit(n, step, rows.length)),
    showAll: () => setLimit(rows.length),
  };
}
