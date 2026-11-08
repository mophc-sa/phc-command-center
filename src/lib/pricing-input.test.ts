import { describe, expect, it } from "bun:test";
import { draftText, parseDraft } from "@/lib/pricing-input";

describe("parseDraft", () => {
  it("keeps typed text as numbers on save", () => {
    expect(parseDraft("1.0")).toEqual({ ok: true, value: 1 });
    expect(parseDraft("1.05")).toEqual({ ok: true, value: 1.05 });
    expect(parseDraft("20.05")).toEqual({ ok: true, value: 20.05 });
    expect(parseDraft(" 7 ")).toEqual({ ok: true, value: 7 });
  });
  it("empty is null", () => {
    expect(parseDraft("")).toEqual({ ok: true, value: null });
    expect(parseDraft("  ")).toEqual({ ok: true, value: null });
  });
  it("accepts thousands separators and refuses ambiguous commas", () => {
    expect(parseDraft("1,200")).toEqual({ ok: true, value: 1200 });
    expect(parseDraft("1,5")).toEqual({ ok: false, reason: "ambiguous" });
    expect(parseDraft("1,50.5")).toEqual({ ok: false, reason: "ambiguous" });
  });
  it("refuses text and a second dot", () => {
    expect(parseDraft("12 pcs")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseDraft("1.2.3")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseDraft("abc")).toEqual({ ok: false, reason: "not_a_number" });
  });
  it("reads Arabic-Indic digits", () => {
    expect(parseDraft(String.fromCharCode(0x0662, 0x0660))).toEqual({ ok: true, value: 20 });
  });
  it("applies the ranges", () => {
    expect(parseDraft("-1", { min: 0 })).toEqual({ ok: false, reason: "range" });
    expect(parseDraft("0", { above: 0 })).toEqual({ ok: false, reason: "range" });
    expect(parseDraft("100", { below: 100 })).toEqual({ ok: false, reason: "range" });
    expect(parseDraft("-99.5", { above: -100, below: 100 })).toEqual({ ok: true, value: -99.5 });
    expect(parseDraft("2.5", { integer: true })).toEqual({ ok: false, reason: "not_integer" });
    expect(parseDraft("3", { integer: true, min: 0 })).toEqual({ ok: true, value: 3 });
  });
});

describe("draftText", () => {
  it("shows a saved number or nothing", () => {
    expect(draftText(null)).toBe("");
    expect(draftText(1.05)).toBe("1.05");
  });
});
