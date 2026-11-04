import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

// pricing-grid.ts mirrors the SQL; the SQL is the authority. These pin the
// expressions the mirror copies, so a change on either side fails here first.
// Comments are stripped first, so a rule that is only commented out does not count.
const read = (file: string) =>
  readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8").replace(/--[^\n]*/g, "");
const GRID = read("20261104140000_pricing_selling_grid.sql");
const BUILD = read("20261104150000_pricing_build_price.sql");
const PHASE8 = read("20260830100000_phase8_margin_integrity.sql");

describe("the selling grid's arithmetic", () => {
  it("installation falls back to a % of materials from install_fallback_pct", () => {
    expect(GRID).toContain("r.key = 'install_fallback_pct'");
    expect(GRID).toMatch(/coalesce\(b\.unit_material, 0\) \* b\.quantity \* b\.fallback_pct \/ 100(?!\d)/);
  });
  it("extras and logistics are spread by line value, equally when there is none", () => {
    expect(GRID).toMatch(/\(coalesce\(s\.materials, 0\) \+ s\.installation\) \/ s\.value_total/);
    expect(GRID).toMatch(/ELSE 1\.0 \/ s\.line_count END AS share/);
  });
  it("logistics: containers, customs on goods, clearing, delivery", () => {
    expect(GRID).toMatch(/coalesce\(fi\.containers, 0\) \* coalesce\(r\.container_rate, 0\)/);
    expect(GRID).toMatch(/s\.goods_total \* coalesce\(r\.customs_pct, 0\) \/ 100/);
    expect(GRID).toMatch(/WHEN coalesce\(fi\.clearing, false\) THEN coalesce\(r\.clearing_fee, 0\)/);
    expect(GRID).toMatch(/WHEN 'jeddah' THEN coalesce\(r\.delivery_jeddah, 0\)/);
    expect(GRID).toMatch(/WHEN 'riyadh' THEN coalesce\(r\.delivery_riyadh, 0\)/);
  });
  it("line cost adds the allocations, then overhead", () => {
    expect(GRID).toMatch(
      /\(coalesce\(c\.materials, 0\) \+ c\.installation \+ c\.share \* c\.extras_total \+ c\.share \* c\.logistics_total\)\s*\* \(1 \+ c\.overhead_pct \/ 100\)/,
    );
  });
  it("selling is margin on price, from the line's margin, else the default", () => {
    expect(GRID).toMatch(/round\(lc\.line_cost \/ \(1 - coalesce\(c\.line_margin_pct, c\.default_margin_pct\) \/ 100\), 2\)/);
  });
  it("the file's default margin beats the global one", () => {
    expect(GRID).toMatch(/coalesce\(i\.default_margin_pct, s\.default_margin_pct\) AS default_margin_pct/);
  });
  it("a typed price wins; no supplier price, no margin source, or a margin of 100 gives no price", () => {
    expect(GRID).toMatch(/WHEN c\.typed_selling_price IS NOT NULL THEN c\.typed_selling_price\s+WHEN c\.unit_material IS NULL THEN NULL/);
    expect(GRID).toMatch(/WHEN coalesce\(c\.line_margin_pct, c\.default_margin_pct\) IS NULL THEN NULL/);
    expect(GRID).toMatch(/WHEN coalesce\(c\.line_margin_pct, c\.default_margin_pct\) >= 100 THEN NULL/);
  });
  it("a line's margin is on its selling price, and only for a positive price", () => {
    expect(GRID).toMatch(/CASE WHEN sp\.selling_price > 0 THEN round\(\(sp\.selling_price - lc\.line_cost\) \/ sp\.selling_price \* 100, 2\) END AS margin_pct/);
  });
});

describe("what is unpriced", () => {
  it("a quote in another currency is not used, with no conversion", () => {
    expect(GRID).toMatch(/\(sq\.id IS NOT NULL AND sq\.currency IS DISTINCT FROM 'SAR'\) AS currency_mismatch/);
    expect(GRID).toMatch(/CASE WHEN sq\.id IS NULL OR sq\.currency IS DISTINCT FROM 'SAR' THEN NULL/);
  });
  it("the screen price is used when chosen and given, else the normal one", () => {
    expect(GRID).toMatch(/coalesce\(pl\.use_screen_price, bl\.has_screen\) AS use_screen_price/);
    expect(GRID).toMatch(/AND sq\.unit_cost_with_screen IS NOT NULL\s+THEN sq\.unit_cost_with_screen\s+ELSE sq\.unit_cost END AS unit_material/);
  });
  it("unpriced is no supplier price, or no typed price and no margin source", () => {
    expect(GRID).toMatch(
      /\(c\.unit_material IS NULL\s+OR \(c\.typed_selling_price IS NULL AND coalesce\(c\.line_margin_pct, c\.default_margin_pct\) IS NULL\)\) AS unpriced/,
    );
  });
  it("the totals count unpriced and non-SAR lines", () => {
    expect(GRID).toMatch(/\(count\(\*\) FILTER \(WHERE g\.unpriced\)\)::int AS unpriced_lines/);
    expect(GRID).toMatch(/\(count\(\*\) FILTER \(WHERE g\.currency_mismatch\)\)::int AS non_sar_lines/);
  });
  it("the file's margin and floor test wait while any line is unpriced", () => {
    expect(GRID).toMatch(/CASE WHEN a\.unpriced_lines = 0 THEN m\.margin_pct END AS margin_pct/);
    expect(GRID).toMatch(/CASE WHEN a\.unpriced_lines = 0 THEN coalesce\(m\.margin_pct < public\.current_margin_floor\(\), false\) END AS below_floor/);
  });
});

describe("the totals equal what Phase 8 computes from the estimation build writes", () => {
  it("total cost is estimation_cost_basis's expression", () => {
    expect(GRID).toMatch(/a\.materials_total \+ a\.extras_total \+ a\.logistics_total \+ a\.installation_total AS subtotal/);
    expect(GRID).toMatch(/round\(s\.subtotal \+ s\.subtotal \* a\.overhead_pct \/ 100, 2\) AS total_cost/);
    expect(PHASE8).toMatch(
      /_subtotal := _material\s+\+ \(_material \* coalesce\(_e\.wastage_pct, 0\) \/ 100\)\s+\+ coalesce\(_e\.installation_cost, 0\);/,
    );
    expect(PHASE8).toMatch(/RETURN round\(_subtotal \+ \(_subtotal \* coalesce\(_e\.overhead_pct, 0\) \/ 100\), 2\);/);
  });
  it("build writes cost_total = materials + extras + logistics, installation, no wastage", () => {
    expect(BUILD).toMatch(
      /cost_total = t\.materials_total \+ t\.extras_total \+ t\.logistics_total,\s+installation_cost = t\.installation_total, wastage_pct = 0, overhead_pct = t\.overhead_pct/,
    );
    expect(BUILD).toMatch(
      /VALUES \(f\.boq_revision_id, t\.materials_total \+ t\.extras_total \+ t\.logistics_total,\s+t\.installation_total, 0, t\.overhead_pct,/,
    );
  });
  it("margin is on price, the same formula as compute_margin", () => {
    expect(GRID).toMatch(/round\(\(a\.total_selling - c\.total_cost\) \/ a\.total_selling \* 100, 2\)/);
    expect(PHASE8).toMatch(/round\(\(NEW\.proposed_price - _cost\) \/ NEW\.proposed_price \* 100, 2\)/);
  });
  it("build inserts a proposal and no other status (PR 2 contract)", () => {
    const inserts = [...BUILD.matchAll(/INSERT INTO public\.internal_prices[\s\S]*?;/g)].map((m) => m[0]);
    expect(inserts.length).toBe(1);
    expect(inserts[0]).toMatch(/VALUES \(e\.id, t\.total_selling, 'internal_price_proposed', u, now\(\)\)/);
    expect(BUILD).toContain("PERFORM public._pricing_file_link_price(f.id, e.id, p.id);");
  });
});
