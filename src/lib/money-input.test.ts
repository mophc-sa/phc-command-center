import { describe, expect, it } from "bun:test";
import { parseMoneyInput } from "@/lib/opportunity-collab-actions";

describe("a currency box, as people actually type into it", () => {
  it("reads a plain number", () => {
    expect(parseMoneyInput("18801940")).toBe(18801940);
  });

  it("survives the separators people paste from a spreadsheet", () => {
    expect(parseMoneyInput("18,801,940")).toBe(18801940);
    expect(parseMoneyInput(" 18 801 940 ")).toBe(18801940);
  });

  it("treats an emptied box as cleared, never as zero", () => {
    // A quotation of zero is a quotation. A blank box is somebody who did not
    // have the number to hand, and storing it as 0 puts the deal in the
    // pipeline at nothing.
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("   ")).toBeNull();
  });

  it("keeps a real zero", () => {
    expect(parseMoneyInput("0")).toBe(0);
  });

  it("tells 'not submitted' apart from 'cleared'", () => {
    // undefined must not collapse into null, or a field the user never touched
    // would wipe the column it belongs to.
    expect(parseMoneyInput(undefined)).toBeUndefined();
  });

  it("refuses what is not a number rather than guessing", () => {
    for (const bad of ["abc", "12abc", "-5", "1e"]) {
      expect([bad, parseMoneyInput(bad)]).toEqual([bad, undefined]);
    }
  });
});
