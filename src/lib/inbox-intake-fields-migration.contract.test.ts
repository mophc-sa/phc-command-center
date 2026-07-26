// Contract test for 20260726110000_inbox_items_intake_fields.sql — static
// SQL inspection (no live DB) for the exact columns/types the Intake form
// (Task 2) depends on. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const migrationPath = join(repoRoot, "supabase/migrations/20260726110000_inbox_items_intake_fields.sql");
const sql = readFileSync(migrationPath, "utf8");

test("defines all 5 new ENUM types with the expected values", () => {
  expect(sql).toMatch(/CREATE TYPE public\.inbox_client_type AS ENUM \('main_client', 'contractor_jih', 'contractor_tender', 'consultant'\)/);
  expect(sql).toMatch(/CREATE TYPE public\.inbox_project_type AS ENUM \('jih', 'tender'\)/);
  expect(sql).toMatch(/CREATE TYPE public\.inbox_rfq_from AS ENUM \('owner_developer', 'main_contractor', 'consultant'\)/);
  expect(sql).toMatch(/CREATE TYPE public\.inbox_scope AS ENUM/);
  expect(sql).toMatch(/CREATE TYPE public\.inbox_location AS ENUM/);
});

test("inbox_scope has exactly the 6 documented options, in order", () => {
  const match = sql.match(/CREATE TYPE public\.inbox_scope AS ENUM \(([\s\S]*?)\);/);
  expect(match).not.toBeNull();
  const values = match![1].split(",").map((v) => v.trim().replace(/'/g, ""));
  expect(values).toEqual([
    "supply_and_installation", "supply_only_signage", "supply_installation_others",
    "supply_only_others", "mockup_sample_request", "installation_only",
  ]);
});

test("inbox_location has exactly the 14 documented Saudi cities, in order", () => {
  const match = sql.match(/CREATE TYPE public\.inbox_location AS ENUM \(([\s\S]*?)\);/);
  expect(match).not.toBeNull();
  const values = match![1].split(",").map((v) => v.trim().replace(/'/g, ""));
  expect(values).toEqual([
    "riyadh", "jeddah", "makkah", "madinah", "dammam", "al_khobar", "dhahran",
    "jubail", "taif", "tabuk", "abha", "yanbu", "jazan", "buraydah", "hail",
  ]);
});

test("all 7 new columns are added to inbox_items, and date_received defaults to today", () => {
  expect(sql).toMatch(/ADD COLUMN client_type public\.inbox_client_type/);
  expect(sql).toMatch(/ADD COLUMN project_type public\.inbox_project_type/);
  expect(sql).toMatch(/ADD COLUMN project_number TEXT/);
  expect(sql).toMatch(/ADD COLUMN rfq_from public\.inbox_rfq_from/);
  expect(sql).toMatch(/ADD COLUMN date_received DATE NOT NULL DEFAULT CURRENT_DATE/);
  expect(sql).toMatch(/ADD COLUMN scope_type public\.inbox_scope/);
  expect(sql).toMatch(/ADD COLUMN location_city public\.inbox_location/);
});

test("does not touch the pre-existing free-text scope/location columns", () => {
  expect(sql).not.toMatch(/ALTER COLUMN scope/);
  expect(sql).not.toMatch(/ALTER COLUMN location\b/);
  expect(sql).not.toMatch(/DROP COLUMN/);
});
