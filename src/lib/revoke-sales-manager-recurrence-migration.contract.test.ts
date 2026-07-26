// Contract test for 20260727110000_revoke_sales_manager_moalagab_recurrence.sql —
// static SQL inspection confirming the idempotent DO block matches the
// established precedent (20260721100000_ensure_moalagab_system_admin_only.sql):
// bypass the self-revoke guard for one statement, remove only guarded
// commercial-manager roles, and grant system_admin without touching
// unrelated roles (e.g. salesperson). Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationPath = join(
  repoRoot,
  "supabase/migrations/20260727110000_revoke_sales_manager_moalagab_recurrence.sql",
);
const sql = readFileSync(migrationPath, "utf8");

test("targets moalagab@phc-sa.com only", () => {
  expect(sql).toMatch(/WHERE email = 'moalagab@phc-sa\.com'/);
});

test("is a no-op when the account does not exist (safe on dev/CI)", () => {
  expect(sql).toMatch(/IF _user_id IS NULL THEN/);
  expect(sql).toMatch(/RETURN;/);
});

test("bypasses the self-revoke guard for exactly the delete statement", () => {
  const disableIdx = sql.indexOf("DISABLE TRIGGER trg_protect_last_manager");
  const deleteIdx = sql.indexOf("DELETE FROM public.user_roles");
  const enableIdx = sql.indexOf("ENABLE TRIGGER trg_protect_last_manager");
  expect(disableIdx).toBeGreaterThan(-1);
  expect(deleteIdx).toBeGreaterThan(disableIdx);
  expect(enableIdx).toBeGreaterThan(deleteIdx);
});

test("removes only guarded commercial-manager roles, not salesperson", () => {
  expect(sql).toMatch(/role IN \('sales_manager', 'general_manager', 'managing_director', 'ceo'\)/);
  expect(sql).not.toMatch(/'salesperson'/);
});

test("grants system_admin idempotently", () => {
  expect(sql).toMatch(/INSERT INTO public\.user_roles \(user_id, role\)\s*\n\s*VALUES \(_user_id, 'system_admin'\)/);
  expect(sql).toMatch(/ON CONFLICT \(user_id, role\) DO NOTHING/);
});

test("logs an audit_log entry only when a role was actually removed", () => {
  expect(sql).toMatch(/IF array_length\(_removed, 1\) > 0 THEN/);
  expect(sql).toMatch(/INSERT INTO public\.audit_log/);
});
