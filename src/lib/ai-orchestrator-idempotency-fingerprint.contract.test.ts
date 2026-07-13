// Contract tests for the idempotency payload-conflict fix (follow-up to PR
// #22's Required Fixes 1/2): static source/SQL inspection for behaviors that
// genuinely require a live Postgres connection to exercise for real (atomic
// claim/conflict resolution) — `db push`/deploy are explicitly forbidden
// while this fix is local-only, so these assert the exact SQL/TypeScript
// that will produce the intended behavior once applied, the same pattern
// already used in ai-orchestrator-hardening.contract.test.ts. The
// interpretation-layer logic (ai-idempotency.ts) and the canonicalization/
// hashing logic (ai-fingerprint.ts) are exercised directly as real unit
// tests in their own *.test.ts files — what's left here is "does the
// migration/orchestrator actually wire this up correctly." Run with
// `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationPath = join(repoRoot, "supabase/migrations/20260711200000_ai_orchestrator_idempotency_fingerprint.sql");
const migrationSql = readFileSync(migrationPath, "utf8");
const orchestratorIndex = readFileSync(join(repoRoot, "supabase/functions/ai-orchestrator/index.ts"), "utf8");
const schemasSource = readFileSync(join(repoRoot, "supabase/functions/_shared/ai-schemas.ts"), "utf8");
const docsSource = readFileSync(join(repoRoot, "docs/ai-orchestrator.md"), "utf8");

// ---------------------------------------------------------------------------
// Migration: new column, additive, nullable, not part of any unique index
// ---------------------------------------------------------------------------

test("request_fingerprint is added as a nullable text column with a descriptive comment", () => {
  expect(migrationSql).toMatch(/ALTER TABLE public\.ai_agent_requests\s+ADD COLUMN request_fingerprint text NULL;/);
  expect(migrationSql).toMatch(/COMMENT ON COLUMN public\.ai_agent_requests\.request_fingerprint IS/);
});

test("request_fingerprint is never added to any unique index — the existing 5-field claim scope is unchanged", () => {
  const uniqueIndexBlocks = [...migrationSql.matchAll(/CREATE UNIQUE INDEX[\s\S]*?;/g)].map((m) => m[0]);
  // This migration adds no new unique index at all (the fingerprint is
  // compared inside the RPC against an already-located row, never indexed).
  expect(uniqueIndexBlocks.length).toBe(0);
  expect(migrationSql).not.toMatch(/UNIQUE INDEX[^;]*request_fingerprint/);
});

test("the migration does not touch ai_agent_outputs or any RLS policy/grant", () => {
  expect(migrationSql).not.toMatch(/ALTER TABLE public\.ai_agent_outputs/);
  expect(migrationSql).not.toMatch(/CREATE POLICY/);
  expect(migrationSql).not.toMatch(/ENABLE ROW LEVEL SECURITY/);
});

// ---------------------------------------------------------------------------
// Migration: RPC signature — additive, backward-compatible
// ---------------------------------------------------------------------------

test("the old 7-argument claim_ai_agent_request signature is explicitly dropped before the new 8-argument one is created", () => {
  const dropIdx = migrationSql.indexOf(
    "DROP FUNCTION IF EXISTS public.claim_ai_agent_request(uuid, text, text, uuid, text, uuid, integer);",
  );
  const createIdx = migrationSql.indexOf("CREATE OR REPLACE FUNCTION public.claim_ai_agent_request(");
  expect(dropIdx).toBeGreaterThan(-1);
  expect(createIdx).toBeGreaterThan(-1);
  expect(dropIdx).toBeLessThan(createIdx);
});

test("_input_fingerprint is a trailing parameter with DEFAULT NULL, so an old caller omitting it still resolves unambiguously", () => {
  const fnMatch = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.claim_ai_agent_request\(([\s\S]*?)\)\s*\nRETURNS/);
  expect(fnMatch).not.toBeNull();
  const paramBlock = fnMatch![1];
  expect(paramBlock.trim().endsWith("_input_fingerprint text DEFAULT NULL")).toBe(true);
});

test("grants are re-asserted for the new 8-argument signature, service_role only", () => {
  expect(migrationSql).toMatch(
    /REVOKE EXECUTE ON FUNCTION public\.claim_ai_agent_request\(uuid, text, text, uuid, text, uuid, integer, text\) FROM PUBLIC, anon, authenticated;/,
  );
  expect(migrationSql).toMatch(
    /GRANT EXECUTE ON FUNCTION public\.claim_ai_agent_request\(uuid, text, text, uuid, text, uuid, integer, text\) TO service_role;/,
  );
});

// ---------------------------------------------------------------------------
// Migration: conflict-detection logic itself
// ---------------------------------------------------------------------------

test("the RPC returns a 'conflict' outcome only when both fingerprints are non-null and differ", () => {
  const fnMatch = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.claim_ai_agent_request[\s\S]*?\$\$;/);
  expect(fnMatch).not.toBeNull();
  const fn = fnMatch![0];
  expect(fn).toMatch(
    /IF v_existing_fingerprint IS NOT NULL\s+AND _input_fingerprint IS NOT NULL\s+AND v_existing_fingerprint <> _input_fingerprint THEN/,
  );
  expect(fn).toMatch(/SELECT r\.id, false, 'conflict'::text, r\.output_id, r\.trace_id/);
});

test("the conflict branch returns before the reclaim UPDATE — it can never reclaim, change status, or touch request_fingerprint", () => {
  const fnMatch = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.claim_ai_agent_request[\s\S]*?\$\$;/);
  const fn = fnMatch![0];
  const conflictIdx = fn.indexOf("'conflict'::text");
  const reclaimUpdateIdx = fn.indexOf("SET status = 'processing', trace_id = _trace_id, request_fingerprint = _input_fingerprint");
  expect(conflictIdx).toBeGreaterThan(-1);
  expect(reclaimUpdateIdx).toBeGreaterThan(-1);
  expect(conflictIdx).toBeLessThan(reclaimUpdateIdx);
  // The conflict RETURN QUERY block itself contains no UPDATE statement.
  const conflictBlockEnd = fn.indexOf("RETURN;", conflictIdx);
  const conflictBlock = fn.slice(fn.lastIndexOf("IF v_existing_fingerprint", conflictIdx), conflictBlockEnd);
  expect(conflictBlock).not.toMatch(/UPDATE public\.ai_agent_requests/);
});

test("a NULL existing fingerprint (a legacy pre-fix row) or a NULL supplied fingerprint (pre-redeploy caller) never triggers a conflict, preserving prior behavior", () => {
  const fnMatch = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.claim_ai_agent_request[\s\S]*?\$\$;/);
  const fn = fnMatch![0];
  // Both operands are required to be IS NOT NULL before the inequality check
  // runs at all — this is exactly what makes a NULL on either side fall
  // through to the original reclaim logic instead of ever comparing.
  expect(fn).toMatch(/v_existing_fingerprint IS NOT NULL/);
  expect(fn).toMatch(/_input_fingerprint IS NOT NULL/);
});

test("the reclaim UPDATE's status conditions (failed / stale-processing) are unchanged from the original migration", () => {
  const fnMatch = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.claim_ai_agent_request[\s\S]*?\$\$;/);
  const fn = fnMatch![0];
  expect(fn).toMatch(/r\.status = 'failed' OR \(r\.status = 'processing' AND r\.updated_at < now\(\) - make_interval/);
});

// ---------------------------------------------------------------------------
// index.ts: fingerprint computed before the claim, conflict handled before
// context/provider/output — mirrors the same ordinal-position style already
// used in ai-orchestrator-hardening.contract.test.ts.
// ---------------------------------------------------------------------------

test("index.ts computes the request fingerprint before calling claim_ai_agent_request", () => {
  const fingerprintIdx = orchestratorIndex.indexOf("await computeRequestFingerprint(");
  const claimCallIdx = orchestratorIndex.indexOf("await claimRequest(svc,");
  expect(fingerprintIdx).toBeGreaterThan(-1);
  expect(claimCallIdx).toBeGreaterThan(-1);
  expect(fingerprintIdx).toBeLessThan(claimCallIdx);
});

test("the effective provider override is resolved once and reused for both the fingerprint and the real provider resolution", () => {
  const resolvedIdx = orchestratorIndex.indexOf("resolveEffectiveProviderOverride(request.provider ?? null, adminOverrideAllowed)");
  const fingerprintCallIdx = orchestratorIndex.indexOf("providerOverride: effectiveProviderOverride");
  const laterProviderResolutionIdx = orchestratorIndex.indexOf("resolveProviderConfig((key) => Deno.env.get(key)");
  expect(resolvedIdx).toBeGreaterThan(-1);
  expect(fingerprintCallIdx).toBeGreaterThan(-1);
  expect(laterProviderResolutionIdx).toBeGreaterThan(-1);
  expect(resolvedIdx).toBeLessThan(fingerprintCallIdx);
  expect(fingerprintCallIdx).toBeLessThan(laterProviderResolutionIdx);
  // adminOverrideAllowed must not be computed a second time later in the file.
  const occurrences = [...orchestratorIndex.matchAll(/const adminOverrideAllowed = isSystemAdmin\(caller\.roles\);/g)];
  expect(occurrences.length).toBe(1);
});

test("index.ts handles claim.kind === 'conflict' before context loading, provider resolution, the provider call, and the output insert", () => {
  const conflictIdx = orchestratorIndex.indexOf('claim.kind === "conflict"');
  const contextLoadIdx = orchestratorIndex.indexOf("agentDef.loadContext(");
  const providerResolveIdx = orchestratorIndex.indexOf("resolveProviderConfig((key) => Deno.env.get(key)");
  const providerCallIdx = orchestratorIndex.indexOf("generateStructured(config");
  const outputInsertIdx = orchestratorIndex.indexOf("Insert ai_agent_outputs (pending_review)");
  expect(conflictIdx).toBeGreaterThan(-1);
  expect(contextLoadIdx).toBeGreaterThan(-1);
  expect(providerResolveIdx).toBeGreaterThan(-1);
  expect(providerCallIdx).toBeGreaterThan(-1);
  expect(outputInsertIdx).toBeGreaterThan(-1);
  expect(conflictIdx).toBeLessThan(contextLoadIdx);
  expect(conflictIdx).toBeLessThan(providerResolveIdx);
  expect(conflictIdx).toBeLessThan(providerCallIdx);
  expect(conflictIdx).toBeLessThan(outputInsertIdx);
});

test("the conflict response returns HTTP 409 with AI_IDEMPOTENCY_CONFLICT and a generic, non-leaking message", () => {
  const conflictBranch = orchestratorIndex.slice(
    orchestratorIndex.indexOf('claim.kind === "conflict"'),
    orchestratorIndex.indexOf('claim.kind === "duplicate_succeeded"'),
  );
  expect(conflictBranch).toMatch(/"AI_IDEMPOTENCY_CONFLICT"/);
  expect(conflictBranch).toMatch(/409/);
  expect(conflictBranch).toMatch(/already used with a different request payload/);
});

test("the conflict code path never references the fingerprint, canonical JSON, old input, or new input in what gets sent to the client or stored in trace metadata", () => {
  const conflictBranch = orchestratorIndex.slice(
    orchestratorIndex.indexOf('claim.kind === "conflict"'),
    orchestratorIndex.indexOf('claim.kind === "duplicate_succeeded"'),
  );
  // The only reference to "inputFingerprint" allowed in this whole file is
  // where it is COMPUTED and PASSED to claimRequest — never inside the
  // conflict-handling branch's trace/error-envelope construction.
  expect(conflictBranch).not.toMatch(/inputFingerprint/);
  expect(conflictBranch).not.toMatch(/canonicalJson/i);
  expect(conflictBranch).not.toMatch(/request\.input/);
});

test("the conflict trace event reuses the existing 'rejected' status — no new trace status value or CHECK-constraint change was needed", () => {
  const conflictBranch = orchestratorIndex.slice(
    orchestratorIndex.indexOf('claim.kind === "conflict"'),
    orchestratorIndex.indexOf('claim.kind === "duplicate_succeeded"'),
  );
  expect(conflictBranch).toMatch(/status: "rejected"/);
  expect(conflictBranch).toMatch(/reason: "idempotency_payload_conflict"/);
});

test("the conflict path never calls markClaim — the existing request row's status is never mutated on conflict", () => {
  const conflictBranch = orchestratorIndex.slice(
    orchestratorIndex.indexOf('claim.kind === "conflict"'),
    orchestratorIndex.indexOf('claim.kind === "duplicate_succeeded"'),
  );
  expect(conflictBranch).not.toMatch(/markClaim\(/);
});

// ---------------------------------------------------------------------------
// Error code + docs
// ---------------------------------------------------------------------------

test("AI_IDEMPOTENCY_CONFLICT is declared in the shared error-code list, not an ad-hoc string", () => {
  expect(schemasSource).toMatch(/"AI_IDEMPOTENCY_CONFLICT"/);
});

test("docs/ai-orchestrator.md documents the fingerprint, the conflict outcome, and the NULL-legacy-row behavior", () => {
  expect(docsSource).toMatch(/AI_IDEMPOTENCY_CONFLICT/);
  expect(docsSource).toMatch(/request_fingerprint/);
  expect(docsSource.toLowerCase()).toMatch(/legacy/);
});
