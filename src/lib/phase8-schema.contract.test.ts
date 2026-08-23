// =============================================================================
// Phase 8 invariants.
//
// The phase exists because every number the commercial chain approved was
// typed by a person and reconciled against nothing. These pin the decisions
// that make the margin mean something, so a later edit cannot quietly turn it
// back into an input.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = join(root, "supabase/migrations");
const FILE = "20260830100000_phase8_margin_integrity.sql";
const sql = readFileSync(join(MIGRATIONS, FILE), "utf8");

/** Executable SQL only — comments and COMMENT ON prose name things they exclude. */
const code = (s: string) =>
  s.replace(/COMMENT ON [\s\S]*?';/g, "")
   .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("margin is derived, not declared", () => {
  it("a trigger computes it on every insert and update", () => {
    expect(sql).toMatch(/CREATE TRIGGER internal_prices_compute_margin[\s\S]{0,120}BEFORE INSERT OR UPDATE ON public\.internal_prices/);
  });

  it("it overwrites whatever arrived rather than validating it", () => {
    const fn = sql.match(/FUNCTION public\.internal_price_compute_margin[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/NEW\.margin_value\s*:=/);
    expect(fn).toMatch(/NEW\.margin_percentage\s*:=/);
    // No branch that keeps a caller-supplied value.
    expect(fn).not.toMatch(/IF NEW\.margin_value IS NOT NULL/);
  });

  it("margin percent is on price, not on cost", () => {
    const fn = sql.match(/FUNCTION public\.internal_price_compute_margin[\s\S]*?\$\$;/)?.[0] ?? "";
    // (price - cost) / price. Dividing by cost is the other convention and the
    // two disagree for every deal.
    expect(fn).toMatch(/\(NEW\.proposed_price - _cost\) \/ NEW\.proposed_price \* 100/);
  });

  it("a zero price yields NULL rather than a division error", () => {
    const fn = sql.match(/FUNCTION public\.internal_price_compute_margin[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/WHEN NEW\.proposed_price = 0 THEN NULL/);
  });
});

describe("the cost basis prefers what was actually committed", () => {
  it("selected supplier costs win over the typed total", () => {
    const fn = sql.match(/FUNCTION public\.estimation_cost_basis[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/coalesce\(_supplier, _e\.cost_total, 0\)/);
    expect(fn).toContain("l.is_selected");
  });

  it("it reads only selected lines of the estimation's own revision", () => {
    const fn = sql.match(/FUNCTION public\.estimation_cost_basis[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/q\.boq_revision_id = _e\.boq_revision_id/);
  });

  it("it runs as definer so the pipeline never needs to see supplier cost", () => {
    const fn = sql.match(/FUNCTION public\.estimation_cost_basis[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toMatch(/SET search_path = public, pg_temp/);
  });
});

describe("Phase 8 does not widen who can see money", () => {
  it("it never un-revokes the margin columns", () => {
    expect(code(sql)).not.toMatch(/GRANT[^;]*\bmargin_(value|percentage)\b/i);
  });

  it("the review queue carries no figures at all", () => {
    const v = sql.match(/CREATE OR REPLACE VIEW public\.commercial_review_queue[\s\S]*?;/)?.[0] ?? "";
    expect(v.length).toBeGreaterThan(0);
    for (const bad of ["margin", "proposed_price", "cost_total", "cost_basis", "unit_cost"]) {
      expect(v).not.toContain(bad);
    }
  });

  it("the reconciliation view stays behind can_read_commercial_cost", () => {
    const v = sql.match(/CREATE OR REPLACE VIEW public\.estimation_cost_reconciliation[\s\S]*?;/)?.[0] ?? "";
    expect(v).toContain("can_read_commercial_cost");
    expect(v).toContain("can_read_boq_revision");
  });

  it("never reuses a helper that admits viewer or system_admin", () => {
    for (const bad of ["can_view_all_sales_data", "is_platform_admin", "is_commercial_manager"]) {
      expect(code(sql)).not.toContain(bad);
    }
  });
});

describe("the floor is recorded, not enforced into uselessness", () => {
  it("below the floor needs a written justification, not a refusal", () => {
    const fn = sql.match(/FUNCTION public\.internal_price_floor_guard[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toContain("below_floor_justification");
    // A hard block on thin margins gets worked around; what it must not be is silent.
    expect(fn).toMatch(/NEW\.margin_percentage < _floor/);
  });

  it("no policy means no gate", () => {
    const fn = sql.match(/FUNCTION public\.internal_price_floor_guard[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/_floor IS NULL THEN RETURN NEW/);
  });

  it("only the final-price authority may move the floor", () => {
    const ins = sql.split("CREATE POLICY").find((p) => /margin_policies FOR INSERT/.test(p)) ?? "";
    expect(ins).toContain("can_approve_final_price");
    expect(ins).not.toContain("is_commercial_manager");
  });

  it("two floors cannot be in force at once", () => {
    expect(sql).toMatch(/EXCLUDE USING gist \(tstzrange\(effective_from, effective_to\) WITH &&\)/);
  });

  it("policies are closed, never deleted", () => {
    expect(code(sql)).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
    expect(sql).toContain("margin_policies_no_delete");
  });
});

describe("the migration is safe to apply", () => {
  it("widens the margin column rather than clamping the value", () => {
    // Clamping would store a number that is not the margin.
    expect(sql).toMatch(/ALTER COLUMN margin_percentage TYPE NUMERIC\(12,2\)/);
    expect(code(sql)).not.toMatch(/least\(|greatest\(/);
  });

  it("rebuilds the dependent view it had to drop", () => {
    // Postgres refuses to retype a column a view reads, so the view is dropped
    // and recreated; forgetting the recreate would silently remove it.
    expect(sql).toContain("DROP VIEW IF EXISTS public.internal_price_summary");
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.internal_price_summary/);
    expect(sql).toContain("GRANT SELECT ON public.internal_price_summary TO authenticated");
  });

  it("writes no business data and drops nothing", () => {
    expect(code(sql)).not.toMatch(/^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+public\./im);
    expect(code(sql)).not.toMatch(/DROP TABLE|DROP COLUMN/i);
  });

  it("says LOCAL ONLY and sorts after Phase 7D", () => {
    expect(sql).toContain("LOCAL ONLY");
    const p8 = readdirSync(MIGRATIONS).filter((f) => /_phase8_/.test(f));
    expect(p8).toEqual([FILE]);
    expect(FILE > "20260829100000_phase7d_historical_promotion.sql").toBe(true);
  });
});
