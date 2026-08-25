// =============================================================================
// Phase 7D invariants.
//
// Promotion is the one place where the read-only archive meets the live CRM,
// so these pin the properties that keep that boundary one-directional: nothing
// is auto-created, the archive is never written to, and conversion cannot go
// bulk. Each of these is the kind of rule that erodes under deadline pressure
// rather than being deliberately removed.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = join(root, "supabase/migrations");
const read = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8");

const FILE = "20260829100000_phase7d_historical_promotion.sql";
const sql = read(FILE);

/** Executable SQL only — `--` lines and COMMENT ON prose both name helpers
 *  this phase deliberately avoids, and would fail the assertions below. */
const code = (s: string) =>
  s.replace(/COMMENT ON [\s\S]*?';/g, "")
   .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("the archive stays read-only", () => {
  it("no write of any kind to the staging tables", () => {
    const c = code(sql);
    for (const t of ["historical_sales_rows", "historical_sales_mapped",
                     "historical_sales_batches", "historical_sales_owner_map",
                     "historical_sales_status_map", "historical_sales_company_candidates"]) {
      expect(c, `${t} must not be written`).not.toMatch(
        new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+public\\.${t}\\b`, "i"));
      expect(c, `${t} must not be altered`).not.toMatch(
        new RegExp(`ALTER TABLE\\s+public\\.${t}\\b`, "i"));
    }
  });

  it("adds no write policy to the archive", () => {
    const policies = code(sql).match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    for (const p of policies) expect(p).not.toMatch(/ON public\.historical_sales_/);
  });

  it("the only table it creates is the queue", () => {
    const created = [...code(sql).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(["historical_promotion_requests"]);
  });
});

describe("nothing is auto-created", () => {
  const promote = sql.match(/FUNCTION public\.promote_historical_row[\s\S]*?\$\$;/)?.[0] ?? "";

  it("the promotion function was found", () => {
    expect(promote.length).toBeGreaterThan(0);
  });

  it("it inserts an opportunity and nothing else", () => {
    const inserts = [...promote.matchAll(/INSERT INTO public\.(\w+)/g)].map((m) => m[1]);
    expect(inserts).toEqual(["opportunities"]);
  });

  it("it never conjures a company, user, project or quotation", () => {
    for (const t of ["companies", "auth.users", "projects", "quotations", "profiles"]) {
      expect(promote).not.toContain(`INSERT INTO ${t}`);
      expect(promote).not.toContain(`INSERT INTO public.${t}`);
    }
  });

  it("the mappings it reads are required before review", () => {
    const guard = sql.match(/FUNCTION public\.historical_promotion_guard[\s\S]*?\$\$;/)?.[0] ?? "";
    for (const f of ["company_id IS NULL", "owner_user_id IS NULL",
                     "coalesce(NEW.project_name,'')", "coalesce(NEW.status_canonical,'')"]) {
      expect(guard, `${f} must block review`).toContain(f);
    }
  });

  it("an absent amount is explained, never coerced to zero", () => {
    const guard = sql.match(/FUNCTION public\.historical_promotion_guard[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(guard).toContain("amount_absent_reason");
    // coalesce(amount, 0) anywhere would silently understate the pipeline.
    expect(code(sql)).not.toMatch(/coalesce\(\s*\w*amount\w*\s*,\s*0\s*\)/i);
  });
});

describe("conversion cannot go bulk", () => {
  it("a statement-level trigger counts real transitions", () => {
    expect(sql).toMatch(/REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows/);
    expect(sql).toMatch(/FOR EACH STATEMENT EXECUTE FUNCTION public\.historical_promotion_no_bulk/);
    const fn = sql.match(/FUNCTION public\.historical_promotion_no_bulk[\s\S]*?\$\$;/)?.[0] ?? "";
    // Counting NEW rows alone would trip on unrelated edits to promoted rows.
    expect(fn).toContain("a.status IS DISTINCT FROM b.status");
    expect(fn).toMatch(/_n > 1/);
  });

  it("promotion takes one request id, not a set", () => {
    expect(sql).toMatch(/FUNCTION public\.promote_historical_row\(_request_id UUID\)/);
    expect(sql).toMatch(/RETURNS UUID/);
  });
});

describe("who decides", () => {
  const fn = sql.match(/FUNCTION public\.can_approve_historical_promotion[\s\S]*?\$\$;/)?.[0] ?? "";

  it("is sales leadership, named explicitly", () => {
    for (const r of ["sales_manager", "bd_manager", "general_manager"]) expect(fn).toContain(r);
  });

  it("never borrows a helper that admits viewer or system_admin", () => {
    for (const bad of ["can_view_all_sales_data", "is_platform_admin", "is_commercial_manager"]) {
      expect(code(sql)).not.toContain(bad);
    }
  });

  it("returns false rather than null for an unknown user", () => {
    expect(fn).toContain("_user_id IS NOT NULL");
    expect(fn).toContain("is_active_user");
  });

  it("gates the promotion call itself, not only the approval", () => {
    const promote = sql.match(/FUNCTION public\.promote_historical_row[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(promote).toContain("can_approve_historical_promotion(_uid)");
  });
});

describe("the queue keeps its history", () => {
  it("no DELETE policy, backed by a trigger", () => {
    expect(code(sql)).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
    expect(sql).toContain("historical_promotion_no_delete");
  });

  it("a promoted request cannot be re-mapped", () => {
    const guard = sql.match(/FUNCTION public\.historical_promotion_guard[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(guard).toMatch(/OLD\.status IN \('promoted','rejected','cancelled'\)/);
  });

  it("an archive row yields at most one opportunity", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*?historical_promotion_one_opportunity/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*?historical_promotion_one_open[\s\S]*?WHERE status NOT IN \('rejected', 'cancelled'\)/);
  });

  it("promotion is idempotent rather than duplicating", () => {
    const promote = sql.match(/FUNCTION public\.promote_historical_row[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(promote).toMatch(/_r\.status = 'promoted'[\s\S]{0,200}RETURN _r\.promoted_opportunity_id/);
    expect(promote).toContain("FOR UPDATE");
  });
});

describe("the migration is shaped for a safe apply", () => {
  it("says LOCAL ONLY until approved", () => {
    expect(sql).toContain("LOCAL ONLY");
  });

  it("writes no business data and drops nothing", () => {
    expect(code(sql)).not.toMatch(/^\s*DROP\s+(TABLE|COLUMN)/im);
    expect(code(sql)).not.toMatch(/ALTER TABLE[^\n;]*DROP/i);
  });

  it("is the only Phase 7D migration, after the last applied one", () => {
    const p7d = readdirSync(MIGRATIONS).filter((f) => /_phase7d_/.test(f));
    expect(p7d).toEqual([FILE]);
    expect(FILE > "20260828120000_phase7c_approval_integration.sql").toBe(true);
  });
});
