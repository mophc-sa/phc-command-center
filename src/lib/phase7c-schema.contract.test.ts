// =============================================================================
// Phase 7C invariants that behaviour alone would not catch.
//
// The behavioural suite proves the database enforces the model today. These
// pin the decisions a later edit could undo without breaking any visible test:
// a price creeping into an approval payload, VAT becoming a typed column, a
// margin appearing in the pipeline view, or the document grant function being
// rewritten from memory and quietly losing a branch.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = join(root, "supabase/migrations");
const read = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8");

const ENUMS    = "20260828100000_phase7c_enum_additions.sql";
const REVS     = "20260828110000_phase7c_quotation_revisions.sql";
const APPROVAL = "20260828120000_phase7c_approval_integration.sql";
const REGISTRY = "20260823100000_document_registry.sql";

const enums = read(ENUMS);
const revs = read(REVS);
const approval = read(APPROVAL);

/**
 * Executable SQL only.
 *
 * Strips `--` lines AND `COMMENT ON ... ;` statements. Both carry prose that
 * names the helpers this phase deliberately does NOT use — a COMMENT saying
 * "deliberately not can_view_all_sales_data" would otherwise fail the very
 * assertion checking that helper is absent, which is the assertion reading
 * documentation as if it were code.
 */
const code = (s: string) =>
  s
    .replace(/COMMENT ON [\s\S]*?';/g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

describe("VAT is computed, never typed", () => {
  it("vat_amount and total_incl_vat are generated columns", () => {
    expect(revs).toMatch(/vat_amount[\s\S]{0,120}GENERATED ALWAYS AS[\s\S]{0,80}STORED/);
    expect(revs).toMatch(/total_incl_vat[\s\S]{0,140}GENERATED ALWAYS AS[\s\S]{0,120}STORED/);
  });

  it("the total is derived from the same rounding as the VAT line", () => {
    // subtotal + round(subtotal*rate) — not round(subtotal*(1+rate)), which
    // can differ by a halala and make the invoice disagree with itself.
    expect(revs).toMatch(/total_incl_vat[\s\S]{0,160}subtotal_excl_vat \+ round\(subtotal_excl_vat \* vat_rate, 2\)/);
  });

  it("there is no vat_treatment column, per the approved decision", () => {
    expect(code(revs)).not.toContain("vat_treatment");
  });

  it("the rate is a fraction and bounded", () => {
    expect(revs).toMatch(/vat_rate\s+NUMERIC\(5,4\)\s+NOT NULL DEFAULT 0\.15/);
    expect(revs).toMatch(/vat_rate >= 0 AND vat_rate <= 1/);
  });

  it("money columns keep the ex-VAT convention in their name", () => {
    expect(revs).toContain("subtotal_excl_vat");
  });
});

describe("the snapshot cannot drift from the approved price", () => {
  it("the subtotal must equal the GM-approved price with no tolerance", () => {
    expect(revs).toMatch(/NEW\.subtotal_excl_vat IS DISTINCT FROM _price\.proposed_price/);
    // Any epsilon here would be a licence to quote a different number.
    expect(code(revs)).not.toMatch(/abs\(|tolerance|epsilon|<= 0\.0[0-9]/);
  });

  it("the price must be gm_approved, not merely pending", () => {
    expect(revs).toMatch(/_price\.status IS DISTINCT FROM 'gm_approved'/);
  });

  it("the BOQ revision must be frozen first", () => {
    expect(revs).toContain("public.boq_revision_is_frozen(NEW.boq_revision_id)");
  });

  it("the commercial fields freeze on leaving draft, not on submission", () => {
    const guard = revs.match(/OLD\.status <> 'draft' AND \([\s\S]*?THEN/)?.[0] ?? "";
    for (const col of ["subtotal_excl_vat", "vat_rate", "currency", "boq_revision_id", "internal_price_id"]) {
      expect(guard, `${col} must be frozen`).toContain(col);
    }
  });

  it("an approved revision cannot be reopened as a draft", () => {
    const table = revs.match(/_ok := \(OLD\.status, NEW\.status\) IN \([\s\S]*?\);/)?.[0] ?? "";
    expect(table).not.toMatch(/\('approved',\s*'draft'\)/);
    expect(table).toMatch(/\('pending_approval',\s*'draft'\)/); // returning for rework is fine
  });
});

describe("final price authority is 7A's, not a new one", () => {
  it("the GM gate reuses can_approve_final_price", () => {
    expect(revs).toContain("public.can_approve_final_price(_uid)");
  });

  it("never widened to helpers that admit sales_manager, viewer or system_admin", () => {
    for (const bad of ["is_commercial_manager", "is_platform_admin", "can_view_all_sales_data"]) {
      expect(code(revs)).not.toContain(bad);
    }
  });
});

describe("nothing is deleted and nothing is edited after submission", () => {
  it("no DELETE policy on quotation_revisions", () => {
    expect(code(revs)).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
  });

  it("a trigger backs that up for the service role", () => {
    expect(revs).toContain("quotation_revisions_no_delete");
  });

  it("a submitted revision refuses edits to its client-facing terms", () => {
    const guard = revs.match(/OLD\.status = 'submitted' AND \([\s\S]*?THEN/)?.[0] ?? "";
    for (const col of ["valid_until", "payment_terms", "submitted_at", "issued_at"]) {
      expect(guard, `${col} must be immutable once submitted`).toContain(col);
    }
  });
});

describe("approval payloads carry pointers, not money", () => {
  it("the guard is wired to the approvals table", () => {
    expect(approval).toMatch(/CREATE TRIGGER approvals_payload_guard[\s\S]{0,120}ON public\.approvals/);
  });

  it("the money-key scan recurses into objects and arrays", () => {
    const fn = approval.match(/FUNCTION public\.jsonb_has_money_key[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toContain("jsonb_each");
    expect(fn).toContain("jsonb_array_elements");
    // Self-recursive: a price three levels down is still a price.
    expect(fn.match(/public\.jsonb_has_money_key/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("it matches the obvious money words", () => {
    for (const w of ["price", "amount", "total", "vat", "margin", "cost"]) {
      expect(approval).toContain(w);
    }
  });

  it("the ban is scoped so existing approval flows are not retro-broken", () => {
    const guard = approval.match(/FUNCTION public\.approval_payload_guard[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(guard).toContain("linked_record_type = 'quotation_revision'");
  });
});

describe("the pipeline view shows selling price and nothing behind it", () => {
  it("exposes no cost, margin or supplier figure", () => {
    const v = revs.match(/CREATE OR REPLACE VIEW public\.quotation_current_revision[\s\S]*?;/)?.[0] ?? "";
    expect(v.length).toBeGreaterThan(0);
    for (const bad of ["margin", "cost", "unit_cost", "proposed_price", "supplier"]) {
      expect(v).not.toContain(bad);
    }
  });

  it("still gates itself rather than trusting the caller", () => {
    const v = revs.match(/CREATE OR REPLACE VIEW public\.quotation_current_revision[\s\S]*?;/)?.[0] ?? "";
    expect(v).toContain("can_read_quotation");
  });
});

describe("document_entity_grants is extended, not rewritten from memory", () => {
  const registry = read(REGISTRY);

  // A first draft of the integrity repair earlier in this project retyped DDL
  // from memory and got column names and delete rules wrong. This function is
  // the access decision for every document in the system; a branch that looks
  // right and is not would be an exposure, so the untouched branches are
  // compared against the migration that defined them.
  const branch = (sql: string, name: string) => {
    const m = sql.match(new RegExp(`WHEN '${name}' THEN([\\s\\S]*?)(?=\\n\\s*(?:--[^\\n]*\\n\\s*)*WHEN '|\\n\\s*ELSE)`));
    return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
  };

  const UNCHANGED = ["opportunity", "rfq", "tender", "inbox_item", "project", "contract", "boq", "quotation"];

  for (const name of UNCHANGED) {
    it(`the ${name} branch is unchanged`, () => {
      const before = branch(registry, name);
      expect(before.length, `${name} not found in the registry migration`).toBeGreaterThan(0);
      expect(branch(approval, name)).toBe(before);
    });
  }

  it("adds exactly the two revision branches", () => {
    const names = [...approval.matchAll(/WHEN '(\w+)' THEN/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...UNCHANGED, "boq_revision", "quotation_revision"].sort());
  });

  it("a new enum value still grants nothing by default", () => {
    expect(approval).toMatch(/ELSE\s*\n\s*RETURN FALSE;/);
  });

  it("stays SECURITY DEFINER with a pinned search_path", () => {
    expect(approval).toContain("SECURITY DEFINER");
    expect(approval).toMatch(/SET search_path TO 'public'/);
  });
});

describe("the migrations are shaped for a safe apply", () => {
  it("enum additions are alone in their own migration", () => {
    // Postgres refuses to use a new enum value in the transaction that added
    // it, so folding these into migration 2 would fail on apply.
    const stmts = code(enums).split(";").map((s) => s.trim()).filter(Boolean);
    expect(stmts.every((s) => /^ALTER TYPE/.test(s))).toBe(true);
  });

  it("all three say LOCAL ONLY until approved", () => {
    for (const m of [enums, revs, approval]) expect(m).toContain("LOCAL ONLY");
  });

  it("Phase 7C adds exactly three migrations, after the last applied one", () => {
    const LAST_APPLIED = "20260827100000_phase7b_supplier_costing.sql";
    const p7c = readdirSync(MIGRATIONS).filter((f) => /_phase7c_/.test(f));
    expect(p7c.sort()).toEqual([ENUMS, REVS, APPROVAL]);
    for (const f of p7c) expect(f > LAST_APPLIED).toBe(true);
  });

  it("touches no existing business table", () => {
    const alters = [...[enums, revs, approval].join("\n").matchAll(/ALTER TABLE public\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(alters)]).toEqual(["quotation_revisions"]);
  });

  it("writes no business data", () => {
    for (const m of [enums, revs, approval]) {
      expect(code(m)).not.toMatch(/^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+public\./im);
    }
  });
});
