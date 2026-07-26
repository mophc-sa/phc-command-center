// Contract test for 20260726120000_contacts_confidence_level.sql — static
// SQL inspection of the ENUM definition and the exact backfill boundaries
// Task 4's form depends on. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationPath = join(repoRoot, "supabase/migrations/20260726120000_contacts_confidence_level.sql");
const sql = readFileSync(migrationPath, "utf8");

test("defines contact_confidence_level as high/medium/low", () => {
  expect(sql).toMatch(/CREATE TYPE public\.contact_confidence_level AS ENUM \('high', 'medium', 'low'\)/);
});

test("adds a nullable confidence_level column without dropping confidence_score", () => {
  expect(sql).toMatch(/ADD COLUMN confidence_level public\.contact_confidence_level/);
  expect(sql).not.toMatch(/DROP COLUMN confidence_score/);
});

test("backfill CASE uses 70/40 boundaries and preserves NULL for NULL scores", () => {
  expect(sql).toMatch(/WHEN confidence_score >= 70 THEN 'high'/);
  expect(sql).toMatch(/WHEN confidence_score >= 40 THEN 'medium'/);
  expect(sql).toMatch(/WHEN confidence_score IS NOT NULL THEN 'low'/);
  expect(sql).toMatch(/ELSE NULL/);
});
