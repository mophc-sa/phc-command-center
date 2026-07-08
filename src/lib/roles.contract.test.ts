// Contract test: the canonical AppRole list must stay identical across the app
// layer, the Edge Function layer, and the database enum. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_ROLES as APP_ROLES } from "./roles";
import { ALL_ROLES as EDGE_ROLES } from "../../supabase/functions/_shared/roles";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../supabase/migrations");

// Derive the set of app_role enum values from the migration SQL. Combines the
// original CREATE TYPE ... ENUM(...) plus every ALTER TYPE ... ADD VALUE.
function dbRolesFromMigrations(): Set<string> {
  const roles = new Set<string>();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    const createMatch = sql.match(
      /CREATE TYPE public\.app_role AS ENUM\s*\(([^)]*)\)/i,
    );
    if (createMatch) {
      for (const m of createMatch[1].matchAll(/'([^']+)'/g)) roles.add(m[1]);
    }
    for (const m of sql.matchAll(
      /ALTER TYPE public\.app_role ADD VALUE(?: IF NOT EXISTS)?\s+'([^']+)'/gi,
    )) {
      roles.add(m[1]);
    }
  }
  return roles;
}

test("app and edge canonical role lists are identical (order + members)", () => {
  expect(EDGE_ROLES).toEqual(APP_ROLES);
});

test("app role list has no duplicates", () => {
  expect(new Set(APP_ROLES).size).toBe(APP_ROLES.length);
});

test("every app role exists in the database app_role enum", () => {
  const dbRoles = dbRolesFromMigrations();
  const missing = APP_ROLES.filter((r) => !dbRoles.has(r));
  expect(missing, `roles missing from DB enum: ${missing.join(", ")}`).toEqual([]);
});

test("database app_role enum has no values unknown to the app", () => {
  const dbRoles = [...dbRolesFromMigrations()];
  const unknown = dbRoles.filter((r) => !APP_ROLES.includes(r as never));
  expect(unknown, `DB enum values unknown to app: ${unknown.join(", ")}`).toEqual([]);
});
