// Project tracking helpers (manager feedback group 4).
// Run with: bun test src/lib/project-tracking.test.ts
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import {
  UPDATE_KINDS,
  UPDATE_KIND_LABEL,
  awardedValue,
  projectWithContractor,
  validateUpdate,
} from "./project-tracking";

describe("update kinds", () => {
  test("match the database CHECK list exactly", () => {
    const sql = readFileSync("supabase/migrations/20261022100000_project_tracking.sql", "utf8");
    const list = sql.slice(sql.indexOf("kind IN ("), sql.indexOf(")),", sql.indexOf("kind IN (")));
    for (const k of UPDATE_KINDS) expect(list).toContain(`'${k}'`);
    expect(list.match(/'[a-z_]+'/g)?.length).toBe(UPDATE_KINDS.length);
  });

  test("every kind has both languages, with Western digits only", () => {
    for (const k of UPDATE_KINDS) {
      expect(UPDATE_KIND_LABEL[k].en.length).toBeGreaterThan(0);
      expect(UPDATE_KIND_LABEL[k].ar.length).toBeGreaterThan(0);
      expect(UPDATE_KIND_LABEL[k].ar).not.toMatch(/[٠-٩]/);
    }
  });
});

describe("validateUpdate", () => {
  test("a plain update needs nothing else", () => {
    expect(validateUpdate({ kind: "po_received", note: "", pct: "" })).toEqual({ ok: true, pct: null });
  });
  test("a % is parsed", () => {
    expect(validateUpdate({ kind: "offer_sent", note: "", pct: " 60 " })).toEqual({ ok: true, pct: 60 });
  });
  test("0 is a real figure, not blank", () => {
    expect(validateUpdate({ kind: "progress_update", note: "", pct: "0" })).toEqual({ ok: true, pct: 0 });
  });
  test("a progress update needs a %", () => {
    expect(validateUpdate({ kind: "progress_update", note: "x", pct: "" })).toEqual({ ok: false, reason: "pct_required" });
  });
  test("other needs a note", () => {
    expect(validateUpdate({ kind: "other", note: "  ", pct: "" })).toEqual({ ok: false, reason: "note_required" });
  });
  test("out of range or non-numeric % is refused", () => {
    expect(validateUpdate({ kind: "offer_sent", note: "", pct: "101" })).toEqual({ ok: false, reason: "pct_invalid" });
    expect(validateUpdate({ kind: "offer_sent", note: "", pct: "6.5" })).toEqual({ ok: false, reason: "pct_invalid" });
    expect(validateUpdate({ kind: "offer_sent", note: "", pct: "abc" })).toEqual({ ok: false, reason: "pct_invalid" });
  });
});

describe("projectWithContractor", () => {
  test("joins name and contractor", () => {
    expect(projectWithContractor("Riyadh Metro", "Al Bawani")).toBe("Riyadh Metro — Al Bawani");
  });
  test("name alone when there is no contractor", () => {
    expect(projectWithContractor("Riyadh Metro", null)).toBe("Riyadh Metro");
    expect(projectWithContractor("Riyadh Metro", "  ")).toBe("Riyadh Metro");
  });
  test("does not repeat a contractor that is the name", () => {
    expect(projectWithContractor("Al Bawani", "al bawani")).toBe("Al Bawani");
  });
  test("contractor alone when the name is missing", () => {
    expect(projectWithContractor(null, "Al Bawani")).toBe("Al Bawani");
  });
});

describe("awardedValue", () => {
  test("the contract value when there is one", () => {
    expect(awardedValue({ contract_value: 900, quotation_value: 1000 })).toBe(900);
  });
  test("the quotation once won, when no contract value", () => {
    expect(awardedValue({ sales_stage: "won", quotation_value: 1000 })).toBe(1000);
    expect(awardedValue({ stage: "won", quotation_value: "1000" })).toBe(1000);
  });
  test("nothing before award", () => {
    expect(awardedValue({ sales_stage: "jih", quotation_value: 1000, estimated_value_max: 2000 })).toBeNull();
  });
});
