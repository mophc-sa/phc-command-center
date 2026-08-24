// =============================================================================
// Promoting an archived sale into the live pipeline, from the browser.
//
// Every call goes through sales-os-api, which forwards the signed-in user's own
// JWT to the database. The browser never decides who may promote; it only
// renders what the server allows and reports what the server refused.
//
// THE MANIFEST GATE
// -----------------
// Batch activation is the one place where "do what the data says" is the wrong
// behaviour. The eligible set is computed from live production data, and if
// that data moves — a company gets matched, an owner gets mapped, a status
// gets corrected — the set silently grows. Promoting whatever happens to
// qualify at the moment somebody clicks is how an approved batch of 45 becomes
// an unreviewed batch of 51.
//
// So the approved set is pinned in src/data/activation-manifest-batch1.json
// and activation refuses unless the server's live answer matches it exactly:
// same count, same total, same row ids. A mismatch is not an error to work
// around, it is the signal that the batch needs re-approving.
// =============================================================================

import { callBackend } from "@/lib/backend";
import manifest from "@/data/activation-manifest-batch1.json";

export type PromotionPreflightRow = {
  row_id: string;
  row_number: number;
  sales_code: string | null;
  client: string | null;
  project: string | null;
  route: string | null;
  status: string | null;
  amount: number | null;
  date_submitted: string | null;
  owner: string | null;
  owner_user_id: string | null;
  company_matched: boolean;
  promotion_status: string;
  promoted_opportunity_id: string | null;
  promoted_quotation_id: string | null;
  collision_class: string | null;
};

export type SinglePreflight = {
  rowId: string;
  eligible: boolean;
  reasons: string[];
  row: PromotionPreflightRow;
  canPromote: boolean;
};

export type BatchPreflight = {
  count: number;
  totalValue: number;
  rowIds: string[];
  canPromote: boolean;
  records: PromotionPreflightRow[];
};

export type PromotionResult = {
  rowId: string;
  requestId: string;
  opportunityId: string | null;
  quotationId: string | null;
  promotionStatus: string;
  quoteNumber: string | null;
  legacySalesCode: string | null;
  salesStage: string | null;
  handoffStatus: string | null;
  idempotent: boolean;
  validation: { ok: boolean; checks: string[] };
};

export const ACTIVATION_MANIFEST = manifest as {
  batch: string;
  approvedOn: string;
  count: number;
  totalValueExclVat: number;
  currency: string;
  historicalRowIds: string[];
};

export function preflightRow(rowId: string): Promise<SinglePreflight> {
  return callBackend<SinglePreflight>("preflight_historical_promotion", { rowId });
}

export function preflightBatch(): Promise<BatchPreflight> {
  return callBackend<BatchPreflight>("preflight_historical_promotion", {});
}

export function promoteRow(rowId: string): Promise<PromotionResult> {
  return callBackend<PromotionResult>("promote_historical_record", { rowId });
}

// ---- The manifest gate, as a pure function so it can be tested ------------

export type ManifestCheck = {
  matches: boolean;
  /** Human-readable differences. Empty when the batch is exactly the approved one. */
  differences: string[];
  /** Row ids the manifest approved, in the order they should be promoted. */
  approvedRowIds: string[];
};

export function checkAgainstManifest(
  live: Pick<BatchPreflight, "count" | "totalValue" | "rowIds">,
  approved: typeof ACTIVATION_MANIFEST = ACTIVATION_MANIFEST,
): ManifestCheck {
  const differences: string[] = [];

  if (live.count !== approved.count) {
    differences.push(`count is ${live.count}, approved ${approved.count}`);
  }
  // Compared to the cent. Money read off a float that "looks right" is how a
  // rounding drift ships.
  if (Math.abs(live.totalValue - approved.totalValueExclVat) > 0.005) {
    differences.push(
      `value is ${live.totalValue.toFixed(2)}, approved ${approved.totalValueExclVat.toFixed(2)}`,
    );
  }

  // Identity, not just totals: the same count and sum can still be a different
  // set of deals.
  const liveSet = new Set(live.rowIds);
  const approvedSet = new Set(approved.historicalRowIds);
  const added = live.rowIds.filter((id) => !approvedSet.has(id));
  const missing = approved.historicalRowIds.filter((id) => !liveSet.has(id));
  if (added.length) differences.push(`${added.length} record(s) newly eligible and not approved`);
  if (missing.length) differences.push(`${missing.length} approved record(s) no longer eligible`);

  return {
    matches: differences.length === 0,
    differences,
    approvedRowIds: [...approved.historicalRowIds],
  };
}

export type BatchProgress = {
  index: number;
  total: number;
  rowId: string;
  result?: PromotionResult;
  error?: string;
};

export type BatchOutcome = {
  attempted: number;
  promoted: PromotionResult[];
  failed: Array<{ rowId: string; error: string }>;
  stoppedEarly: boolean;
};

/**
 * Runs the approved batch one record at a time.
 *
 * Sequential on purpose. The database refuses more than one promotion per
 * statement, and firing 45 concurrent requests would just convert that
 * invariant into 45 racing failures. It also means a systemic problem shows up
 * on record two rather than after all 45 have been attempted — which is why
 * this stops after two consecutive failures instead of grinding through.
 */
export async function runApprovedBatch(
  rowIds: string[],
  onProgress?: (p: BatchProgress) => void,
  promote: (rowId: string) => Promise<PromotionResult> = promoteRow,
): Promise<BatchOutcome> {
  const promoted: PromotionResult[] = [];
  const failed: Array<{ rowId: string; error: string }> = [];
  let consecutiveFailures = 0;
  let stoppedEarly = false;

  for (let i = 0; i < rowIds.length; i++) {
    const rowId = rowIds[i];
    try {
      const result = await promote(rowId);
      promoted.push(result);
      consecutiveFailures = 0;
      onProgress?.({ index: i, total: rowIds.length, rowId, result });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failed.push({ rowId, error });
      consecutiveFailures += 1;
      onProgress?.({ index: i, total: rowIds.length, rowId, error });
      // Two in a row is no longer bad source data — it is the mechanism.
      if (consecutiveFailures >= 2) {
        stoppedEarly = true;
        break;
      }
    }
  }

  return { attempted: promoted.length + failed.length, promoted, failed, stoppedEarly };
}
