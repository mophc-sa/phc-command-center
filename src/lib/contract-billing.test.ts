import { describe, expect, it } from "bun:test";
import { CHANNEL_LABEL, COLLECTIONS_ROLES, TIER_LABEL, canSeeCollections, gauges } from "@/lib/contract-billing";

describe("contract billing", () => {
  it("the two meeting gauges: share of the contract invoiced, share of the invoiced collected", () => {
    expect(gauges({ contract_value: 53200, invoiced_excl_vat: 15960, invoiced_incl_vat: 18354, received: 10000 }))
      .toEqual({ invoicedPct: 30, collectedPct: 54.5 });
    expect(gauges({ contract_value: 0, invoiced_excl_vat: 0, invoiced_incl_vat: 0, received: 0 }))
      .toEqual({ invoicedPct: 0, collectedPct: 0 });
  });
  it("collections are for finance and management, not reps", () => {
    expect(canSeeCollections(["finance_manager"])).toBe(true);
    expect(canSeeCollections(["general_manager"])).toBe(true);
    expect(canSeeCollections(["salesperson"])).toBe(false);
    expect(COLLECTIONS_ROLES).not.toContain("salesperson");
  });
  it("labels exist in both languages", () => {
    for (const l of [...Object.values(CHANNEL_LABEL), ...Object.values(TIER_LABEL)]) {
      expect(l.en.length).toBeGreaterThan(0);
      expect(l.ar.length).toBeGreaterThan(0);
    }
  });
});
