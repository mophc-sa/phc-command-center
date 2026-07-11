// Contract tests for the service-key-resolver migration: static source
// inspection guarding invariants that a pure unit test can't express — which
// files are allowed to import the privileged resolver, and that unrelated
// configuration (verify_jwt, business-write targets) was left untouched.
// Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const srcDir = join(repoRoot, "src");

function readAllRecursive(dir: string, suffix = ".ts"): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...readAllRecursive(full, suffix));
    } else if (entry.name.endsWith(suffix) && !entry.name.endsWith(".test.ts")) {
      out.push({ path: full, content: readFileSync(full, "utf8") });
    }
  }
  return out;
}

// Client-shipped files: anything NOT ending in .server.ts and not itself a
// server-only module (routes/*.functions.ts also ship server code but are
// out of scope here — the resolver is only wired into client.server.ts).
const allSrcFiles = readAllRecursive(srcDir);
const browserShippedFiles = allSrcFiles.filter((f) => !f.path.endsWith(".server.ts"));

test("no browser-shipped src/ file imports the privileged service-key resolver", () => {
  const offenders = browserShippedFiles.filter((f) => f.content.includes("service-key-resolver"));
  expect(offenders.map((f) => f.path)).toEqual([]);
});

test("the privileged resolver is imported only by the SSR admin client (client.server.ts), not the browser client", () => {
  const clientTs = readFileSync(join(srcDir, "integrations/supabase/client.ts"), "utf8");
  const authMiddleware = readFileSync(join(srcDir, "integrations/supabase/auth-middleware.ts"), "utf8");
  const clientServerTs = readFileSync(join(srcDir, "integrations/supabase/client.server.ts"), "utf8");
  expect(clientTs).not.toContain("service-key-resolver");
  expect(authMiddleware).not.toContain("service-key-resolver");
  expect(clientServerTs).toContain("service-key-resolver");
});

test("client.ts (browser) and auth-middleware.ts (user-session JWT validation) still use only the publishable key, never a resolved service key", () => {
  const clientTs = readFileSync(join(srcDir, "integrations/supabase/client.ts"), "utf8");
  const authMiddleware = readFileSync(join(srcDir, "integrations/supabase/auth-middleware.ts"), "utf8");
  expect(clientTs).not.toMatch(/SUPABASE_SECRET_KEYS|SUPABASE_SERVICE_ROLE_KEY/);
  expect(authMiddleware).not.toMatch(/SUPABASE_SECRET_KEYS|SUPABASE_SERVICE_ROLE_KEY/);
});

test("supabase/config.toml's verify_jwt setting is unchanged by this migration", () => {
  const configToml = readFileSync(join(repoRoot, "supabase/config.toml"), "utf8");
  expect(configToml).toMatch(/\[functions\.sales-os-api\]\s*\nverify_jwt = true/);
  // Neither ai-orchestrator nor import-pipeline gained an explicit
  // verify_jwt override as part of this change (both still rely on the
  // CLI's default, exactly as before).
  expect(configToml).not.toMatch(/\[functions\.ai-orchestrator\]/);
  expect(configToml).not.toMatch(/\[functions\.import-pipeline\]/);
});

test("service-key-resolver.ts introduces no new business-table write target — it has zero .from(...) calls", () => {
  const resolverSource = readFileSync(
    join(repoRoot, "supabase/functions/_shared/service-key-resolver.ts"),
    "utf8",
  );
  expect(resolverSource).not.toMatch(/\.from\(/);
  expect(resolverSource).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
});

test("the resolver never logs the SUPABASE_SECRET_KEYS raw value or a resolved key — no console.* call references either", () => {
  const resolverSource = readFileSync(
    join(repoRoot, "supabase/functions/_shared/service-key-resolver.ts"),
    "utf8",
  );
  expect(resolverSource).not.toMatch(/console\./);
});
