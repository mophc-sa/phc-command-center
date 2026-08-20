// =============================================================================
// Broad invalidation after a sales state change.
//
// WHY THIS EXISTS
// ---------------
// Roughly a dozen query keys read the opportunities table under different
// names — `opps`, `opp`, `opportunities`, `opps-sales-stage`, `cc-core`,
// `report-opps`, `award-queue`, `unified-actions`, `today-panel` and the whole
// `ws-*` family. Each page invalidates only the handful it owns.
//
// That was harmless while staleTime was 0: every page refetched on mount, so a
// key nobody invalidated still came back fresh. Raising staleTime to 60s to fix
// the app's sluggishness removed that safety net — advance a stage on the JIH
// board, click through to Opportunities, and the old stage could sit there for
// a minute. A performance fix must not start hiding the user's own edit.
//
// So the state changes that ripple across pages invalidate everything.
//
// This is cheaper than it sounds: invalidateQueries only REFETCHES queries that
// are currently mounted — typically the one page in front of the user, which is
// exactly what used to happen on every navigation anyway. Everything else is
// merely marked stale and refetches if and when it is next shown.
//
// Narrow invalidation is still right for a change that only affects one screen.
// This is for the ones that do not.
// =============================================================================

import type { QueryClient } from "@tanstack/react-query";

/**
 * Call after a mutation whose result is visible on more than one screen —
 * stage transitions, approval decisions, intake approval, conversions.
 */
export function invalidateSalesData(qc: QueryClient): void {
  void qc.invalidateQueries();
}
