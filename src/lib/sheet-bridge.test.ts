// =============================================================================
// The bridge exists to end itself.
//
// Every case here is about one of two failure modes. The first is a bridge that
// writes, overwrites a salesperson's work, and teaches the team the app does
// not hold. The second is a bridge nobody turns off, which quietly becomes a
// second system of record. The first is prevented by design -- nothing here
// returns a write. The second is what `sunsetVerdict` is for.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { compareSheet, sunsetVerdict, type SheetRow, type SystemRow } from "@/lib/sheet-bridge";

const sheet = (o: Partial<SheetRow> & { sheetRow: number }): SheetRow => ({
  projectName: "TOWER A",
  client: "ACME",
  quotationStatus: "SUBMITTED",
  salesCode: "OM25001",
  amount: 1000,
  ...o,
});

const sys = (o: Partial<SystemRow> & { id: string }): SystemRow => ({
  projectName: "TOWER A",
  client: "ACME",
  quotationValue: 1000,
  sourceSheetRow: 5,
  sourceStatus: "SUBMITTED",
  ...o,
});

describe("it finds work that is only in the sheet", () => {
  it("flags a row the team added to the spreadsheet", () => {
    const r = compareSheet([sheet({ sheetRow: 9, projectName: "NEW TOWER" })], []);
    expect(r.sheetOnly).toBe(1);
    expect(r.findings[0]).toMatchObject({ kind: "sheet_only", sheetRow: 9 });
  });

  it("skips a row with no project name, exactly as the import did", () => {
    const r = compareSheet([sheet({ sheetRow: 9, projectName: "   " })], []);
    expect(r.findings).toEqual([]);
    expect(r.sheetOnly).toBe(0);
  });
});

describe("it compares field by field, and says which field", () => {
  it("reports nothing when the row is untouched", () => {
    const r = compareSheet([sheet({ sheetRow: 5 })], [sys({ id: "a" })]);
    expect(r.unchanged).toBe(1);
    expect(r.changed).toBe(0);
  });

  it("names the changed field rather than saying 'changed'", () => {
    // "row 5 differs" is not actionable. "the amount went 1000 → 1500" is.
    const r = compareSheet([sheet({ sheetRow: 5, amount: 1500 })], [sys({ id: "a" })]);
    expect(r.changed).toBe(1);
    expect(r.findings[0]).toMatchObject({
      kind: "changed",
      diffs: [{ field: "amount", sheet: 1500, system: 1000 }],
    });
  });

  it("ignores whitespace and case, which are not edits anyone made", () => {
    const r = compareSheet(
      [sheet({ sheetRow: 5, projectName: "  tower   a ", client: "Acme" })],
      [sys({ id: "a" })],
    );
    expect(r.changed).toBe(0);
  });

  it("ignores a sub-riyal difference, which is rounding not a decision", () => {
    const r = compareSheet([sheet({ sheetRow: 5, amount: 1000.4 })], [sys({ id: "a" })]);
    expect(r.changed).toBe(0);
  });

  it("treats an amount appearing or disappearing as a real change", () => {
    // null → 1000 is someone pricing a deal. That is not rounding.
    expect(compareSheet([sheet({ sheetRow: 5, amount: null })], [sys({ id: "a" })]).changed).toBe(1);
    expect(
      compareSheet([sheet({ sheetRow: 5 })], [sys({ id: "a", quotationValue: null })]).changed,
    ).toBe(1);
  });

  it("surfaces a status moved in the SHEET, which is the habit being unlearned", () => {
    const r = compareSheet([sheet({ sheetRow: 5, quotationStatus: "WON" })], [sys({ id: "a" })]);
    expect(r.findings[0]).toMatchObject({
      kind: "changed",
      diffs: [{ field: "quotationStatus", sheet: "WON", system: "SUBMITTED" }],
    });
  });
});

describe("it notices when row numbers have shifted", () => {
  it("does not cry shift over a couple of genuine edits", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => sheet({ sheetRow: n }));
    const sysRows = [1, 2, 3, 4, 5, 6].map((n) => sys({ id: `s${n}`, sourceSheetRow: n }));
    rows[0] = sheet({ sheetRow: 1, amount: 99 });
    const r = compareSheet(rows, sysRows);
    expect(r.changed).toBe(1);
    expect(r.shiftSuspected).toBe(false);
  });

  it("suspects a shift when most matched rows suddenly differ", () => {
    // Inserting one row near the top renumbers everything below it. Reported
    // literally that is hundreds of false edits; the honest output is "the
    // anchor moved, re-check before trusting this".
    const rows = [1, 2, 3, 4].map((n) => sheet({ sheetRow: n, projectName: `P${n}` }));
    const sysRows = [1, 2, 3, 4].map((n) => sys({ id: `s${n}`, sourceSheetRow: n, projectName: `P${n - 1}` }));
    const r = compareSheet(rows, sysRows);
    expect(r.shiftSuspected).toBe(true);
  });
});

describe("adoption is the signal for switching the bridge off", () => {
  it("counts deals a person created in the app, not ones carried in", () => {
    const r = compareSheet(
      [sheet({ sheetRow: 5 })],
      [sys({ id: "a" }), sys({ id: "b", sourceSheetRow: null, sourceStatus: null })],
    );
    expect(r.systemOnly).toBe(1);
    expect(r.adoption).toBeCloseTo(0.5, 6);
  });

  it("has no adoption figure at all when there is nothing to divide", () => {
    expect(compareSheet([], []).adoption).toBeNull();
  });
});

describe("the sunset verdict refuses to be a bare boolean", () => {
  const base = { findings: [], changed: 0, unchanged: 0, shiftSuspected: false };

  it("is not ready while the sheet still gains rows, however high adoption is", () => {
    // High adoption plus a live sheet means the team writes in both places.
    // Cutting the bridge there loses the sheet-side edits.
    const v = sunsetVerdict({ ...base, sheetOnly: 3, systemOnly: 90, adoption: 0.9 });
    expect(v.ready).toBe(false);
    expect(v.reasonEn).toContain("still in use");
  });

  it("is not ready on a quiet sheet alone -- that may be a slow week", () => {
    const v = sunsetVerdict({ ...base, sheetOnly: 0, systemOnly: 10, adoption: 0.1 });
    expect(v.ready).toBe(false);
    expect(v.reasonEn).toContain("Adoption");
  });

  it("is ready only when both hold, and says why", () => {
    const v = sunsetVerdict({ ...base, sheetOnly: 0, systemOnly: 90, adoption: 0.9 });
    expect(v.ready).toBe(true);
    expect(v.reasonEn).toContain("switched off");
    expect(v.reasonAr).toContain("فصل الجسر");
  });

  it("withholds a verdict rather than guessing when there is no data", () => {
    const v = sunsetVerdict({ ...base, sheetOnly: 0, systemOnly: 0, adoption: null });
    expect(v.ready).toBe(false);
  });
});
