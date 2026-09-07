import { callBackend } from "@/lib/backend";
import manifest from "@/data/historical-reconciliation-manifest.json";

export type LegacyPair = { row_id: string; canonical_id: string; legacy_id: string };
export type LegacyPreviewRow = LegacyPair & {
  sales_code: string;
  amount: number;
  fingerprint: string;
  blockers: string[];
};
export type LegacyPreview = { records: LegacyPreviewRow[]; completed: LegacyPair[] };

export function checkReconciliationManifest(preview: LegacyPreview): string[] {
  const key = (p: LegacyPair) => `${p.row_id}:${p.canonical_id}:${p.legacy_id}`;
  const expected = new Set(manifest.pairs.map((p) => `${p.rowId}:${p.canonicalId}:${p.legacyId}`));
  const actual = [...preview.records, ...preview.completed].map(key);
  const errors: string[] = [];
  if (
    actual.length !== expected.size ||
    new Set(actual).size !== expected.size ||
    actual.some((k) => !expected.has(k))
  ) {
    errors.push(
      "The reviewed legacy record identities changed. Refresh and review the reconciliation scope.",
    );
  }
  if (preview.records.some((p) => p.blockers.length > 0))
    errors.push("Some legacy records contain independent work and require review.");
  return errors;
}

export function previewHistoricalReconciliation(): Promise<LegacyPreview> {
  return callBackend("preview_historical_reconciliation", {});
}

export async function reconcileHistoricalRows(
  records: LegacyPreviewRow[],
  onProgress: (done: number, total: number) => void,
  reconcile = (rowId: string, expectedLegacy: Record<string, string>) =>
    callBackend<{ archivedIds: string[] }>("reconcile_historical_duplicates", {
      rowId,
      expectedLegacy,
    }),
) {
  const rows = new Map<string, Record<string, string>>();
  for (const r of records) {
    const fingerprints = rows.get(r.row_id) ?? {};
    fingerprints[r.legacy_id] = r.fingerprint;
    rows.set(r.row_id, fingerprints);
  }
  let done = 0;
  let archived = 0;
  for (const [rowId, expectedLegacy] of rows) {
    const result = await reconcile(rowId, expectedLegacy);
    archived += result.archivedIds.length;
    onProgress(++done, rows.size);
  }
  return { records: done, archived };
}
