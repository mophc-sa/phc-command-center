// Contract tests for the PR #22 hardening fixes (Required Fix 1, 2, 3, 4, 5,
// 8): static source/SQL inspection for behaviors that genuinely require a
// live Postgres connection to exercise for real (RLS enforcement, FK cascade
// behavior, atomic concurrent claims) — this repo's `db push` is explicitly
// forbidden during this fix pass, so these assert the exact SQL/TypeScript
// that will produce that behavior once applied, rather than the behavior
// itself. Real concurrency semantics for claim_ai_agent_request() are
// exercised at the unit level in ai-idempotency.test.ts (the interpretation
// logic) — what's left here is "does the migration/orchestrator actually
// wire up what Fix 1/2/3/4/5 require," which a live DB can't tell you if the
// SQL itself is wrong. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationsDir = join(repoRoot, "supabase/migrations");
const migrationFile = readdirSync(migrationsDir).find((f) => f.includes("ai_orchestrator"));
if (!migrationFile) throw new Error("ai_orchestrator migration not found");
const migrationSql = readFileSync(join(migrationsDir, migrationFile), "utf8");
const orchestratorIndex = readFileSync(join(repoRoot, "supabase/functions/ai-orchestrator/index.ts"), "utf8");
const registrySource = readFileSync(join(repoRoot, "supabase/functions/_shared/ai-agent-registry.ts"), "utf8");
const guardrailsSource = readFileSync(join(repoRoot, "supabase/functions/_shared/ai-guardrails.ts"), "utf8");
const docsSource = readFileSync(join(repoRoot, "docs/ai-orchestrator.md"), "utf8");

// ---------------------------------------------------------------------------
// Required Fix 1 — idempotency scope includes entity identity
// ---------------------------------------------------------------------------

test("ai_agent_outputs' idempotency unique index scopes on entity_type + entity_id, not just requested_by/agent_key", () => {
  const match = migrationSql.match(/CREATE UNIQUE INDEX ai_agent_outputs_idempotency_key\s+ON public\.ai_agent_outputs \(([^)]+)\)/);
  expect(match).not.toBeNull();
  const columns = match![1].split(",").map((c) => c.trim());
  expect(columns).toEqual(["requested_by", "agent_key", "entity_type", "entity_id", "client_request_id"]);
});

// ---------------------------------------------------------------------------
// Required Fix 2 — real request-claim table + RPC, not just the outputs index
// ---------------------------------------------------------------------------

test("ai_agent_requests table exists with the claim-key unique index matching the full idempotency scope", () => {
  expect(migrationSql).toMatch(/CREATE TABLE public\.ai_agent_requests/);
  const match = migrationSql.match(/CREATE UNIQUE INDEX ai_agent_requests_claim_key\s+ON public\.ai_agent_requests \(([^)]+)\)/);
  expect(match).not.toBeNull();
  const columns = match![1].split(",").map((c) => c.trim());
  expect(columns).toEqual(["requested_by", "agent_key", "entity_type", "entity_id", "client_request_id"]);
});

test("ai_agent_requests has a processing/succeeded/failed status CHECK constraint", () => {
  expect(migrationSql).toMatch(/ai_agent_requests_status_check[\s\S]{0,80}CHECK \(status IN \('processing','succeeded','failed'\)\)/);
});

test("claim_ai_agent_request() reclaims only failed or stale-processing rows, never a fresh processing or a succeeded row", () => {
  const fnMatch = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.claim_ai_agent_request[\s\S]*?\$\$;/);
  expect(fnMatch).not.toBeNull();
  const fn = fnMatch![0];
  expect(fn).toMatch(/r\.status = 'failed' OR \(r\.status = 'processing' AND r\.updated_at < now\(\) - make_interval/);
  // Insert-first-then-reclaim-on-conflict is what makes the claim atomic —
  // confirm the fast path is a real INSERT with a unique_violation handler,
  // not a read-then-write (SELECT ... then INSERT) which would race.
  expect(fn).toMatch(/INSERT INTO public\.ai_agent_requests/);
  expect(fn).toMatch(/EXCEPTION WHEN unique_violation THEN/);
});

test("index.ts only ever calls the provider after a successful (or no) claim — the claim happens before generateStructured", () => {
  const claimCallIdx = orchestratorIndex.indexOf("await claimRequest(svc,");
  const providerCallIdx = orchestratorIndex.indexOf("generateStructured(config");
  expect(claimCallIdx).toBeGreaterThan(-1);
  expect(providerCallIdx).toBeGreaterThan(-1);
  expect(claimCallIdx).toBeLessThan(providerCallIdx);
});

test("index.ts returns AI_REQUEST_IN_PROGRESS for a duplicate_processing claim outcome, without reaching the provider call", () => {
  const dupProcessingIdx = orchestratorIndex.indexOf('claim.kind === "duplicate_processing"');
  const inProgressIdx = orchestratorIndex.indexOf("AI_REQUEST_IN_PROGRESS");
  const providerCallIdx = orchestratorIndex.indexOf("generateStructured(config");
  expect(dupProcessingIdx).toBeGreaterThan(-1);
  expect(inProgressIdx).toBeGreaterThan(-1);
  expect(dupProcessingIdx).toBeLessThan(providerCallIdx);
});

test("AI_REQUEST_IN_PROGRESS is declared in the shared error-code list, not an ad-hoc string", () => {
  const schemas = readFileSync(join(repoRoot, "supabase/functions/_shared/ai-schemas.ts"), "utf8");
  expect(schemas).toMatch(/"AI_REQUEST_IN_PROGRESS"/);
});

// ---------------------------------------------------------------------------
// Required Fix 3 — trace persistence is checked, not fire-and-forget
// ---------------------------------------------------------------------------

test("the started trace event's result is checked, and the flow aborts before context/provider on failure", () => {
  const startedInsertIdx = orchestratorIndex.indexOf('status: "started"');
  const abortCheckIdx = orchestratorIndex.indexOf("if (!startedTrace.ok)");
  const contextLoadIdx = orchestratorIndex.indexOf("agentDef.loadContext(");
  expect(startedInsertIdx).toBeGreaterThan(-1);
  expect(abortCheckIdx).toBeGreaterThan(-1);
  expect(contextLoadIdx).toBeGreaterThan(-1);
  expect(startedInsertIdx).toBeLessThan(abortCheckIdx);
  expect(abortCheckIdx).toBeLessThan(contextLoadIdx);
});

test("insertTraceEvent's caller-visible return type can report failure — it is not a fire-and-forget void", () => {
  expect(orchestratorIndex).toContain("async function insertTraceEvent(");
  expect(orchestratorIndex).toMatch(/Promise<\{ ok: true \} \| \{ ok: false \}>/);
  // Every call site awaits and stores the result (not `await insertTraceEvent(...)` alone,
  // discarded) at least for the started/succeeded checked paths.
  expect(orchestratorIndex).toMatch(/const startedTrace = await insertTraceEvent\(/);
  expect(orchestratorIndex).toMatch(/const succeededTrace = await insertTraceEvent\(/);
});

test("a succeeded-trace or claim-update failure after a successful output insert returns AI_TRACE_PERSIST_FAILED, not ok:true", () => {
  const outputInsertIdx = orchestratorIndex.indexOf("Insert ai_agent_outputs (pending_review)");
  const finalCheckIdx = orchestratorIndex.indexOf("if (!succeededTrace.ok || !claimUpdate.ok)");
  const traceFailedReturnIdx = orchestratorIndex.indexOf('"AI_TRACE_PERSIST_FAILED"', finalCheckIdx);
  const okTrueReturnIdx = orchestratorIndex.lastIndexOf("ok: true");
  expect(outputInsertIdx).toBeGreaterThan(-1);
  expect(finalCheckIdx).toBeGreaterThan(outputInsertIdx);
  expect(traceFailedReturnIdx).toBeGreaterThan(finalCheckIdx);
  // The final "ok: true" success return must come AFTER (not before) the
  // AI_TRACE_PERSIST_FAILED check — i.e. it's genuinely gated by it, not
  // just present somewhere earlier in the file (e.g. the duplicate-succeeded
  // shortcut).
  expect(okTrueReturnIdx).toBeGreaterThan(finalCheckIdx);
});

test("the AI_TRACE_PERSIST_FAILED response after a persisted output carries outputId for reconciliation", () => {
  expect(orchestratorIndex).toMatch(/"AI_TRACE_PERSIST_FAILED"[\s\S]{0,300}outputId/);
  // The error envelope schema itself must allow it, not just this one call site.
  const schemas = readFileSync(join(repoRoot, "supabase/functions/_shared/ai-schemas.ts"), "utf8");
  const errorEnvelopeBlock = schemas.match(/export const ErrorEnvelopeSchema[\s\S]*?\.strict\(\);/);
  expect(errorEnvelopeBlock).not.toBeNull();
  expect(errorEnvelopeBlock![0]).toMatch(/outputId: z\.string\(\)\.uuid\(\)\.optional\(\)/);
});

test("docs/ai-orchestrator.md documents a reconciliation query for outputs with no successful terminal trace", () => {
  expect(docsSource.toLowerCase()).toContain("reconciliation");
  expect(docsSource).toMatch(/ai_agent_outputs[\s\S]{0,400}left join[\s\S]{0,200}ai_agent_trace_events/i);
});

// ---------------------------------------------------------------------------
// Required Fix 4 — old_data_classifier context limits
// ---------------------------------------------------------------------------

test("old_data_classifier's own query limits can never exceed MAX_CONTEXT_RECORDS even in the worst case", () => {
  const mappingsLimitMatch = registrySource.match(/OLD_DATA_MAPPINGS_LIMIT = (\d+)/);
  const dupesLimitMatch = registrySource.match(/OLD_DATA_DUPES_LIMIT = (\d+)/);
  const maxRecordsMatch = guardrailsSource.match(/MAX_CONTEXT_RECORDS = (\d+)/);
  expect(mappingsLimitMatch).not.toBeNull();
  expect(dupesLimitMatch).not.toBeNull();
  expect(maxRecordsMatch).not.toBeNull();
  const mappingsLimit = Number(mappingsLimitMatch![1]);
  const dupesLimit = Number(dupesLimitMatch![1]);
  const maxRecords = Number(maxRecordsMatch![1]);
  // 1 (the staged row itself) + mappings + dupes must never exceed the cap.
  expect(1 + mappingsLimit + dupesLimit).toBeLessThanOrEqual(maxRecords);
});

test("old_data_classifier truncates raw_data/mapped_data/detected_headers rather than embedding them unbounded", () => {
  expect(registrySource).toMatch(/RAW_DATA_MAX_CHARS/);
  expect(registrySource).toMatch(/MAPPED_DATA_MAX_CHARS/);
  expect(registrySource).toMatch(/OLD_DATA_HEADERS_LIMIT/);
  expect(registrySource).toMatch(/truncateSerialized\(row\.raw_data, RAW_DATA_MAX_CHARS\)/);
  expect(registrySource).toMatch(/truncateSerialized\(row\.mapped_data, MAPPED_DATA_MAX_CHARS\)/);
});

test("index.ts enforces a context character-length cap in addition to record count, and AI_MAX_INPUT_CHARS is actually read from the environment", () => {
  expect(orchestratorIndex).toMatch(/isContextTextWithinCharLimit\(contextResult\.contextText\)/);
  expect(orchestratorIndex).toMatch(/resolveMaxInputChars\(\(key\) => Deno\.env\.get\(key\)\)/);
});

test("docs/ai-orchestrator.md no longer claims AI_MAX_INPUT_CHARS is unwired", () => {
  expect(docsSource).not.toMatch(/not (yet )?wired|not read at runtime/i);
});

// ---------------------------------------------------------------------------
// Required Fix 5 — audit-history FK behavior (SET NULL, not CASCADE)
// ---------------------------------------------------------------------------

test("requested_by on all three AI tables uses ON DELETE SET NULL and is nullable, never ON DELETE CASCADE", () => {
  expect(migrationSql).not.toMatch(/requested_by uuid[^\n]*ON DELETE CASCADE/);
  const requestedByLines = [...migrationSql.matchAll(/requested_by uuid ([A-Z]+) REFERENCES auth\.users\(id\) ON DELETE (\w+)/g)];
  expect(requestedByLines.length).toBe(3); // trace_events, outputs, requests
  for (const m of requestedByLines) {
    expect(m[1]).toBe("NULL"); // nullable, not NOT NULL
    expect(m[2]).toBe("SET");  // "ON DELETE SET NULL" — captures "SET" of "SET NULL"
  }
});

test("RLS policies still correctly gate on requested_by = auth.uid(), which is NULL-safe by construction (a nulled row matches no one via that branch)", () => {
  expect(migrationSql).toMatch(/USING \(requested_by = auth\.uid\(\) OR public\.is_platform_admin\(auth\.uid\(\)\)\)/);
  expect(migrationSql).toMatch(/requested_by = auth\.uid\(\) AND \(entity_id IS NULL OR public\.ai_output_entity_still_owned/);
});

// ---------------------------------------------------------------------------
// Required Fix 8 — explicit --import-map in the documented deploy command
// ---------------------------------------------------------------------------

test("docs/ai-orchestrator.md's deploy command explicitly includes --import-map", () => {
  expect(docsSource).toMatch(/supabase functions deploy ai-orchestrator[\s\S]{0,200}--import-map[\s\S]{0,100}import_map\.json/);
});

test("no deployment instruction anywhere in the docs omits --import-map for this function", () => {
  // Captures the whole command, including backslash-continued lines, up to
  // the fenced code block's closing.
  const deployMentions = [...docsSource.matchAll(/supabase functions deploy ai-orchestrator[\s\S]*?(?:\n\s*```|\n\n)/g)];
  expect(deployMentions.length).toBeGreaterThan(0);
  for (const m of deployMentions) {
    expect(m[0]).toContain("--import-map");
  }
});
