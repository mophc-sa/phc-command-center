// Phase 7A invariants that no behavioural test would catch — the decisions a
// future edit could quietly undo: an authority list widening, a DELETE policy
// appearing, a cost column slipping into a GRANT, or a legacy table being
// "cleaned up".

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const M = join(root, "supabase/migrations");
const read = (f: string) => readFileSync(join(M, f), "utf8");
const sql = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const REV = read("20260826100000_phase7a_boq_revisions.sql");
const AUTH = read("20260826110000_phase7a_price_authority.sql");
const PRICE = read("20260826120000_phase7a_estimation_pricing.sql");
const ALL = sql(REV) + sql(AUTH) + sql(PRICE);

describe("final-price authority is exactly the GM", () => {
  it("never reuses the helpers that admit sales_manager or system_admin", () => {
    const fn = sql(AUTH).match(/CREATE OR REPLACE FUNCTION public\.can_approve_final_price[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toBeTruthy();
    expect(fn).not.toContain("is_commercial_manager");
    expect(fn).not.toContain("is_platform_admin");
    expect(fn).not.toContain("can_view_all_sales_data");
    expect(fn).toContain("'general_manager'");
  });

  it("CEO and MD are absent from the authority function", () => {
    const fn = sql(AUTH).match(/FUNCTION public\.can_approve_final_price[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).not.toContain("'ceo'");
    expect(fn).not.toContain("'managing_director'");
  });

  it("the gm_approved transition is guarded by that function and nothing else", () => {
    expect(sql(PRICE)).toMatch(/NEW\.status = 'gm_approved' AND NOT public\.can_approve_final_price/);
  });
});

describe("delegation cannot become a second permanent approver", () => {
  it("expiry is mandatory", () => {
    expect(sql(AUTH)).toMatch(/expires_at\s+TIMESTAMPTZ NOT NULL/);
  });
  it("overlapping live delegations are refused by the database", () => {
    expect(sql(AUTH)).toContain("EXCLUDE USING gist");
    expect(sql(AUTH)).toContain("WHERE (revoked_at IS NULL)");
  });
  it("only the GM may delegate", () => {
    expect(sql(AUTH)).toMatch(/has_role\(NEW\.grantor_id, 'general_manager'/);
  });
  it("a reason is required", () => {
    expect(sql(AUTH)).toMatch(/reason\s+TEXT NOT NULL/);
  });
});

describe("the chain is sequential and enforced in the database", () => {
  it("lists exactly the seven legal forward transitions", () => {
    const g = sql(PRICE);
    for (const pair of [
      "('draft','cost_complete')",
      "('cost_complete','internal_price_proposed')",
      "('internal_price_proposed','commercial_review')",
      "('commercial_review','finance_review')",
      "('finance_review','gm_pending')",
      "('gm_pending','gm_approved')",
      "('returned','internal_price_proposed')",
    ]) expect(g).toContain(pair);
  });

  it("never lists a skip", () => {
    const g = sql(PRICE);
    expect(g).not.toContain("('internal_price_proposed','finance_review')");
    expect(g).not.toContain("('commercial_review','gm_pending')");
    expect(g).not.toContain("('finance_review','gm_approved')");
  });

  it("an approved price is terminal", () => {
    expect(sql(PRICE)).toMatch(/OLD\.status = 'gm_approved'[\s\S]{0,200}RAISE EXCEPTION/);
  });
});

describe("cost and margin never leave their boundary", () => {
  it("boq_lines re-grants by name without the cost columns", () => {
    const grant = sql(REV).match(/GRANT SELECT \([\s\S]*?\) ON public\.boq_lines/)?.[0] ?? "";
    expect(grant).toBeTruthy();
    expect(grant).not.toContain("unit_price");
    expect(grant).not.toContain("line_total");
    expect(grant).toContain("selling_price");
  });

  it("internal_prices re-grants by name without either margin column", () => {
    const grant = sql(PRICE).match(/GRANT SELECT \([\s\S]*?\) ON public\.internal_prices/)?.[0] ?? "";
    expect(grant).toBeTruthy();
    expect(grant).not.toContain("margin_value");
    expect(grant).not.toContain("margin_percentage");
    expect(grant).toContain("proposed_price");
  });

  it("every cost view gates on can_read_commercial_cost", () => {
    for (const v of ["boq_line_costs", "internal_price_summary"]) {
      const view = ALL.match(new RegExp(`CREATE OR REPLACE VIEW public\\.${v}[\\s\\S]*?;`))?.[0] ?? "";
      expect(view, `${v} missing`).toBeTruthy();
      expect(view).toContain("can_read_commercial_cost");
    }
  });

  it("the sales-facing roll-up carries no cost and no margin", () => {
    const view = sql(REV).match(/CREATE OR REPLACE VIEW public\.boq_revision_sales_totals[\s\S]*?;/)?.[0] ?? "";
    expect(view).toContain("selling_total");
    for (const bad of ["unit_price", "line_total", "margin"]) expect(view).not.toContain(bad);
  });
});

describe("nothing is destroyed", () => {
  it("no DELETE policy on any Phase 7A table", () => {
    expect(ALL).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
  });

  it("boqs, boq_items and quotations are never dropped or altered", () => {
    for (const t of ["boqs", "boq_items", "quotations"]) {
      expect(ALL).not.toMatch(new RegExp(`DROP TABLE[^;]*${t}`, "i"));
      expect(ALL).not.toMatch(new RegExp(`ALTER TABLE public\\.${t}\\b[^;]*DROP`, "i"));
    }
  });

  it("no data is written or moved", () => {
    expect(ALL).not.toMatch(/^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+public\./im);
  });

  it("all three migrations are local-only until approved", () => {
    for (const m of [REV, AUTH, PRICE]) expect(m).toContain("LOCAL ONLY");
  });
});

describe("Phase 5 governance is extended, not replaced", () => {
  it("keeps the legacy boqs.status clause verbatim", () => {
    const fn = sql(REV).match(/FUNCTION public\.project_has_valid_boq[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toContain("JOIN public.boqs b ON b.related_opportunity_id = o.id");
    expect(fn).toContain("b.status IN ('verified', 'partially_verified')");
  });

  it("only a FROZEN revision qualifies", () => {
    const fn = sql(REV).match(/FUNCTION public\.project_has_valid_boq[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toContain("r.frozen_at IS NOT NULL");
  });
});

describe("scope", () => {
  it("the enum value ships with the table it describes, not alone", () => {
    expect(REV).toContain("ADD VALUE IF NOT EXISTS 'boq_revision'");
    const p7a = readdirSync(M).filter((f) => f.startsWith("20260826"));
    expect(p7a.sort()).toEqual([
      "20260826100000_phase7a_boq_revisions.sql",
      "20260826110000_phase7a_price_authority.sql",
      "20260826120000_phase7a_estimation_pricing.sql",
    ]);
  });

  it("defers what 7B/7C/7D own", () => {
    expect(ALL).not.toContain("vat_treatment");
    expect(ALL).not.toContain("quotation_revisions");
    expect(ALL).not.toContain("supplier_quotes");
    expect(ALL).not.toContain("can_approve_historical_promotion");
  });

  it("source_type records how a revision arose", () => {
    expect(sql(REV)).toContain("'manual', 'ai_extraction', 'historical_import'");
  });
});
