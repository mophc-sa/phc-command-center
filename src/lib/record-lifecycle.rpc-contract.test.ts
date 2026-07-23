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
import { DELETABLE_ENTITY_TYPES } from "./record-lifecycle-actions";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../supabase/migrations");
const edgeFunctionPath = join(here, "../../supabase/functions/sales-os-api/handlers/lifecycle.ts");

function migrationText(): string {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const target = files.find((f) => f.includes("rbac_record_lifecycle_hardening"));
  if (!target) throw new Error("Sprint 8 RBAC/record-lifecycle migration file not found");
  return readFileSync(join(migrationsDir, target), "utf8");
}

// The Sprint 8 migration's CREATE OR REPLACE is superseded (not deleted —
// migrations are append-only history) by this later, additive migration,
// which is now the authoritative source for execute_approved_record_delete's
// current body (Pathfinder D5 — routes import-batch purge through the
// governed delete flow). Tests asserting on the function's *current*
// behavior must read this file, not the Sprint 8 one.
function extendedMigrationText(): string {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const target = files.find((f) => f.includes("extend_delete_allowlist_import_batches"));
  if (!target) throw new Error("extend_delete_allowlist_import_batches migration file not found");
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

test("the RPC's own hard-delete allowlist inside the SQL matches the final conservative list, now including import_batches", () => {
  const sql = extendedMigrationText();
  expect(sql).toMatch(
    /_allowed_tables text\[\] := ARRAY\['follow_ups', 'activities', 'inbox_items', 'boqs', 'import_batches'\]/,
  );
});

test("the import_batches branch refuses to delete a batch with committed record links, before touching anything", () => {
  const sql = extendedMigrationText();
  const branchStart = sql.indexOf("WHEN 'import_batches' THEN\n");
  expect(branchStart, "import_batches delete branch not found").toBeGreaterThan(-1);
  const branchEnd = sql.indexOf("DELETE FROM public.import_batches", branchStart);
  expect(branchEnd, "DELETE FROM public.import_batches not found after the branch start").toBeGreaterThan(-1);
  const guardText = sql.slice(branchStart, branchEnd);
  // The guard (checking import_record_links and RAISEing) must appear
  // BEFORE the DELETE — mirrors the old purge_batch handler's safety check
  // (refuse to purge a batch with committed record links), now enforced
  // inside the atomic transaction itself rather than at the old ad-hoc
  // Edge Function layer. A future edit that moves or drops this guard
  // would silently reintroduce the provenance-loss regression this test
  // exists to catch.
  expect(guardText).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM public\.import_record_links WHERE batch_id = _appr\.linked_record_id\s*\)/);
  expect(guardText).toMatch(/RAISE EXCEPTION 'Batch has committed record links/);
});

test("all three independent delete allowlists (SQL, edge guard, browser client) stay in sync", () => {
  const sql = extendedMigrationText();
  const sqlMatch = sql.match(/_allowed_tables text\[\] := ARRAY\[([^\]]+)\]/);
  expect(sqlMatch, "could not find _allowed_tables array in the migration").not.toBeNull();
  const sqlTables = sqlMatch![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();

  const edgeGuardPath = join(here, "../../supabase/functions/_shared/record-lifecycle.ts");
  const edgeGuardSrc = readFileSync(edgeGuardPath, "utf8");
  const edgeMatch = edgeGuardSrc.match(/export const DELETABLE_TABLES = \[([^\]]+)\]/);
  expect(edgeMatch, "could not find DELETABLE_TABLES in _shared/record-lifecycle.ts").not.toBeNull();
  const edgeTables = edgeMatch![1].split(",").map((s) => s.trim().replace(/"/g, "")).sort();

  const browserTables = [...DELETABLE_ENTITY_TYPES].sort();

  expect(edgeTables).toEqual(sqlTables);
  expect(browserTables).toEqual(sqlTables);
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
