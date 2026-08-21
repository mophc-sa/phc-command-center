// =============================================================================
// Pins the whole contracts policy set — read and write.
//
// Two defects. SELECT was `USING (true)`, so every signed-in account read every
// contract's client, value, reference number and dates. INSERT and UPDATE both
// admitted `system_admin`, so the account that administers users and roles
// could author and amend commercial terms — something the frontend has never
// offered, since the gate on the contract panel is `canManageSalesPipeline`.
//
// The behavioural suite proves the database refuses both. This runs in
// `bun test`, so a regression surfaces in seconds rather than after a container
// replay.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = join(root, "supabase/migrations");
const raw = readFileSync(join(MIGRATIONS, "20260822130000_contract_security.sql"), "utf8");
// The header quotes the old policy verbatim and the COMMENT explains which
// roles were deliberately excluded — both mention the names being asserted
// against, so predicates match the executable SQL with comments and COMMENT ON
// statements removed.
const code = raw
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
  .replace(/COMMENT ON [\s\S]*?;\n/g, "");

describe("the blanket policy is gone and cannot return", () => {
  it("drops it by name", () => {
    expect(code).toContain('DROP POLICY IF EXISTS "Contracts readable" ON public.contracts');
  });

  it("no migration in the repo creates a USING (true) SELECT policy on contracts", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
      const s = readFileSync(join(MIGRATIONS, f), "utf8")
        .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
      for (const m of s.matchAll(/CREATE POLICY[\s\S]{0,400}?ON public\.contracts[\s\S]{0,200}?;/g)) {
        if (/FOR SELECT[\s\S]*?USING\s*\(\s*true\s*\)/i.test(m[0])) offenders.push(f);
      }
    }
    // The original grant lives in an older migration and is superseded by the
    // DROP above; what must never happen is a NEW one being added after it.
    const afterThisFix = offenders.filter((f) => f > "20260822130000");
    expect(afterThisFix).toEqual([]);
  });
});

describe("the read set excludes what it must", () => {
  it("does not reuse can_view_all_sales_data — it includes viewer and system_admin", () => {
    expect(code).not.toContain("can_view_all_sales_data");
  });

  it("admits nobody by system_admin or viewer role", () => {
    expect(code).not.toContain("system_admin");
    expect(code).not.toContain("viewer");
  });

  it("is built from the pipeline set plus finance plus a personal stake", () => {
    expect(code).toContain("public.is_pipeline_operator(_user_id)");
    expect(code).toContain("'finance_manager'::public.app_role");
    expect(code).toMatch(/o\.owner_id = _user_id/);
  });

  it("refuses inactive accounts and null users", () => {
    expect(code).toContain("_user_id IS NOT NULL");
    expect(code).toContain("public.is_active_user(_user_id)");
  });

  it("returns a real boolean rather than NULL for a contract with no responsible user", () => {
    expect(code).toContain("COALESCE(_responsible_user_id = _user_id, FALSE)");
    expect(code).toContain("COALESCE(_created_by = _user_id, FALSE)");
  });
});

describe("the write set is narrower than the read set", () => {
  it("writing is active pipeline operators, and nothing else", () => {
    const fn = code.match(/CREATE OR REPLACE FUNCTION public\.can_write_contract[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toBeTruthy();
    expect(fn).toContain("public.is_pipeline_operator(_user_id)");
    expect(fn).toContain("public.is_active_user(_user_id)");
    // No finance, no personal stake — reading a contract must not imply
    // authoring one, and an owner-edit right would be a new capability.
    expect(fn).not.toContain("finance_manager");
    expect(fn).not.toContain("owner_id");
    expect(fn).not.toContain("responsible");
  });

  it("both write policies are replaced, not left alongside the old ones", () => {
    expect(code).toContain('DROP POLICY IF EXISTS "Contracts insertable by pipeline operator or admin"');
    expect(code).toContain('DROP POLICY IF EXISTS "Contracts updatable by pipeline operator or admin"');
  });

  it("UPDATE checks both which rows may change and what they may become", () => {
    const pol = code.match(/CREATE POLICY[^;]*FOR UPDATE[\s\S]*?;/)?.[0] ?? "";
    expect(pol).toContain("USING (public.can_write_contract");
    expect(pol).toContain("WITH CHECK (public.can_write_contract");
  });

  it("still adds no DELETE policy", () => {
    expect(code).not.toMatch(/FOR DELETE/);
  });
});

describe("the fix changes nothing it should not", () => {
  it("changes no business data", () => {
    expect(code).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+public\./i);
  });

  it("is local only until approved", () => {
    expect(raw).toContain("LOCAL ONLY");
  });

  it("touches no schema and no contract workflow", () => {
    expect(code).not.toMatch(/ALTER TABLE|CREATE TABLE|DROP TABLE|CREATE TYPE|ALTER TYPE|CREATE TRIGGER/i);
  });

  it("is a single migration — the whole contract policy set lives in one file", () => {
    const contractMigrations = readdirSync(MIGRATIONS)
      .filter((f) => /contract.*security|contracts?_read/i.test(f));
    expect(contractMigrations).toEqual(["20260822130000_contract_security.sql"]);
  });

  it("the predicate never reads the table it protects, so it cannot recurse", () => {
    const fn = code.match(/CREATE OR REPLACE FUNCTION public\.can_read_contract[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toBeTruthy();
    expect(fn).not.toMatch(/FROM public\.contracts/);
    expect(fn).toContain("SECURITY DEFINER");
  });
});
