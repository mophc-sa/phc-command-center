import { describe, expect, it } from "bun:test";
import { findHeaderRow, guessMapping, mapRows, parseMountHeightM, parseBool, parseDimensions, parseInstallType, parseNumber } from "@/lib/boq-import";

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
  it("reads a mounting height in millimetres as metres", () => {
    expect(parseMountHeightM(2700)).toBe(2.7);
    expect(parseMountHeightM("2.4")).toBe(2.4);
    expect(parseMountHeightM("")).toBeNull();
  });
  it("reads Arabic decimal separators", () => {
    expect(parseNumber(String.fromCharCode(0x0661, 0x066b, 0x0665))).toBe(1.5);
  });
  it("reports text longer than the database accepts, by row", () => {
    const rows = [["Sign Type", "Qty"], ["x".repeat(121), 1], ["ok", 1]];
    const out = mapRows(rows, 0, guessMapping(rows[0]));
    expect(out.lines.length).toBe(1);
    expect(out.errors.map((e) => e.row)).toEqual([2]);
  });
  it("converts a mounting height column", () => {
    const rows = [["Sign Type", "Qty", "Mounting Height"], ["P1", 1, 2700]];
    expect(mapRows(rows, 0, guessMapping(rows[0])).lines[0].mount_height_m).toBe(2.7);
  });
});
