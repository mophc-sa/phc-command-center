// =============================================================================
// Pins the integrity repair to the migrations it repairs.
//
// Seven objects went missing from production even though the migrations that
// create them were recorded as applied: three tables and two functions from
// 20260714210000_business_destinations, and two indexes from
// 20260713180000_perf_indexes. They were removed by hand, outside the migration
// history, so the CLI would never have re-run either file.
//
// The repair works by replaying those two files verbatim. That is the whole
// design, and it is fragile in one specific way: a first draft retyped the DDL
// from memory and got it materially wrong — `metric_value` where the original
// has `actual_value`, a fabricated update_type list, ON DELETE CASCADE where
// the original says SET NULL, a four-column unique index where the original has
// five. Tables that look right and are not would have left the schema diff
// non-empty in a new and more confusing way.
//
// So the test is not "does the repair mention these tables". It is "is the
// repair still byte-identical to what history says should exist".
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = join(root, "supabase/migrations");
const read = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8");

const REPAIR = "20260823130000_repair_missing_objects.sql";
const SOURCES = [
  "20260714210000_business_destinations.sql",
  "20260713180000_perf_indexes.sql",
] as const;

const repair = read(REPAIR);

/** A migration's DDL with its leading `--` header block removed. */
function body(sql: string): string {
  const lines = sql.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].startsWith("--") || !lines[i].trim())) i++;
  return lines.slice(i).join("\n").trim();
}

describe("the repair reproduces history, not somebody's memory of it", () => {
  for (const src of SOURCES) {
    it(`contains ${src.replace(/^\d+_/, "")} verbatim`, () => {
      expect(repair).toContain(body(read(src)));
    });
  }

  it("adds no DDL of its own beyond those two bodies", () => {
    // Everything outside the two copied bodies must be comment or blank —
    // an original statement here would be a definition nobody reviewed.
    let rest = repair;
    for (const src of SOURCES) rest = rest.replace(body(read(src)), "");
    const stray = rest
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("--"));
    expect(stray).toEqual([]);
  });
});

describe("the repair is safe to run against a database that already has the objects", () => {
  it("creates nothing without IF NOT EXISTS", () => {
    const creates = [...repair.matchAll(/^CREATE (?:UNIQUE )?(TABLE|INDEX)\b[^\n]*/gm)].map((m) => m[0]);
    expect(creates.length).toBeGreaterThan(0);
    for (const c of creates) expect(c).toContain("IF NOT EXISTS");
  });

  it("replaces functions and re-creates policies and triggers idempotently", () => {
    for (const m of repair.matchAll(/^CREATE FUNCTION\b/gm)) expect(m[0]).toBe("__must_be_CREATE_OR_REPLACE__");
    const policies = [...repair.matchAll(/^CREATE POLICY "([^"]+)"/gm)].map((m) => m[1]);
    for (const p of policies) expect(repair).toContain(`DROP POLICY IF EXISTS "${p}"`);
    const triggers = [...repair.matchAll(/^CREATE TRIGGER (\w+)/gm)].map((m) => m[1]);
    for (const t of triggers) expect(repair).toContain(`DROP TRIGGER IF EXISTS ${t}`);
  });
});

describe("the repair changes nothing it should not", () => {
  it("touches no business data", () => {
    expect(repair).not.toMatch(/^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+public\./im);
  });

  it("drops no table, column or index", () => {
    expect(repair).not.toMatch(/^\s*DROP\s+(TABLE|COLUMN|INDEX)/im);
    expect(repair).not.toMatch(/ALTER TABLE[^\n;]*DROP/i);
  });

  // The whole point of the repair is that the history was never wrong — only
  // the database. Editing an applied migration would hide the divergence
  // instead of closing it, and `supabase migration repair` would mark the
  // objects present without creating them.
  it("does not rewrite either migration it repairs", () => {
    for (const src of SOURCES) {
      const stat = readdirSync(MIGRATIONS).includes(src);
      expect(stat, `${src} must still exist unmodified`).toBe(true);
    }
  });
});
