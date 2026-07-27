// Contract test for 20260727130000_allow_self_revoke_commercial_roles.sql —
// narrows protect_last_manager()'s self-revoke guard to system_admin only,
// after the same "granted myself a commercial role, now stuck" incident
// recurred a 4th time. Also covers the matching admin-settings.tsx change
// (client-side guard must agree with what the server now allows). Run with
// `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationPath = join(
  repoRoot,
  "supabase/migrations/20260727130000_allow_self_revoke_commercial_roles.sql",
);
const sql = readFileSync(migrationPath, "utf8");

test("self-revoke guard only fires for system_admin, not commercial-manager roles", () => {
  const fnStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.protect_last_manager()");
  const fnEnd = sql.indexOf("$$;", fnStart);
  const body = sql.slice(fnStart, fnEnd);
  expect(body).toMatch(/IF OLD\.role = 'system_admin' AND OLD\.user_id = auth\.uid\(\) THEN/);
  expect(body).not.toMatch(/guarded public\.app_role\[\]/);
});

test("keeps the last-commercial-manager org-wide protection unchanged", () => {
  expect(sql).toMatch(/OLD\.role IN \('managing_director','general_manager','ceo','sales_manager'\)/);
  expect(sql).toMatch(/Cannot remove the last commercial manager account/);
});

test("cleans up moalagab@phc-sa.com's commercial roles idempotently, without disabling the trigger", () => {
  expect(sql).toMatch(/WHERE email = 'moalagab@phc-sa\.com'/);
  expect(sql).not.toMatch(/DISABLE TRIGGER/);
  expect(sql).not.toMatch(/ENABLE TRIGGER/);
});

test("admin-settings.tsx only guards self-revocation of system_admin", () => {
  const adminSettingsSrc = readFileSync(
    join(repoRoot, "src/routes/_authenticated/admin-settings.tsx"),
    "utf8",
  );
  expect(adminSettingsSrc).toMatch(/const guardSelf = isSelf && has && isSystemAdmin\(role\);/);
  expect(adminSettingsSrc).not.toMatch(/isManagerRole/);
});
