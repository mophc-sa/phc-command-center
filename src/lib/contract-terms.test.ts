import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PAYMENTS, PAYMENT_KIND_LABEL, TERMS_STATUS_LABEL, expectedDate, paymentAmounts, pctTotal, valueDifference,
} from "@/lib/contract-terms";

describe("contract terms", () => {
  it("the template is the meeting's sequence and adds up to 100", () => {
    expect(DEFAULT_PAYMENTS.map((p) => p.kind)).toEqual(["advance", "drawings_approval", "mir", "wir"]);
    expect(pctTotal(DEFAULT_PAYMENTS)).toBe(100);
  });
  it("totals avoid floating-point drift", () => {
    expect(pctTotal([{ pct: 33.33 }, { pct: 33.33 }, { pct: 33.34 }])).toBe(100);
  });
  it("amounts mirror SQL: rounded per payment, the remainder on the last", () => {
    expect(paymentAmounts(50000, [{ pct: 33.33 }, { pct: 33.33 }, { pct: 33.34 }])).toEqual([16665, 16665, 16670]);
    expect(paymentAmounts(53200, DEFAULT_PAYMENTS)).toEqual([15960, 10640, 15960, 10640]);
  });
  it("expected dates mirror SQL", () => {
    const period = { signedOn: "2026-11-01", drawingsDays: 5, supplyInstallDays: 45, handoverDays: 10 };
    expect(expectedDate("advance", period)).toBe("2026-11-01");
    expect(expectedDate("drawings_approval", period)).toBe("2026-11-06");
    expect(expectedDate("mir", period)).toBe("2026-12-21");
    expect(expectedDate("wir", period)).toBe("2026-12-31");
    expect(expectedDate("other", period)).toBeNull();
    expect(expectedDate("mir", { ...period, signedOn: "" })).toBeNull();
  });
  it("the difference against the quotation, in percent", () => {
    expect(valueDifference(1150000, 1200000)).toEqual({ amount: -50000, pct: -4.17 });
    expect(valueDifference(100, 100)).toBeNull();
  });
  it("labels exist in both languages", () => {
    for (const l of [...Object.values(PAYMENT_KIND_LABEL), ...Object.values(TERMS_STATUS_LABEL)]) {
      expect(l.en.length).toBeGreaterThan(0);
      expect(l.ar.length).toBeGreaterThan(0);
    }
  });
});
