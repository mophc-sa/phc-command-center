// Source-contract tests for the atomic execute_approved_record_delete RPC —
// confirms the RPC is defined in the Sprint 8 migration, the duplicate-
// request partial unique index exists, and the sales-os-api execute_delete
// handler calls the RPC instead of performing any direct delete/update/audit
// itself. These read the actual .sql/.ts source as text (same technique as
// roles.contract.test.ts reading migration files) rather than mocking
// Supabase — there is no live-DB or Deno-runtime test harness in this repo
// to exercise the RPC's transactional behavior directly.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../supabase/migrations");
const edgeFunctionPath = join(here, "../../supabase/functions/sales-os-api/handlers/lifecycle.ts");

function migrationText(): string {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const target = files.find((f) => f.includes("rbac_record_lifecycle_hardening"));
  if (!target) throw new Error("Sprint 8 RBAC/record-lifecycle migration file not found");
  return readFileSync(join(migrationsDir, target), "utf8");
}

// Isolate just the execute_delete handler's body so the "no direct delete"
// assertion can't accidentally pass/fail based on unrelated handlers
// elsewhere in this large file.
function executeDeleteHandlerBody(): string {
  const src = readFileSync(edgeFunctionPath, "utf8");
  const start = src.indexOf("async function execute_delete(");
  expect(start, "execute_delete handler not found in lifecycle module").toBeGreaterThan(-1);
  // Next handler starts at module scope, or the manifest export begins.
  const rest = src.slice(start);
  const nextHandler = rest.indexOf("\nasync function ", 1);
  const manifest = rest.indexOf("\nexport const lifecycleModule");
  const end =
    nextHandler === -1 ? manifest : Math.min(nextHandler, manifest === -1 ? Infinity : manifest);
  expect(end, "could not find the end of the execute_delete handler").toBeGreaterThan(-1);
  return rest.slice(0, end);
}

test("the atomic execute_approved_record_delete RPC is defined in the Sprint 8 migration", () => {
  const sql = migrationText();
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.execute_approved_record_delete\s*\(/);
  expect(sql).toMatch(/SECURITY DEFINER/);
});

test("the RPC is scoped to service_role only, not to authenticated/anon", () => {
  const sql = migrationText();
  expect(sql).toMatch(
    /REVOKE EXECUTE ON FUNCTION public\.execute_approved_record_delete\(uuid, uuid\) FROM PUBLIC, anon, authenticated/,
  );
  expect(sql).toMatch(
    /GRANT EXECUTE ON FUNCTION public\.execute_approved_record_delete\(uuid, uuid\) TO service_role/,
  );
});

test("the RPC's own hard-delete allowlist inside the SQL matches the final conservative list", () => {
  const sql = migrationText();
  expect(sql).toMatch(
    /_allowed_tables text\[\] := ARRAY\['follow_ups', 'activities', 'inbox_items', 'boqs'\]/,
  );
});

test("the RPC locks the approval row (FOR UPDATE) before checking it, to guard against concurrent execution", () => {
  const sql = migrationText();
  expect(sql).toMatch(
    /SELECT \* INTO _appr FROM public\.approvals WHERE id = _approval_id FOR UPDATE/,
  );
});

test("the RPC verifies the delete affected exactly one row before marking the approval executed", () => {
  const sql = migrationText();
  expect(sql).toMatch(/GET DIAGNOSTICS _deleted_count = ROW_COUNT/);
  expect(sql).toMatch(/IF _deleted_count <> 1 THEN/);
});

test("the RPC is hardened against a hijacked search_path (public, pg_temp only)", () => {
  const sql = migrationText();
  expect(sql).toMatch(
    /CREATE OR REPLACE FUNCTION public\.execute_approved_record_delete[\s\S]*?SET search_path = public, pg_temp/,
  );
});

test("a partial unique index prevents a second active delete request for the same record", () => {
  const sql = migrationText();
  expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS one_active_delete_request_per_record/);
  expect(sql).toMatch(/WHERE requested_action = 'delete_record'/);
  expect(sql).toMatch(/AND status IN \('pending', 'approved'\)/);
});

test("the partial unique index uses the NULL-safe IS DISTINCT FROM 'executed', not a bare <> comparison", () => {
  const sql = migrationText();
  const indexStart = sql.indexOf(
    "CREATE UNIQUE INDEX IF NOT EXISTS one_active_delete_request_per_record",
  );
  expect(indexStart, "index definition not found").toBeGreaterThan(-1);
  const indexStatement = sql.slice(indexStart, sql.indexOf(";", indexStart) + 1);
  expect(indexStatement).toMatch(/execution_status IS DISTINCT FROM 'executed'/);
  // The old NULL-unsafe predicate must not remain anywhere in this
  // statement — a partial index silently excludes rows where the WHERE
  // clause evaluates to UNKNOWN (which is what `<>` does against NULL),
  // which would have let a NULL-execution_status row bypass the uniqueness
  // guarantee entirely.
  expect(indexStatement).not.toMatch(/execution_status <> 'executed'/);
});

test("the execute_delete edge-function handler calls the RPC", () => {
  const body = executeDeleteHandlerBody();
  expect(body).toMatch(/\.rpc\(\s*["']execute_approved_record_delete["']/);
});

test("the execute_delete edge-function handler performs NO direct delete call", () => {
  const body = executeDeleteHandlerBody();
  expect(body).not.toMatch(/\.delete\(\)/);
});

test("the execute_delete edge-function handler performs NO direct approvals status update or audit() call — the RPC owns both", () => {
  const body = executeDeleteHandlerBody();
  expect(body).not.toMatch(/\.from\(\s*["']approvals["']\s*\)\s*\.update\(/);
  expect(body).not.toMatch(/\bauditLog\(svc/);
});
