// When Build and Propose are allowed on the Selling tab, and what Propose sends.
// The server refuses all of these too; this only decides what the buttons do.
// Pure, so tests pin each rule.
export type ProposeTotals = {
  line_count: number;
  unpriced_lines: number;
  non_sar_lines: number;
  multi_quote_lines: number;
  screen_price_missing_lines: number;
  total_selling: number | null;
  total_cost: number;
  below_floor: boolean | null;
};

export type BuildReason =
  | "not_gm" | "no_cost_access" | "wrong_state" | "no_totals" | "no_lines" | "unpriced" | "non_sar"
  | "multi_quote" | "screen_missing" | "no_selling" | "inputs_pending" | "not_fresh";
export type ProposeReason =
  | BuildReason | "suggest_not_settled" | "open_unknown" | "open_extras";

export type BuildInput = {
  isGm: boolean;
  canReadCost?: boolean;
  state: string;
  inputsPending: boolean;
  /** No grid, totals, open-count or suggest fetch is running. */
  fresh: boolean;
  totals: ProposeTotals | null | undefined;
};
export type ProposeInput = BuildInput & {
  /** The on-open suggestion check of this file and round finished (or does not apply). */
  suggestSettled: boolean;
  /** The open-count query failed. */
  openFailed?: boolean;
  openCount: number | null | undefined;
};
export type Decision<R> = { ok: true } | { ok: false; reason: R };

/** The lines are fully priced: no unpriced, non-SAR, multi-quote or screen-missing line, a total above 0. */
export function pricedReason(t: ProposeTotals | null | undefined): BuildReason | null {
  if (!t) return "no_totals";
  if (t.unpriced_lines > 0) return "unpriced";
  if (t.non_sar_lines > 0) return "non_sar";
  if (t.multi_quote_lines > 0) return "multi_quote";
  if (t.screen_price_missing_lines > 0) return "screen_missing";
  if (t.line_count <= 0) return "no_lines";
  if ((t.total_selling ?? 0) <= 0) return "no_selling";
  return null;
}

/** Who sees the Build and Propose buttons at all. */
export const buildVisible = (i: Pick<BuildInput, "isGm" | "canReadCost" | "state">): boolean =>
  i.isGm && i.canReadCost !== false && i.state === "selling_build";

export function canBuild(i: BuildInput): Decision<BuildReason> {
  if (!i.isGm) return { ok: false, reason: "not_gm" };
  if (i.canReadCost === false) return { ok: false, reason: "no_cost_access" };
  if (i.state !== "selling_build") return { ok: false, reason: "wrong_state" };
  const p = pricedReason(i.totals);
  if (p) return { ok: false, reason: p };
  if (i.inputsPending) return { ok: false, reason: "inputs_pending" };
  if (!i.fresh) return { ok: false, reason: "not_fresh" };
  return { ok: true };
}

export function canPropose(i: ProposeInput): Decision<ProposeReason> {
  const b = canBuild(i);
  if (!b.ok) return b;
  if (!i.suggestSettled) return { ok: false, reason: "suggest_not_settled" };
  if (i.openFailed || i.openCount == null) return { ok: false, reason: "open_unknown" };
  if (i.openCount > 0) return { ok: false, reason: "open_extras" };
  return { ok: true };
}

export type ProposePayload = {
  expectedTotal: number;
  expectedTotalCost: number;
  justification: string | undefined;
};

/**
 * Exactly what the confirmation showed: the snapshot's total and cost, never a recomputed figure.
 * The justification goes only when the snapshot is below the floor, trimmed; a blank one is refused.
 */
export function buildProposePayload(
  snap: Pick<ProposeTotals, "total_selling" | "total_cost" | "below_floor">,
  justification: string,
): { ok: true; payload: ProposePayload } | { ok: false; reason: "no_total" | "justification_blank" } {
  if (snap.total_selling == null) return { ok: false, reason: "no_total" };
  let j: string | undefined;
  if (snap.below_floor) {
    j = justification.trim();
    if (j === "") return { ok: false, reason: "justification_blank" };
  }
  return { ok: true, payload: { expectedTotal: snap.total_selling, expectedTotalCost: snap.total_cost, justification: j } };
}
