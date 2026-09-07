import { describe, expect, test } from "bun:test";
import manifest from "@/data/historical-reconciliation-manifest.json";
import {
  checkReconciliationManifest,
  reconcileHistoricalRows,
  type LegacyPreviewRow,
} from "./historical-reconciliation";

const records: LegacyPreviewRow[] = manifest.pairs.map((p) => ({
  row_id: p.rowId,
  canonical_id: p.canonicalId,
  legacy_id: p.legacyId,
  fingerprint: "a".repeat(32),
  sales_code: "test",
  amount: 1,
  blockers: [],
}));
describe("reviewed legacy reconciliation scope", () => {
  test("accepts exact reviewed identities and completed receipts for safe resume", () => {
    expect(checkReconciliationManifest({ records, completed: [] })).toEqual([]);
    expect(
      checkReconciliationManifest({ records: records.slice(5), completed: records.slice(0, 5) }),
    ).toEqual([]);
    expect(checkReconciliationManifest({ records: [], completed: records })).toEqual([]);
  });
  test("rejects changed identity, unexplained missing records, and duplicate receipts", () => {
    expect(checkReconciliationManifest({ records: records.slice(1), completed: [] })).not.toEqual(
      [],
    );
    expect(checkReconciliationManifest({ records, completed: [records[0]] })).not.toEqual([]);
    expect(
      checkReconciliationManifest({
        records: [{ ...records[0], canonical_id: "different" }, ...records.slice(1)],
        completed: [],
      }),
    ).not.toEqual([]);
  });
  test("does not reconcile a record with independent work", () => {
    expect(
      checkReconciliationManifest({
        records: [{ ...records[0], blockers: ["referenced_by_tasks"] }, ...records.slice(1)],
        completed: [],
      }),
    ).not.toEqual([]);
  });
  test("groups copies under one row transaction and passes reviewed fingerprints", async () => {
    const sample = [
      { ...records[0], row_id: "one", legacy_id: "a" },
      { ...records[0], row_id: "one", legacy_id: "b" },
      { ...records[0], row_id: "two", legacy_id: "c" },
    ];
    const calls: string[] = [];
    const result = await reconcileHistoricalRows(
      sample,
      () => {},
      async (rowId, expected) => {
        calls.push(rowId);
        if (rowId === "one") expect(Object.keys(expected)).toEqual(["a", "b"]);
        return { archivedIds: Object.keys(expected) };
      },
    );
    expect(calls).toEqual(["one", "two"]);
    expect(result).toEqual({ records: 2, archived: 3 });
  });
  test("stops on the first failure rather than continuing an uncertain batch", async () => {
    const calls: string[] = [];
    await expect(
      reconcileHistoricalRows(
        [
          { ...records[0], row_id: "one" },
          { ...records[0], row_id: "two" },
        ],
        () => {},
        async (rowId) => {
          calls.push(rowId);
          throw Error("changed since preview");
        },
      ),
    ).rejects.toThrow("changed since preview");
    expect(calls).toEqual(["one"]);
  });
});
