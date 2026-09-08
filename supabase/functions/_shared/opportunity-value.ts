// =============================================================================
// What an opportunity is worth. One rule, one file.
//
// This lived inside sales-kpis.ts, which imports the stage resolver — so
// stage-canonical.ts could not reach it without a cycle, and had kept its own
// copy of the chain instead. A rule that cannot be imported gets duplicated,
// and a duplicated rule drifts: by 2026-08-30 there were five variants of it
// across thirteen call sites, one of them named `opportunityValue` and doing
// something else.
//
// It sits below both modules now, so there is nothing left to copy it into.
// sales-kpis re-exports it, so every existing import keeps working.
// =============================================================================

/**
 * Just the three money columns — see opportunityValue.
 *
 * Written structurally rather than as `Pick<OppRow, …>`. It used to derive from
 * OppRow, which is why it lived in sales-kpis and could not be imported from
 * below it. Stating the three fields directly is also what the function
 * actually needs: a caller passing a project row, an attention row or a
 * drilldown row satisfies it without having to be an OppRow, and every one of
 * those was reaching for its own formula instead.
 *
 * Optional, because callers hold rows selected from different queries and a
 * column that was not selected is absent rather than null.
 */
export type OppValueFields = {
  contract_value?: number | string | null;
  quotation_value?: number | string | null;
  estimated_value_max?: number | string | null;
};

/**
 * The money figure for an opportunity, most-committed first.
 *
 * contract_value is what was actually contracted; quotation_value is what was
 * quoted; estimated_value_max is a guess. Returning null (not 0) when all three
 * are absent matters: a deal with no value is not a deal worth nothing, and
 * summing it as 0 silently understates the pipeline.
 *
 * Takes only those three fields rather than a whole OppRow. Every caller that
 * merely wants the money — computeJihPipelineTotal among them — would otherwise
 * have to fetch and pass an `id` it has no use for.
 */
export function opportunityValue(o: OppValueFields): number | null {
  for (const v of [o.contract_value, o.quotation_value, o.estimated_value_max]) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Add up what a set of opportunities is worth, and say what was left out.
 *
 * Counted on 2026-08-30, this app had **five different formulas** for one
 * concept across thirteen call sites, none of them this function:
 *
 *   contract ?? quotation ?? estimated ?? 0    team-dashboard, sales-ai
 *   contract ?? estimated ?? 0                 award-queue ×2, my-workspace
 *   quotation ?? estimated ?? 0                targets-metrics
 *   estimated ?? 0                             RfqJihPanel ×2, projects,
 *                                              accounts, my-workspace ×3
 *
 * The last one is not a rounding difference. A deal with a **signed contract**
 * worth SAR 14M and no estimate counted as **zero** on My Workspace and at full
 * value on the Command Center — two dashboards, two totals, same book, and
 * nothing on either screen to say they disagreed. That is precisely the failure
 * the engine exists to prevent.
 *
 * The `?? 0` is the second defect and the quieter one. `opportunityValue`
 * returns `null` on purpose: a deal with no recorded value is not a deal worth
 * nothing. Summing it as 0 silently folds "unknown" into "zero", which makes a
 * total look complete when it is not.
 *
 * So this returns the count as well. A caller that shows the total without
 * saying how many rows it could not include is stating a partial figure as a
 * whole one — see PipelineComposition, which prints `unvalued` next to the
 * money.
 */
export function sumOpportunityValue(rows: readonly OppValueFields[]): {
  /** Sum over rows that carry a value. Never includes a guessed zero. */
  total: number;
  /** How many rows contributed. */
  valued: number;
  /** How many were skipped because they carry no value at all. */
  unvalued: number;
} {
  let total = 0;
  let valued = 0;
  let unvalued = 0;
  for (const r of rows) {
    const v = opportunityValue(r);
    if (v === null) {
      unvalued++;
      continue;
    }
    total += v;
    valued++;
  }
  return { total, valued, unvalued };
}
