// Contract test for 20260726130000_opportunity_milestone_checklist.sql —
// static SQL inspection of the 7-item enum, table shape, and RLS pattern
// Phase 4's frontend depends on. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationPath = join(repoRoot, "supabase/migrations/20260726130000_opportunity_milestone_checklist.sql");
const sql = readFileSync(migrationPath, "utf8");

test("defines the 7 documented milestones, in order", () => {
  const match = sql.match(/CREATE TYPE public\.opportunity_milestone AS ENUM \(([\s\S]*?)\);/);
  expect(match).not.toBeNull();
  const values = match![1].split(",").map((v) => v.trim().replace(/'/g, ""));
  expect(values).toEqual([
    "rfq_received", "quotation_sent", "meeting_with_management",
    "bafo_request", "discount_sent", "final_negotiation", "received_contract",
  ]);
});

test("opportunity_milestones has a unique (opportunity_id, milestone) constraint, so a milestone can't be duplicated per opportunity", () => {
  expect(sql).toMatch(/UNIQUE \(opportunity_id, milestone\)/);
});

test("opportunity_milestones cascades on opportunity delete", () => {
  expect(sql).toMatch(/REFERENCES public\.opportunities\(id\) ON DELETE CASCADE/);
});

test("RLS uses a single FOR ALL policy for write access (not separate insert/update/delete), matching the established merged-policy convention", () => {
  expect(sql).toMatch(/CREATE POLICY "Opportunity milestones editable by sales team or pipeline operator"\s*\n\s*ON public\.opportunity_milestones FOR ALL TO authenticated/);
  expect(sql).not.toMatch(/FOR INSERT TO authenticated/);
  expect(sql).not.toMatch(/FOR UPDATE TO authenticated/);
  expect(sql).not.toMatch(/FOR DELETE TO authenticated/);
});

test("write policy checks is_pipeline_operator or the sales-team role set, same as stakeholders/evidence_sources", () => {
  expect(sql).toMatch(/is_pipeline_operator\(\(select auth\.uid\(\)\)\)/);
  expect(sql).toMatch(/ARRAY\['salesperson'::app_role, 'bd_manager'::app_role,\s*\n\s*'sales_manager'::app_role, 'ceo'::app_role\]/);
});

test("adds opportunities.technical_notes as a nullable column, not required", () => {
  expect(sql).toMatch(/ADD COLUMN technical_notes TEXT;/);
  expect(sql).not.toMatch(/technical_notes TEXT NOT NULL/);
});
