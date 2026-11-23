import { expect, test } from "bun:test";
import { withChanges } from "./PricingHistory";

test("each revision shows what it moved the price by", () => {
  const c = withChanges([{ value: 500000 }, { value: 450000 }, { value: 405000 }]);
  expect(c[0]).toEqual({ change: null, pct: null });
  expect(c[1].change).toBe(-50000);
  expect(c[1].pct).toBeCloseTo(-10);
  expect(c[2].change).toBe(-45000);
});
