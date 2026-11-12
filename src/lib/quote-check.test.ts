import { describe, expect, it } from "bun:test";
import { ISSUE_LABEL, linesToReturn, MAX_MESSAGE, supplierMessage, type QuoteIssue, type QuoteIssueRow } from "@/lib/quote-check";

const row = (n: number, issues: QuoteIssue[], extra: Partial<QuoteIssueRow> = {}): QuoteIssueRow => ({
  boq_line_id: `l${n}`,
  line_number: n,
  sign_type: `Sign ${n}`,
  issues,
  boq_quantity: 5,
  quoted_quantity: 5,
  spec_note: null,
  ...extra,
});

describe("quote check", () => {
  it("every issue has a label in both languages", () => {
    for (const k of ["no_price", "screen_price_missing", "quantity_differs", "spec_differs"] as const) {
      expect(ISSUE_LABEL[k].en.length).toBeGreaterThan(0);
      expect(ISSUE_LABEL[k].ar.length).toBeGreaterThan(0);
    }
  });
  it("preselects the lines the supplier must fix; a written spec difference is Zayed's call", () => {
    const rows = [row(1, ["no_price"]), row(2, ["screen_price_missing"]), row(3, ["quantity_differs"]), row(4, ["spec_differs"])];
    expect(linesToReturn(rows)).toEqual(["l1", "l2", "l3"]);
  });
  it("the supplier's message names lines by number and sign type only, in both languages", () => {
    const msg = supplierMessage([
      row(1, ["no_price"]),
      row(3, ["quantity_differs"], { boq_quantity: 5, quoted_quantity: 4 }),
      row(4, ["spec_differs"], { spec_note: "Aluminium" }),
    ]);
    expect(msg).toBe(
      [
        "Please complete these lines and submit again:",
        "- Line 1 (Sign 1): no price.",
        "- Line 3 (Sign 3): the quantity requested is 5; you priced 4.",
        "يرجى استكمال هذه البنود وإعادة الإرسال:",
        "- البند 1 (Sign 1): بلا سعر.",
        "- البند 3 (Sign 3): الكمية المطلوبة 5؛ سعّرتم 4.",
      ].join("\n"),
    );
  });
  it("a screen line asks for the price with the screen", () => {
    expect(supplierMessage([row(2, ["screen_price_missing"])])).toContain("price with the screen is missing");
  });
  it("a long list falls back to line numbers per issue and stays within the portal's 1000 characters", () => {
    const many = Array.from({ length: 60 }, (_, i) => row(i + 1, i % 2 ? ["no_price"] : ["screen_price_missing"], { sign_type: "Directional sign type" }));
    const msg = supplierMessage(many);
    expect(msg.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(msg).toContain("No price: lines 2, 4, 6");
    expect(msg).toContain("بلا سعر: البنود 2، 4، 6");
  });
  it("nothing to return gives no message", () => {
    expect(supplierMessage([row(4, ["spec_differs"])])).toBe("");
  });
});
