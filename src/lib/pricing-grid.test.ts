import { describe, expect, it } from "bun:test";
import { fileTotalCost, logisticsTotal, marginPct, priceFile, round2, sellingFromMargin, shares, type FileInput } from "@/lib/pricing-grid";

// The worked example of supabase/tests/pricing_selling_grid.test.sql.
const file: FileInput = {
  fallbackPct: 10,
  defaultMarginPct: 25,
  overheadPct: 0,
  extrasTotal: 3000,
  logistics: { containers: 1, delivery: "riyadh", clearing: true },
  rates: { container_rate: 12000, customs_pct: 5, clearing_fee: 500, delivery_jeddah: 2000, delivery_riyadh: 5000 },
};
const L1 = { quantity: 2, unitMaterial: 5000, unitInstall: 1000, marginPct: null, typedSelling: null };
const L2 = { quantity: 4, unitMaterial: 1500, unitInstall: null, marginPct: null, typedSelling: null };

describe("the grid mirror gives the SQL test's figures", () => {
  const out = priceFile([L1, L2], file);
  it("materials and installation (rate, then fallback)", () => {
    expect(out.lines[0]).toMatchObject({ materials: 10000, installation: 2000, installBasis: "rate" });
    expect(out.lines[1]).toMatchObject({ materials: 6000, installation: 600, installBasis: "fallback" });
  });
  it("extras and logistics spread by value", () => {
    expect(out.lines[0].extrasAlloc).toBe(1935.48);
    expect(out.lines[0].logisticsAlloc).toBe(11806.45);
    expect(out.totals.logisticsTotal).toBe(18300);
  });
  it("line cost and selling at the default margin", () => {
    expect(out.lines[0].lineCost).toBe(25741.94);
    expect(out.lines[0].selling).toBe(34322.58);
    expect(out.lines[1].selling).toBe(18877.42);
  });
  it("file totals", () => {
    expect(out.totals.totalCost).toBe(39900);
    expect(out.totals.totalSelling).toBe(53200);
    expect(out.totals.marginPct).toBe(25);
    expect(out.totals.unpricedLines).toBe(0);
    expect(out.totals.nonSarLines).toBe(0);
  });
  it("a line margin and a typed price", () => {
    const t = priceFile([{ ...L1, marginPct: 30 }, { ...L2, typedSelling: 20000 }], file).totals;
    expect(t.totalSelling).toBe(56774.19);
    expect(t.marginPct).toBe(29.72);
  });
  it("below the floor is decided on the file's margin", () => {
    const t = priceFile([{ ...L1, marginPct: 30 }, { ...L2, typedSelling: 20000 }], { ...file, floorPct: 30 }).totals;
    expect(t.belowFloor).toBe(true);
    expect(priceFile([L1, L2], { ...file, floorPct: 25 }).totals.belowFloor).toBe(false);
    expect(priceFile([L1, L2], file).totals.belowFloor).toBe(false);
  });
});

describe("an unpriced file has no margin yet", () => {
  it("a line with no supplier price has no selling price, and the margin and floor test wait", () => {
    const out = priceFile([L1, { ...L2, unitMaterial: null }], { ...file, floorPct: 30 });
    expect(out.lines[1]).toMatchObject({ selling: null, unpriced: true, materials: null });
    expect(out.totals.unpricedLines).toBe(1);
    expect(out.totals.marginPct).toBeNull();
    expect(out.totals.belowFloor).toBeNull();
    expect(out.totals.totalSelling).not.toBeNull(); // the sums stay
  });
  it("a line with no margin source is unpriced", () => {
    const t = priceFile([L1, L2], { ...file, defaultMarginPct: null }).totals;
    expect(t.unpricedLines).toBe(2);
    expect(t.totalSelling).toBeNull();
    expect(t.marginPct).toBeNull();
  });
  it("a typed price needs no margin source", () => {
    const t = priceFile([{ ...L1, typedSelling: 30000 }, { ...L2, typedSelling: 20000 }], { ...file, defaultMarginPct: null }).totals;
    expect(t.unpricedLines).toBe(0);
    expect(t.totalSelling).toBe(50000);
  });
  it("a quote in another currency is unpriced and counted", () => {
    const out = priceFile([L1, { ...L2, unitMaterial: null, currencyMismatch: true }], file);
    expect(out.lines[1]).toMatchObject({ unpriced: true, currencyMismatch: true });
    expect(out.totals.nonSarLines).toBe(1);
    expect(out.totals.unpricedLines).toBe(1);
  });
  it("a margin of 100 or more gives no price", () => {
    expect(priceFile([{ ...L1, marginPct: 100 }], file).lines[0].selling).toBeNull();
  });
});

describe("the pieces", () => {
  it("round2 rounds half away from zero, like SQL numeric", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
  });
  it("shares fall back to equal parts when nothing has value", () => {
    expect(shares([0, 0])).toEqual([0.5, 0.5]);
    expect(shares([])).toEqual([]);
  });
  it("margin is on price", () => {
    expect(sellingFromMargin(75, 25)).toBe(100);
    expect(marginPct(100, 75)).toBe(25);
    expect(marginPct(0, 75)).toBeNull();
    expect(sellingFromMargin(75, 100)).toBeNull();
    expect(sellingFromMargin(75, 250)).toBeNull();
    expect(sellingFromMargin(75, -100)).toBeNull();
    expect(sellingFromMargin(75, Number.NaN)).toBeNull();
    expect(sellingFromMargin(75, -25)).toBe(60);
  });
  it("logistics: containers, customs on goods, clearing, delivery", () => {
    expect(logisticsTotal({ containers: 2, delivery: "jeddah", clearing: false }, file.rates, 10000)).toBe(24000 + 500 + 2000);
  });
  it("total cost applies overhead after installation, as estimation_cost_basis does", () => {
    expect(fileTotalCost({ materials: 1000, extras: 0, logistics: 0, installation: 100, overheadPct: 10 })).toBe(1210);
  });
});
