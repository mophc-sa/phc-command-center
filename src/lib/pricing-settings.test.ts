import { describe, expect, it } from "bun:test";
import {
  canEditLogisticsKey, catalogCodeFrom, emptyRateDraft, parseCatalogMinHeight, parseCatalogRate, parseFloorValue,
  parseLogisticsValue, parseRateDraft, rateInForce,
} from "@/lib/pricing-settings";
import type { PricingRights } from "@/lib/pricing-access";

const R = (p: Partial<PricingRights>): PricingRights => ({ is_pricer: false, is_gm: false, can_read_cost: true, can_set_margins: false, ...p });

describe("logistics values", () => {
  it("percentages stay below 100, other rates only non-negative", () => {
    expect(parseLogisticsValue("customs_pct", "5")).toEqual({ ok: true, value: 5 });
    expect(parseLogisticsValue("customs_pct", "100").ok).toBe(false);
    expect(parseLogisticsValue("default_margin_pct", "99.5")).toEqual({ ok: true, value: 99.5 });
    expect(parseLogisticsValue("install_fallback_pct", "-1").ok).toBe(false);
    expect(parseLogisticsValue("container_rate", "12,500")).toEqual({ ok: true, value: 12500 });
    expect(parseLogisticsValue("container_rate", "").ok).toBe(false);
    expect(parseLogisticsValue("clearing_fee", "1,5").ok).toBe(false);
  });
});

describe("margin floor", () => {
  it("is between -100 and 100 inclusive", () => {
    expect(parseFloorValue("12")).toEqual({ ok: true, value: 12 });
    expect(parseFloorValue("-100")).toEqual({ ok: true, value: -100 });
    expect(parseFloorValue("100")).toEqual({ ok: true, value: 100 });
    expect(parseFloorValue("100.5").ok).toBe(false);
    expect(parseFloorValue("").ok).toBe(false);
  });
});

describe("catalog", () => {
  it("rate is required and non-negative; min height optional", () => {
    expect(parseCatalogRate("0")).toEqual({ ok: true, value: 0 });
    expect(parseCatalogRate("-1").ok).toBe(false);
    expect(parseCatalogRate("").ok).toBe(false);
    expect(parseCatalogMinHeight("")).toEqual({ ok: true, value: null });
    expect(parseCatalogMinHeight("3.5")).toEqual({ ok: true, value: 3.5 });
  });
  it("code comes from the English name and fits ^[a-z_]{2,40}$", () => {
    expect(catalogCodeFrom("Acoustic insulation")).toBe("acoustic_insulation");
    expect(catalogCodeFrom("  Paint (2 coats)! ")).toBe("paint_coats");
    expect(catalogCodeFrom("x".repeat(60)).length).toBe(40);
    expect(catalogCodeFrom("a b ".repeat(20))).toMatch(/^[a-z_]{2,40}$/);
  });
});

describe("rate form", () => {
  const today = "2026-11-08";
  it("needs a base and a date today or later; empty add-ons are 0, empty thresholds none", () => {
    const d = { ...emptyRateDraft(today), base_rate: "120.5", per_kg_over: "2" };
    expect(parseRateDraft(d, today)).toEqual({
      ok: true,
      value: {
        install_type: "wall_screw", effective_from: today, base_rate: 120.5, per_kg_over: 2, weight_threshold_kg: null,
        per_m_over: 0, height_threshold_m: null, floor_cut_add: 0, scaffold_add: 0, crane_add: 0,
      },
    });
    expect(parseRateDraft(emptyRateDraft(today), today).ok).toBe(false);
    const past = parseRateDraft({ ...d, effective_from: "2026-11-07" }, today);
    expect(past.ok).toBe(false);
    const bad = parseRateDraft({ ...d, crane_add: "-3", height_threshold_m: "x" }, today);
    expect(bad.ok === false && Object.keys(bad.errors).sort()).toEqual(["crane_add", "height_threshold_m"]);
  });
  it("in force: started and not ended", () => {
    expect(rateInForce({ effective_from: "2026-11-01", effective_to: null }, "2026-11-08")).toBe(true);
    expect(rateInForce({ effective_from: "2026-11-01", effective_to: "2026-11-08" }, "2026-11-08")).toBe(false);
    expect(rateInForce({ effective_from: "2026-11-09", effective_to: null }, "2026-11-08")).toBe(false);
  });
});

describe("rights per logistics row", () => {
  it("default margin follows can_set_margins; the rest follow is_pricer", () => {
    const estimator = R({ is_pricer: true });
    const finance = R({ is_pricer: true, can_set_margins: true });
    const gmOnly = R({ is_gm: true, can_set_margins: true });
    expect(canEditLogisticsKey("default_margin_pct", estimator)).toBe(false);
    expect(canEditLogisticsKey("customs_pct", estimator)).toBe(true);
    expect(canEditLogisticsKey("install_fallback_pct", estimator)).toBe(true);
    expect(canEditLogisticsKey("default_margin_pct", finance)).toBe(true);
    expect(canEditLogisticsKey("default_margin_pct", gmOnly)).toBe(true);
    expect(canEditLogisticsKey("container_rate", gmOnly)).toBe(false);
  });
});
