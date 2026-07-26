// Contract test for 20260727120000_drop_redundant_ai_agent_runs_policy.sql —
// corrects a same-day mistake: 20260727100000 added a second, overly
// permissive SELECT policy on ai_agent_runs, not realizing one already
// existed (is_active_user()-gated). Two permissive policies OR together in
// Postgres RLS, so the redundant one silently let suspended/pending users
// read the table too. This migration removes it. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationPath = join(
  repoRoot,
  "supabase/migrations/20260727120000_drop_redundant_ai_agent_runs_policy.sql",
);
const sql = readFileSync(migrationPath, "utf8");

test("drops exactly the redundant policy added by 20260727100000, nothing else", () => {
  const executableLines = sql
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("--"));
  expect(executableLines).toEqual(['DROP POLICY IF EXISTS "AI agent runs readable" ON public.ai_agent_runs;']);
});

test("leaves the pre-existing is_active_user()-gated policy untouched", () => {
  expect(sql).not.toMatch(/DROP POLICY[^\n]*ai_agent_runs_readable/);
  expect(sql).not.toMatch(/CREATE POLICY/);
});
