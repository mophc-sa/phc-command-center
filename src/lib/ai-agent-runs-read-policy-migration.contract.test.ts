// Contract test for 20260727100000_ai_agent_runs_read_policy.sql — confirms
// the missing SELECT policy that caused the Agent Activity widget/page to
// always read zero rows (RLS enabled + table-level GRANT but no row policy
// denies everything to `authenticated`) is now present, matching the
// legacy public.agent_runs table's own permissive read policy.
// Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationPath = join(repoRoot, "supabase/migrations/20260727100000_ai_agent_runs_read_policy.sql");
const sql = readFileSync(migrationPath, "utf8");

test("grants SELECT on ai_agent_runs to any authenticated user", () => {
  expect(sql).toMatch(/CREATE POLICY "AI agent runs readable" ON public\.ai_agent_runs/);
  expect(sql).toMatch(/FOR SELECT TO authenticated USING \(true\)/);
});

test("no application code still queries the dead legacy agent_runs table", () => {
  const filesToCheck = [
    "src/routes/_authenticated/command-center.tsx",
    "src/routes/_authenticated/agent-activity.tsx",
    "src/lib/mcp/tools/recent-agent-runs.ts",
  ];
  for (const rel of filesToCheck) {
    const src = readFileSync(join(repoRoot, rel), "utf8");
    expect(src).not.toMatch(/from\(["']agent_runs["']\)/);
    expect(src).toMatch(/from\(["']ai_agent_runs["']\)/);
  }
});
