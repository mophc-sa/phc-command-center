import { describe, expect, it } from "bun:test";
import {
  canGmMove,
  canPricerMove,
  installationCost,
  PRICING_STATE_LABEL,
  PRICING_STATES,
  type InstallationRate,
} from "@/lib/pricing";

describe("installation cost mirrors pricing_installation_cost", () => {
  const ceiling: InstallationRate = {
    install_type: "ceiling",
    base_rate: 300,
    per_kg_over: 5,
    weight_threshold_kg: 20,
    per_m_over: 50,
    height_threshold_m: 4,
    floor_cut_add: 0,
    scaffold_add: 400,
    crane_add: 0,
  };
  it("adds weight over, height over and scaffold for a high heavy ceiling sign", () => {
    expect(installationCost(ceiling, { weightKg: 30, mountHeightM: 6 })).toBe(300 + 50 + 100 + 400);
  });
  it("is just the base for a light low one", () => {
    expect(installationCost(ceiling, { weightKg: 10, mountHeightM: 3 })).toBe(300);
  });
  it("adds nothing at exactly the thresholds (strictly over only)", () => {
    expect(installationCost(ceiling, { weightKg: 20, mountHeightM: 4 })).toBe(300);
  });
  it("treats missing weight and height as zero", () => {
    expect(installationCost(ceiling, {})).toBe(300);
    expect(installationCost(ceiling, { weightKg: null, mountHeightM: null })).toBe(300);
  });
  it("adds the cut for a floor sign that needs it", () => {
    const floor: InstallationRate = {
      ...ceiling,
      install_type: "floor",
      base_rate: 500,
      per_kg_over: 0,
      per_m_over: 0,
      weight_threshold_kg: null,
      height_threshold_m: null,
      scaffold_add: 0,
      floor_cut_add: 250,
    };
    expect(installationCost(floor, { floorCut: true })).toBe(750);
    expect(installationCost(floor, { floorCut: false })).toBe(500);
  });
  it("charges the height surcharge but no scaffold for a type other than ceiling", () => {
    const wall = { ...ceiling, install_type: "wall_screw" as const };
    expect(installationCost(wall, { weightKg: 10, mountHeightM: 6 })).toBe(300 + 100);
  });
  it("charges nothing over a null threshold, so a rate without one has no surcharge or scaffold", () => {
    const open = { ...ceiling, weight_threshold_kg: null, height_threshold_m: null };
    expect(installationCost(open, { weightKg: 500, mountHeightM: 20 })).toBe(300);
  });
  it("ignores crane_add, as the SQL does", () => {
    expect(
      installationCost({ ...ceiling, crane_add: 999 }, { weightKg: 10, mountHeightM: 3 }),
    ).toBe(300);
  });
  it("adds the floor-cut figure even when the type is not floor", () => {
    expect(installationCost({ ...ceiling, floor_cut_add: 75 }, { floorCut: true })).toBe(375);
  });
  it("is exact to the 4 decimals SQL numeric gives (no 0.1 + 0.2 noise)", () => {
    const r = {
      ...ceiling,
      base_rate: 0.1,
      per_kg_over: 0.1,
      weight_threshold_kg: 0,
      height_threshold_m: null,
    };
    expect(installationCost(r, { weightKg: 0.2 })).toBe(0.12);
  });
  it("returns null with no rate, so the caller falls back to a % of materials", () => {
    expect(installationCost(null, {})).toBeNull();
    expect(installationCost(null, { weightKg: 30, mountHeightM: 6, floorCut: true })).toBeNull();
  });
});

describe("pricing states", () => {
  it("label every state in both languages", () => {
    for (const s of PRICING_STATES) {
      expect(PRICING_STATE_LABEL[s].en.length).toBeGreaterThan(0);
      expect(PRICING_STATE_LABEL[s].ar.length).toBeGreaterThan(0);
    }
    expect(Object.keys(PRICING_STATE_LABEL).sort()).toEqual([...PRICING_STATES].sort());
  });
  it("lets the pricer move along the path and never skip", () => {
    expect(canPricerMove("received", "package_review")).toBe(true);
    expect(canPricerMove("received", "at_supplier")).toBe(false);
    expect(canPricerMove("selling_build", "price_review")).toBe(false); // the price moves it, not a button
    expect(canPricerMove("price_review", "approved")).toBe(false);
  });
  it("lets a pricer close any open file, never a closed one", () => {
    expect(canPricerMove("at_supplier", "closed")).toBe(true);
    expect(canPricerMove("closed", "closed")).toBe(false);
  });
  it("gives the selling build to the GM, not to the pricer, and lets the GM do nothing else", () => {
    expect(canGmMove("supplier_priced", "selling_build")).toBe(true);
    expect(canPricerMove("supplier_priced", "selling_build")).toBe(false);
    expect(canGmMove("received", "package_review")).toBe(false);
    expect(canGmMove("at_supplier", "closed")).toBe(false);
  });
});
