// Contract test for Phase 4's frontend wiring (opportunity-actions.ts's new
// milestone/technical-notes functions, and their use in the opportunity
// detail page) — static source inspection. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function read(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), "utf8");
}

test("OPPORTUNITY_MILESTONES lists the same 7 values, in the same order, as the migration's ENUM", () => {
  const actionsSource = read("src/lib/opportunity-actions.ts");
  const migrationSource = read("supabase/migrations/20260726130000_opportunity_milestone_checklist.sql");

  const arrayMatch = actionsSource.match(/export const OPPORTUNITY_MILESTONES: OpportunityMilestone\[\] = \[([\s\S]*?)\];/);
  expect(arrayMatch).not.toBeNull();
  const fromActions = arrayMatch![1].split(",").map((v) => v.trim().replace(/"/g, "")).filter(Boolean);

  const enumMatch = migrationSource.match(/CREATE TYPE public\.opportunity_milestone AS ENUM \(([\s\S]*?)\);/);
  expect(enumMatch).not.toBeNull();
  const fromMigration = enumMatch![1].split(",").map((v) => v.trim().replace(/'/g, ""));

  expect(fromActions).toEqual(fromMigration);
});

test("setOpportunityMilestone upserts on (opportunity_id, milestone), clearing completed_by when unchecked", () => {
  const source = read("src/lib/opportunity-actions.ts");
  const fnStart = source.indexOf("export async function setOpportunityMilestone");
  const fnEnd = source.indexOf("export async function updateOpportunityTechnicalNotes");
  const fn = source.slice(fnStart, fnEnd);
  expect(fn).toMatch(/onConflict: "opportunity_id,milestone"/);
  expect(fn).toMatch(/completed_at: input\.completed \? new Date\(\)\.toISOString\(\) : null/);
  expect(fn).toMatch(/completed_by: input\.completed \? uid : null/);
});

test("updateOpportunityTechnicalNotes writes to opportunities.technical_notes, not a new table", () => {
  const source = read("src/lib/opportunity-actions.ts");
  const fnStart = source.indexOf("export async function updateOpportunityTechnicalNotes");
  const fn = source.slice(fnStart);
  expect(fn).toMatch(/\.from\("opportunities"\)/);
  expect(fn).toMatch(/\.update\(\{ technical_notes: notes \|\| null \}\)/);
});

test("the opportunity detail page renders one checkbox per OPPORTUNITY_MILESTONES entry and a technical notes textarea", () => {
  const source = read("src/routes/_authenticated/opportunities.$id.tsx");
  expect(source).toMatch(/OPPORTUNITY_MILESTONES\.map\(\(m\) =>/);
  expect(source).toMatch(/type="checkbox"/);
  expect(source).toMatch(/onChange=\{\(e\) => toggleMilestone\(m, e\.target\.checked\)\}/);
  expect(source).toMatch(/onBlur=\{saveTechnicalNotes\}/);
});

test("the milestone checklist panel is a separate Panel from Evidence, not merged into evidence_sources rendering", () => {
  const source = read("src/routes/_authenticated/opportunities.$id.tsx");
  const checklistIdx = source.indexOf("section_milestone_checklist");
  const evidenceIdx = source.indexOf('title={t("section_evidence")}');
  expect(checklistIdx).toBeGreaterThan(-1);
  expect(evidenceIdx).toBeGreaterThan(-1);
  expect(checklistIdx).toBeLessThan(evidenceIdx);
});
