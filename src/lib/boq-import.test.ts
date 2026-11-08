import { describe, expect, it } from "bun:test";
import { findHeaderRow, guessMapping, mapRows, parseMountHeightM, parseBool, parseDimensions, parseInstallType, parseNumber, parseNumberResult } from "@/lib/boq-import";

describe("column mapping", () => {
  it("maps English headers, preferring the longest match", () => {
    const m = guessMapping(["No.", "Sign Type", "Description", "Qty", "Size", "Install Type", "Mounting Height", "Screen"]);
    expect(m).toMatchObject({ sign_type: 1, description: 2, quantity: 3, dimensions: 4, install_type: 5, mount_height_m: 6, has_screen: 7 });
    expect(m.height_mm).toBeUndefined();
  });
  it("maps Arabic headers", () => {
    expect(guessMapping(["نوع اللوحة", "الكمية", "المقاس", "الموقع"])).toMatchObject({ sign_type: 0, quantity: 1, dimensions: 2, location: 3 });
  });
  it("gives each column to one field only", () => {
    const m = guessMapping(["Type", "Install Type"]);
    expect(m.install_type).toBe(1);
    expect(m.sign_type).toBe(0);
  });
  it("finds the header row under a title block", () => {
    expect(findHeaderRow([["Project X BOQ"], [], ["Sign Type", "Qty", "Material"], ["P1", 2, "Alu"]])).toBe(2);
  });
});

describe("cell parsing", () => {
  it("numbers: thousands separators, units after the number, Arabic-Indic digits", () => {
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber("12 pcs")).toBe(12);
    expect(parseNumber(String.fromCharCode(0x0661, 0x0662))).toBe(12);
    expect(parseNumber("about 5")).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(7)).toBe(7);
  });
  it("yes and no in both languages", () => {
    expect(parseBool("Yes")).toBe(true);
    expect(parseBool("نعم")).toBe(true);
    expect(parseBool("no")).toBe(false);
    expect(parseBool("maybe")).toBeNull();
  });
  it("install types from common words", () => {
    expect(parseInstallType("Double tape")).toBe("double_tape");
    expect(parseInstallType("wall mounted, screwed")).toBe("wall_screw");
    expect(parseInstallType("Floor standing pylon")).toBe("pylon");
    expect(parseInstallType("سقف")).toBe("ceiling");
    expect(parseInstallType("roof")).toBeNull();
  });
  it("sizes in mm, cm or m", () => {
    expect(parseDimensions("1200 x 600 mm")).toEqual({ width_mm: 1200, height_mm: 600 });
    expect(parseDimensions("120x60cm")).toEqual({ width_mm: 1200, height_mm: 600 });
    expect(parseDimensions("1.2 × 0.6 m")).toEqual({ width_mm: 1200, height_mm: 600 });
    expect(parseDimensions("see drawing")).toBeNull();
  });
});

describe("rows to lines", () => {
  const rows = [
    ["Sign Type", "Qty", "Size", "Install", "Screen"],
    ["Pylon P1", 2, "1200x3000", "pylon", "yes"],
    ["", "", "", "", ""],
    ["Wall W1", "0", "", "", ""],
    ["Ceiling C1", 4, "", "roof", ""],
    ["Total", 6, "", "", ""],
  ];
  const out = mapRows(rows, 0, guessMapping(rows[0]));
  it("keeps good rows with their attributes", () => {
    expect(out.lines).toEqual([
      expect.objectContaining({ sign_type: "Pylon P1", quantity: 2, install_type: "pylon", width_mm: 1200, height_mm: 3000, has_screen: true }),
    ]);
  });
  it("reports bad rows by spreadsheet row number", () => {
    expect(out.errors.map((e) => e.row)).toEqual([4, 5]);
  });
  it("skips blank and total rows", () => {
    expect(out.skipped).toBe(2);
  });
});

describe("limits and units", () => {
  const U = String.fromCharCode;
  const run = (rows: unknown[][], units?: Parameters<typeof mapRows>[3]) => mapRows(rows, 0, guessMapping(rows[0]), units);
  it("mount height is metres as labelled: never converted silently", () => {
    expect(parseMountHeightM(2700)).toBe(2700);
    expect(parseMountHeightM(2700, "mm")).toBe(2.7);
    expect(parseMountHeightM("2.4")).toBe(2.4);
    expect(parseMountHeightM("")).toBeNull();
  });
  it("2700 with unit m stays 2700 and warns; with mm becomes 2.7", () => {
    const rows = [["Sign Type", "Qty", "Mounting Height"], ["P1", 1, 2700]];
    const m = run(rows, { mountHeight: "m", size: "mm" });
    expect(m.lines[0].mount_height_m).toBe(2700);
    expect(m.warnings.map((w) => w.row)).toEqual([2]);
    const mm = run(rows, { mountHeight: "mm", size: "mm" });
    expect(mm.lines[0].mount_height_m).toBe(2.7);
    expect(mm.warnings).toEqual([]);
  });
  it("width and height columns honour the chosen unit", () => {
    const rows = [["Sign Type", "Qty", "Width", "Height"], ["P1", 1, 120, 60]];
    expect(run(rows, { mountHeight: "m", size: "cm" }).lines[0]).toMatchObject({ width_mm: 1200, height_mm: 600 });
    expect(run(rows).lines[0]).toMatchObject({ width_mm: 120, height_mm: 60 });
  });
  it("Arabic and extended digits, decimal mark, dropped group mark", () => {
    expect(parseNumber(U(0x0661, 0x066b, 0x0665))).toBe(1.5);
    expect(parseNumber(U(0x0661, 0x066c, 0x0662, 0x0660, 0x0660))).toBe(1200);
    expect(parseNumber(U(0x06f1, 0x06f2, 0x06f3))).toBe(123);
  });
  it("comma: thousands only with exactly three digits", () => {
    expect(parseNumber("1,500")).toBe(1500);
    expect(parseNumber("1,234,567.5")).toBe(1234567.5);
    expect(parseNumberResult("1,5")).toEqual({ ok: false, reason: "ambiguous" });
    expect(parseNumberResult("0,6")).toEqual({ ok: false, reason: "ambiguous" });
    expect(parseNumberResult("1" + U(0x060c) + "5")).toEqual({ ok: false, reason: "ambiguous" });
    expect(parseNumberResult("1" + U(0x060c) + "500")).toEqual({ ok: true, value: 1500 });
    expect(parseNumberResult("TBD")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseNumberResult("")).toEqual({ ok: true, value: null });
  });
  it("size with no unit and both numbers under 20 is flagged", () => {
    expect(parseDimensions("1.2 x 0.6")).toEqual({ width_mm: 1.2, height_mm: 0.6, likelyMetres: true });
    expect(parseDimensions("1200x600")?.likelyMetres).toBeUndefined();
  });
  it("reports text longer than the database accepts, by row", () => {
    const out = run([["Sign Type", "Qty"], ["x".repeat(121), 1], ["ok", 1]]);
    expect(out.lines.length).toBe(1);
    expect(out.errors.map((e) => e.row)).toEqual([2]);
  });
  it("applies the 120 cap to the description used as sign type", () => {
    const out = run([["Description", "Qty"], ["d".repeat(121), 1], ["d".repeat(120), 1]]);
    expect(out.errors.map((e) => e.row)).toEqual([2]);
    expect(out.lines.length).toBe(1);
  });
  it("checks every server bound and non-numeric cells, by row", () => {
    const rows = [
      ["Sign Type", "Qty", "Width", "Height", "Weight", "Mounting Height"],
      ["a", 1, -1, 5, 1, 1],
      ["b", 1, 1e9, 5, 1, 1],
      ["c", 1, 5, 5, 1e8, 1],
      ["d", 1, 5, 5, 1, 1e4],
      ["e", 0.0004, 5, 5, 1, 1],
      ["f", 1e11, 5, 5, 1, 1],
      ["g", 1, "TBD", 5, 1, 1],
      ["h", "1,5", 5, 5, 1, 1],
      ["i", 1, "", "", "", ""],
      ["j", 1, 5, 5, 0, 0],
    ];
    const out = run(rows);
    expect(out.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out.lines.map((l) => l.sign_type)).toEqual(["i", "j"]);
  });
});
