// =============================================================================
// Why a deal is not in the forecast — and which deals those are.
//
// The Command Center has drawn this split since it shipped, as three integers
// counted inline and thrown away. That was enough to name the problem
// ("581 open deals carry no probability") and not enough to open it: every KPI
// card beside the donut opens its records, and the donut was the one figure on
// the page that ended the reader's journey instead of continuing it.
//
// So the classification returns the ROWS. The counts are `.length`.
//
// ORDER IS PART OF THE ANSWER
//
// A deal with no recorded value is counted as missing a value even when it
// also has no probability. Both are true; only one is worth telling the reader
// first, because entering a probability on a deal worth nothing still leaves
// it out of the forecast. Reporting the deeper gap is what makes the buckets
// mutually exclusive, and a reader who fixes them in the order shown never
// does work twice.
// =============================================================================

import { opportunityValue, type OppValueFields } from "@/lib/opportunity-value";

export type ReadinessKey = "no_value" | "no_probability" | "ready";

/** The three money columns, plus the one judgement the forecast weighs by. */
export type ReadinessRow = OppValueFields & {
  human_win_probability?: number | null;
};

/**
 * Split open deals by what keeps them out of the forecast.
 *
 * Every row lands in exactly one bucket, so the three lengths always sum to
 * the input and the donut's arcs add up to its hole.
 */
export function forecastReadiness<T extends ReadinessRow>(rows: readonly T[]): Record<ReadinessKey, T[]> {
  const out: Record<ReadinessKey, T[]> = { no_value: [], no_probability: [], ready: [] };
  for (const r of rows) {
    if (opportunityValue(r) === null) out.no_value.push(r);
    else if (r.human_win_probability === null || r.human_win_probability === undefined) out.no_probability.push(r);
    else out.ready.push(r);
  }
  return out;
}
