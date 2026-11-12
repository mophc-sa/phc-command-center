import { describe, expect, it } from "bun:test";
import { linesMatch, QUOTE_STATUS_LABEL, revisionLabel, unitPrice, vatOf } from "@/lib/quotation-doc";

describe("quotation document", () => {
  it("unit price is the line total over the quantity, to 2 decimals; display only", () => {
    expect(unitPrice(1000, 3)).toBe(333.33);
    expect(unitPrice(0, 5)).toBe(0);
    expect(unitPrice(100, 0)).toBeNull();
  });
  it("VAT rounds to the halala like the generated column", () => {
    expect(vatOf(53200, 0.15)).toBe(7980);
    expect(vatOf(100.05, 0.15)).toBe(15.01);
  });
  it("the lines must sum to the subtotal exactly", () => {
    expect(linesMatch([{ line_total: 100.1 }, { line_total: 200.2 }], 300.3)).toBe(true);
    expect(linesMatch([{ line_total: 100 }], 100.01)).toBe(false);
    expect(linesMatch([], 0)).toBe(true);
  });
  it("the client calls the first revision Rev 0", () => {
    expect(revisionLabel(1)).toBe("Rev 0");
    expect(revisionLabel(3)).toBe("Rev 2");
  });
  it("every revision status has a label in both languages", () => {
    for (const s of ["draft", "pending_approval", "approved", "submitted", "superseded", "withdrawn"] as const) {
      expect(QUOTE_STATUS_LABEL[s].en.length).toBeGreaterThan(0);
      expect(QUOTE_STATUS_LABEL[s].ar.length).toBeGreaterThan(0);
    }
  });
});
