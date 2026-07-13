// Contract tests for the Sprint 10 Safe AI Orchestrator: static source
// inspection, not execution — these guard invariants that must hold no
// matter how the implementation evolves. No live provider calls, no DB
// connection. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const functionsSharedDir = join(repoRoot, "supabase/functions/_shared");
const orchestratorDir = join(repoRoot, "supabase/functions/ai-orchestrator");
const srcDir = join(repoRoot, "src");

function readAll(dir: string, suffix = ".ts"): { path: string; content: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => ({ path: join(dir, f), content: readFileSync(join(dir, f), "utf8") }));
}

function readAllRecursive(dir: string, suffix = ".ts"): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...readAllRecursive(full, suffix));
    } else if (entry.name.endsWith(suffix)) {
      out.push({ path: full, content: readFileSync(full, "utf8") });
    }
  }
  return out;
}

const orchestratorIndex = readFileSync(join(orchestratorDir, "index.ts"), "utf8");
const registrySource = readFileSync(join(functionsSharedDir, "ai-agent-registry.ts"), "utf8");
const aiSchemasSource = readFileSync(join(functionsSharedDir, "ai-schemas.ts"), "utf8");
const frontendClientSource = readFileSync(join(srcDir, "lib", "ai-orchestrator-actions.ts"), "utf8");

// ---------------------------------------------------------------------------
// "Edge Function contains no direct send/delete/owner-change/import-commit call"
// ---------------------------------------------------------------------------

const aiFunctionSources = [orchestratorIndex, registrySource, ...readAll(functionsSharedDir).map((f) => f.content).filter((c) => c.includes("ai-"))];
const combinedAiSource = aiFunctionSources.join("\n");

test("ai-orchestrator never calls a hard-delete on any table", () => {
  expect(combinedAiSource).not.toMatch(/\.from\([^)]+\)\s*\.\s*delete\s*\(/);
});

test("ai-orchestrator never issues an owner_id / stage / status update against a live CRM table", () => {
  // The only .update(...) calls anywhere in this sprint's code target
  // ai_agent_outputs (via the shared updated_at trigger) and ai_agent_requests
  // (the Required-Fix-2 concurrency-claim ledger) — never opportunities/
  // rfqs/tenders/quotations/companies/contacts.
  const updateCalls = [...combinedAiSource.matchAll(/\.from\(\s*["'`]([\w]+)["'`]\s*\)[\s\S]{0,200}?\.update\(/g)];
  for (const m of updateCalls) {
    expect(["ai_agent_trace_events", "ai_agent_outputs", "ai_agent_requests"]).toContain(m[1]);
  }
});

test("ai-orchestrator never invokes the import-pipeline commit action", () => {
  expect(combinedAiSource).not.toContain("dry_run_commit");
  expect(combinedAiSource).not.toMatch(/invoke\(\s*["'`]import-pipeline["'`]/);
});

test("ai-orchestrator never calls an email/WhatsApp/webhook send API", () => {
  // Matched as an actual invocation/call shape, not a bare word — this
  // module's own guardrail code legitimately discusses "webhook" as
  // *language to detect and reject* (ai-guardrails.ts's ACTION_URL_CONTEXT),
  // which is the opposite of calling one.
  const dangerous = /\b(sendEmail|sendWhatsApp|sendMessage)\s*\(|resend\.emails\.|twilio\.|\bwebhook\s*\(/i;
  expect(combinedAiSource).not.toMatch(dangerous);
});

// ---------------------------------------------------------------------------
// "frontend contains no provider API key reference"
// "API-key environment variable names exist only in server-side function
// code/config/docs"
// ---------------------------------------------------------------------------

const KEY_VAR_NAMES = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
// This contract test file itself legitimately references the key NAMES as
// fixtures/assertions — exclude *.test.ts from both scans below, since the
// property being verified is "not used in application code," not "the
// string never appears in any file in the repository."
const isTestFile = (path: string) => path.endsWith(".test.ts");

test("frontend (src/) application code never references a provider API key environment variable name", () => {
  const frontendFiles = readAllRecursive(srcDir).filter((f) => !isTestFile(f.path));
  for (const file of frontendFiles) {
    for (const key of KEY_VAR_NAMES) {
      expect(file.content.includes(key), `${key} referenced in frontend file: ${file.path}`).toBe(false);
    }
  }
});

test("provider API key env var names only appear under supabase/functions or docs", () => {
  const allRepoFiles = [
    ...readAllRecursive(srcDir).filter((f) => !isTestFile(f.path)),
    ...readAllRecursive(join(repoRoot, "supabase/functions")),
    ...readAllRecursive(join(repoRoot, "supabase/migrations"), ".sql"),
  ];
  const docsIndex = join(repoRoot, "docs");
  let docsFiles: { path: string; content: string }[] = [];
  try {
    docsFiles = readAllRecursive(docsIndex, ".md");
  } catch {
    docsFiles = [];
  }
  for (const key of KEY_VAR_NAMES) {
    const hits = [...allRepoFiles, ...docsFiles].filter((f) => f.content.includes(key));
    for (const hit of hits) {
      const allowed = hit.path.includes(`${join("supabase", "functions")}`) || hit.path.includes(`${join("docs")}`);
      expect(allowed, `${key} found outside server-side function code/docs: ${hit.path}`).toBe(true);
    }
  }
});

// ---------------------------------------------------------------------------
// "agent prompts are not passed from the frontend"
// ---------------------------------------------------------------------------

test("the request schema has no field that could carry a caller-supplied prompt, model, or template", () => {
  const forbiddenFieldNames = ["systemPrompt", "userPrompt", "promptTemplate", "model:", "sql:"];
  // Only check inside the OrchestratorRequestSchema object definition, not
  // the whole file (which legitimately defines prompt-shaped output schemas
  // elsewhere for agent OUTPUTS, a different and already-validated concern).
  const schemaBlockMatch = aiSchemasSource.match(/OrchestratorRequestSchema = z[\s\S]*?\.strict\(\);/);
  expect(schemaBlockMatch).not.toBeNull();
  const schemaBlock = schemaBlockMatch![0];
  for (const field of forbiddenFieldNames) {
    expect(schemaBlock.includes(field), `request schema unexpectedly allows: ${field}`).toBe(false);
  }
});

test("the frontend client never sends a systemPrompt/model/template field to the orchestrator", () => {
  // Checked as object-key usage ("systemPrompt:"), not bare substring — the
  // file's own comments legitimately name these fields to document their
  // absence, which would otherwise self-trigger a bare-substring check.
  expect(frontendClientSource).not.toMatch(/\bsystemPrompt\s*:/);
  expect(frontendClientSource).not.toMatch(/\bmodel\s*:/);
  expect(frontendClientSource).not.toMatch(/\btemplate\s*:/);
});

test("the frontend client's request body only contains fields the strict request schema accepts", () => {
  const bodyMatch = frontendClientSource.match(/body:\s*\{([\s\S]*?)\r?\n\s*\},\r?\n\s*\}\);/);
  expect(bodyMatch).not.toBeNull();
  const bodyBlock = bodyMatch![1];
  const allowedKeys = ["agent", "entityType", "entityId", "input", "provider", "clientRequestId"];
  const keysUsed = [...bodyBlock.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  expect(keysUsed.length).toBeGreaterThan(0); // sanity: the block was actually matched and has keys
  const unexpected = keysUsed.filter((k) => !allowedKeys.includes(k));
  expect(unexpected).toEqual([]);
});

// ---------------------------------------------------------------------------
// "service-role writes target only AI trace/output tables in this sprint"
// ---------------------------------------------------------------------------

test("every insert/update in ai-orchestrator's index.ts targets only the three AI tables", () => {
  const writeCalls = [...orchestratorIndex.matchAll(/\.from\(\s*["'`]([\w]+)["'`]\s*\)[\s\S]{0,150}?\.(insert|update)\(/g)];
  expect(writeCalls.length).toBeGreaterThan(0); // sanity: the test actually found writes to check
  for (const m of writeCalls) {
    expect(["ai_agent_trace_events", "ai_agent_outputs", "ai_agent_requests"]).toContain(m[1]);
  }
});

test("index.ts's only RPC call is the request-claim function — no other server-side procedure is invoked", () => {
  const rpcCalls = [...orchestratorIndex.matchAll(/\.rpc\(\s*["'`]([\w]+)["'`]/g)].map((m) => m[1]);
  expect(rpcCalls.length).toBeGreaterThan(0);
  for (const name of rpcCalls) {
    expect(name).toBe("claim_ai_agent_request");
  }
});

test("the migration's authenticated grants exclude INSERT/UPDATE/DELETE on both AI tables", () => {
  const migrationsDir = join(repoRoot, "supabase/migrations");
  const migrationFile = readdirSync(migrationsDir).find((f) => f.includes("ai_orchestrator"));
  expect(migrationFile).toBeDefined();
  const sql = readFileSync(join(migrationsDir, migrationFile!), "utf8");
  expect(sql).toMatch(/GRANT SELECT ON public\.ai_agent_trace_events TO authenticated/);
  expect(sql).toMatch(/GRANT SELECT ON public\.ai_agent_outputs TO authenticated/);
  expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL) ON public\.ai_agent_(trace_events|outputs) TO authenticated/);
  expect(sql).toMatch(/REVOKE DELETE ON public\.ai_agent_trace_events FROM authenticated/);
  expect(sql).toMatch(/REVOKE DELETE ON public\.ai_agent_outputs FROM authenticated/);
});

// ---------------------------------------------------------------------------
// Idempotency + trace error-code mapping (contract-level, since the full
// orchestrator flow needs a live DB and cannot run under `bun test`).
// ---------------------------------------------------------------------------

test("the idempotency lookup happens before any provider call in index.ts (source order)", () => {
  const idempotencyIdx = orchestratorIndex.indexOf("ai_agent_outputs_idempotency_key".split("_").slice(0, 3).join("_")); // loose anchor
  const clientRequestIdCheckIdx = orchestratorIndex.indexOf("if (request.clientRequestId)");
  const providerCallIdx = orchestratorIndex.indexOf("generateStructured(config");
  expect(clientRequestIdCheckIdx).toBeGreaterThan(-1);
  expect(providerCallIdx).toBeGreaterThan(-1);
  expect(clientRequestIdCheckIdx).toBeLessThan(providerCallIdx);
});

test("every error path in index.ts uses a code from AI_ERROR_CODES, not an ad-hoc string", () => {
  const codesInSchema = [...aiSchemasSource.matchAll(/"(AI_[A-Z_]+)"/g)].map((m) => m[1]);
  const codesUsedInOrchestrator = new Set([...orchestratorIndex.matchAll(/"(AI_[A-Z_]+)"/g)].map((m) => m[1]));
  for (const code of codesUsedInOrchestrator) {
    expect(codesInSchema, `code used in orchestrator but not declared in AI_ERROR_CODES: ${code}`).toContain(code);
  }
});
