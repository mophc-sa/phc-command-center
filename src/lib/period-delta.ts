// =============================================================================
// "+8.2% since last month" — but only when there is a last month to compare to.
//
// The reference dashboards this was modelled on put a green or red delta on
// every card. That works there because those products have history. This one
// mostly does not: the KPI engine computes current state, and nothing in it
// holds a prior-period figure. A delta on a card whose previous value is
// unknown would be a number invented to fill a shape — the exact failure this
// codebase has spent weeks removing from its dashboards.
//
// So the rule here is the same one the metric states already follow: compute it
// where the data supports it, and render **nothing** where it does not. A card
// with no delta is telling the truth about what is knowable.
//
// What is knowable today: anything with a per-record timestamp — opportunities
// by `created_at`, wins by `won_at`. Anything that is a snapshot of current
// state — open pipeline value, coverage, exposure — is not, because yesterday's
// snapshot was never stored.
//
// Pure. No clock is read here; the caller passes `now`, so a test can ask what
// last month looked like.
// =============================================================================

export type Delta = {
  /** Records in the current window. */
  current: number;
  /** Records in the window immediately before it. */
  previous: number;
  /** Change as a fraction. `null` when the previous window was empty — see below. */
  ratio: number | null;
  direction: "up" | "down" | "flat";
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The month containing `now`, and the one before it, as half-open [start, end). */
export function monthWindows(now: Date): {
  current: { start: string; end: string };
  previous: { start: string; end: string };
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    current: { start: ymd(new Date(Date.UTC(y, m, 1))), end: ymd(new Date(Date.UTC(y, m + 1, 1))) },
    previous: { start: ymd(new Date(Date.UTC(y, m - 1, 1))), end: ymd(new Date(Date.UTC(y, m, 1))) },
  };
}

/**
 * Month-over-month change in how many rows carry a date in each window.
 *
 * Returns `null` outright when nothing falls in either window: a delta between
 * two absences is not zero, it is unanswerable, and "0%" would read as "no
 * change" — a claim nobody can make.
 *
 * `ratio` is separately `null` when the previous window was empty but the
 * current one is not. Going from 0 to 5 is not "+500%"; it is a start, and the
 * card should say five rather than a percentage of nothing.
 */
export function monthOverMonth(
  dates: ReadonlyArray<string | null | undefined>,
  now: Date,
): Delta | null {
  const w = monthWindows(now);
  let current = 0;
  let previous = 0;
  for (const raw of dates) {
    if (!raw) continue;
    const d = raw.slice(0, 10);
    if (d >= w.current.start && d < w.current.end) current++;
    else if (d >= w.previous.start && d < w.previous.end) previous++;
  }

  if (current === 0 && previous === 0) return null;

  const ratio = previous === 0 ? null : (current - previous) / previous;
  const direction = current > previous ? "up" : current < previous ? "down" : "flat";
  return { current, previous, ratio, direction };
}
