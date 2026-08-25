// Phase 7B invariants. Supplier unit cost is the floor beneath every other
// number in the system — the one figure that lets someone reverse the margin
// exactly — so these pin the decisions a future edit could quietly undo.

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const M = join(root, "supabase/migrations");
const raw = readFileSync(join(M, "20260827100000_phase7b_supplier_costing.sql"), "utf8");
const sql = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("supplier cost is reachable only through the cost gate", () => {
  it("both views gate on can_read_commercial_cost", () => {
    for (const v of ["supplier_quote_costs", "supplier_comparison"]) {
      const view = sql.match(new RegExp(`CREATE OR REPLACE VIEW public\\.${v}[\\s\\S]*?;`))?.[0] ?? "";
      expect(view, `${v} missing`).toBeTruthy();
      expect(view).toContain("can_read_commercial_cost");
    }
  });

  it("both tables gate on it too — the pipeline cannot see a quote exists", () => {
    const sel = sql.split("CREATE POLICY").filter((p) => /FOR SELECT/.test(p)).join("\n");
    expect(sel).toContain("can_read_commercial_cost");
    // is_pipeline_operator may create an RFQ but must not appear in a read gate.
    for (const block of sql.split("CREATE POLICY").filter((p) => /FOR SELECT/.test(p))) {
      expect(block).not.toContain("is_pipeline_operator");
    }
  });

  it("cost columns are revoked and re-granted by name without them", () => {
    const grant = sql.match(/GRANT SELECT \([\s\S]*?\) ON public\.supplier_quote_lines/)?.[0] ?? "";
    expect(grant).toBeTruthy();
    expect(grant).not.toContain("unit_cost");
    expect(grant).not.toContain("line_cost");
    expect(grant).toContain("is_selected");
  });

  it("never reuses a helper that admits viewer or system_admin", () => {
    expect(sql).not.toContain("can_view_all_sales_data");
    expect(sql).not.toContain("is_platform_admin");
    expect(sql).not.toContain("is_commercial_manager");
  });
});

describe("history is kept, never overwritten", () => {
  // The four columns that make a quote's lineage and lifecycle legible on its
  // own row, without joining anything.
  it("supplier_quotes carries its own revision, lineage and freeze stamp", () => {
    const t = sql.match(/CREATE TABLE IF NOT EXISTS public\.supplier_quotes[\s\S]*?\n\);/)?.[0] ?? "";
    expect(t).toMatch(/supersedes_id\s+UUID REFERENCES public\.supplier_quotes\(id\)/);
    expect(t).toMatch(/revision_number\s+INTEGER NOT NULL DEFAULT 1/);
    expect(t).toMatch(/is_current\s+BOOLEAN NOT NULL DEFAULT TRUE/);
    expect(t).toMatch(/frozen_at\s+TIMESTAMPTZ/);
    expect(t).toMatch(/frozen_by\s+UUID REFERENCES auth\.users\(id\)/);
    // Half a freeze is not a state — mirrors 7A's boq_revisions constraint.
    expect(t).toMatch(/\(frozen_at IS NULL\) = \(frozen_by IS NULL\)/);
    expect(t).toMatch(/status <> 'frozen' OR frozen_at IS NOT NULL/);
  });

  it("no DELETE policy on either table", () => {
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
  });
  it("a delete trigger backs that up for the service role", () => {
    expect(sql).toContain("supplier_quotes_no_delete");
    expect(sql).toContain("supplier_quote_lines_no_delete");
  });
  it("one live quote per vendor per revision", () => {
    expect(sql).toMatch(/UNIQUE INDEX[\s\S]*?supplier_quotes_one_current[\s\S]*?WHERE is_current/);
  });
  it("one selected supplier per BOQ line", () => {
    expect(sql).toMatch(/UNIQUE INDEX[\s\S]*?supplier_quote_lines_one_selected[\s\S]*?WHERE is_selected/);
  });
});

describe("the constraints that keep a comparison honest", () => {
  it("a quote line must price its own revision", () => {
    expect(sql).toMatch(/_line_rev IS DISTINCT FROM _q\.boq_revision_id/);
  });
  it("a superseded quote cannot be selected from", () => {
    expect(sql).toMatch(/NEW\.is_selected AND NOT coalesce\(_q\.is_current, FALSE\)/);
  });
  it("a currency mismatch is refused, and nothing converts it", () => {
    expect(sql).toMatch(/NEW\.currency <> _boq_ccy/);
    expect(sql).not.toMatch(/exchange_rate|fx_rate|convert_currency/i);
  });
  it("enforcement still reads the revision's freeze, not the quote's stamp", () => {
    expect(sql).toContain("public.boq_revision_is_frozen");
  });

  // The stamp records a freeze; it must never be able to declare one. If a
  // quote could set frozen_at itself there would be two freeze decisions that
  // can disagree, which is exactly what the propagation design avoids.
  it("only the propagation trigger writes the freeze stamp", () => {
    expect(sql).toMatch(/AFTER UPDATE OF frozen_at ON public\.boq_revisions/);
    expect(sql).toMatch(/frozen_at\/frozen_by are set by freezing the BOQ revision/);
    const guard = sql.match(/FUNCTION public\.supplier_quote_guard[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(guard).toContain("_propagating");
  });

  it("the stamp is copied from the revision so the two cannot disagree", () => {
    const fn = sql.match(/FUNCTION public\.propagate_freeze_to_supplier_quotes[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/frozen_at = NEW\.frozen_at/);
    expect(fn).toMatch(/frozen_by = NEW\.frozen_by/);
    // One-way, once: re-running must not restamp an already-frozen quote.
    expect(fn).toMatch(/OLD\.frozen_at IS NOT NULL/);
    expect(fn).toMatch(/q\.frozen_at IS NULL/);
    // Terminal states survive the freeze.
    expect(fn).toMatch(/'cancelled', 'superseded'/);
  });
  it("the comparison excludes superseded quotes", () => {
    const v = sql.match(/CREATE OR REPLACE VIEW public\.supplier_comparison[\s\S]*?;/)?.[0] ?? "";
    expect(v).toContain("q.is_current");
  });
});

describe("selection has no separate approval, by decision", () => {
  it("records who and when", () => {
    expect(sql).toContain("selected_by");
    expect(sql).toContain("selected_at");
    expect(sql).toContain("selection_note");
  });
  it("adds no approval type or approval table", () => {
    expect(sql).not.toContain("supplier_selection");
    expect(sql).not.toContain("approvals");
  });
  it("estimation writes the lines; the pipeline does not price them", () => {
    const ins = sql.split("CREATE POLICY").find((p) => /supplier_quote_lines FOR INSERT/.test(p)) ?? "";
    expect(ins).toContain("estimation_manager");
    expect(ins).not.toContain("is_pipeline_operator");
  });
});

describe("vendors are barely touched", () => {
  it("the only change is duplicate detection", () => {
    const alters = [...sql.matchAll(/ALTER TABLE public\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(alters)].sort()).toEqual(["supplier_quote_lines", "supplier_quotes", "vendors"]);
    const vendorAlter = sql.match(/ALTER TABLE public\.vendors[\s\S]*?;/)?.[0] ?? "";
    expect(vendorAlter).toContain("name_normalized");
    expect(vendorAlter).toContain("ADD COLUMN IF NOT EXISTS");
  });

  // Detection, not prevention. The normaliser strips company suffixes, so
  // "Al Rajhi Trading" and "Al Rajhi Group" collapse to one key even though
  // they may be two real firms. A unique index would leave procurement unable
  // to register the second one at all, with no override.
  it("duplicate handling cannot block a legitimate vendor", () => {
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[^;]*\bpublic\.vendors\b|CREATE UNIQUE INDEX[^;]*\bON public\.vendors\s*\(/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS vendors_name_normalized_idx/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.vendor_duplicate_candidates/);
    // The vendors table gains no constraint of any kind.
    expect(sql).not.toMatch(/ALTER TABLE public\.vendors[^;]*ADD CONSTRAINT/);
  });

  it("no vendor data is migrated and no vendor policy is changed", () => {
    expect(sql).not.toMatch(/^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+public\.vendors/im);
    expect(sql).not.toMatch(/POLICY[^;]*ON public\.vendors\b/);
    expect(sql).not.toMatch(/DROP POLICY[^;]*Vendors readable/);
  });

  it("the vendors blanket-read exposure is deliberately left for its own decision", () => {
    // Stated in the header so nobody mistakes the omission for an oversight.
    // The header wraps, so whitespace between words may include a newline and
    // a comment marker.
    expect(raw.replace(/\s*--\s*/g, " ")).toMatch(/vendors blanket-read exposure is NOT addressed here/);
  });

  it("vendors_private keeps its columns; reference_prices is deprecated by comment", () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.vendors_private/);
    expect(sql).toMatch(/COMMENT ON COLUMN public\.vendors_private\.reference_prices[\s\S]*?DEPRECATED/);
  });
});

describe("scope", () => {
  it("is one migration and defers 7C/7D", () => {
    const p7b = readdirSync(M).filter((f) => f.startsWith("20260827"));
    expect(p7b).toEqual(["20260827100000_phase7b_supplier_costing.sql"]);
    expect(sql).not.toContain("quotation_revisions");
    expect(sql).not.toContain("vat_rate");
    expect(sql).not.toContain("can_approve_historical_promotion");
  });
  it("is local only until approved", () => {
    expect(raw).toContain("LOCAL ONLY");
  });
});
