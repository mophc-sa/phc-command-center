// =============================================================================
// Guard against the drift that killed the automation engine for a fortnight.
//
// WHAT HAPPENED
// Migration 20260806140000 added rule 12 to run_sales_automations, inserting
// opportunity_flags with queue_action_type = 'submission_pending_on'. No
// migration ever added that value to the enum. The column and index in the same
// migration applied cleanly, so nothing looked wrong — the value is only
// resolved when the rule's INSERT actually executes.
//
// From 2026-08-07 every nightly cron run aborted there. Because the function is
// one transaction, rules 1–11 rolled back with it, so the Sales Action Queue
// raised nothing at all for fourteen days. The queue looked calm; it was dead.
//
// WHAT THIS TEST DOES
// Reads the enum as the migrations actually define it (CREATE TYPE plus every
// ALTER TYPE ... ADD VALUE), then checks that:
//   1. every queue_action_type literal the SQL rules insert exists in it,
//   2. the hand-maintained TypeScript list matches it,
//   3. the generated types match it.
//
// (1) is the one that matters — it is a static check for a runtime-only failure.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { QUEUE_ACTION_TYPES } from "@/lib/workflow-actions";

const MIGRATIONS = join(import.meta.dir, "../../supabase/migrations");

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

const SQL = migrationSql();

/** The enum as the migrations build it: the CREATE, plus every ADD VALUE. */
function enumFromMigrations(): Set<string> {
  const values = new Set<string>();

  const created = SQL.match(/CREATE\s+TYPE\s+(?:public\.)?queue_action_type\s+AS\s+ENUM\s*\(([^)]*)\)/i);
  if (created) {
    for (const m of created[1].matchAll(/'([^']+)'/g)) values.add(m[1]);
  }

  for (const m of SQL.matchAll(
    /ALTER\s+TYPE\s+(?:public\.)?queue_action_type\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi,
  )) {
    values.add(m[1]);
  }

  return values;
}

/** Split on commas that are not inside quotes, parentheses, or a CASE. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === "'") inStr = s[i + 1] === "'"; // '' is an escaped quote
      continue;
    }
    if (c === "'") { inStr = true; cur += c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Every queue_action_type value the rules engine actually inserts.
 *
 * Read positionally rather than by guessing at literal names: find
 * queue_action_type's index in the INSERT's column list, then take the
 * expression at that same index in the SELECT. A guess-based version of this
 * test mistook condition_key values like 'missing_next_action' for action
 * types — which would have made the test noisy and, eventually, ignored.
 */
function literalsUsedByRules(): Set<string> {
  const used = new Set<string>();

  for (const fn of SQL.matchAll(
    /CREATE OR REPLACE FUNCTION public\.run_sales_automations[\s\S]*?END \$\$;/g,
  )) {
    for (const stmt of fn[0].matchAll(
      /INSERT INTO public\.opportunity_flags\s*\(([\s\S]*?)\)\s*SELECT([\s\S]*?)\n\s*FROM /g,
    )) {
      const cols = splitTopLevel(stmt[1]).map((c) => c.trim());
      const idx = cols.indexOf("queue_action_type");
      if (idx === -1) continue;

      // Strip comment lines so they cannot shift the positional count.
      const selectBody = stmt[2]
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");

      const exprs = splitTopLevel(selectBody);
      const expr = exprs[idx];
      if (!expr) continue;

      const literal = expr.match(/^'([a-z_]+)'$/);
      if (literal) used.add(literal[1]);
    }
  }
  return used;
}

describe("queue_action_type stays in sync", () => {
  const fromMigrations = enumFromMigrations();

  it("the migrations define the enum at all", () => {
    expect(fromMigrations.size).toBeGreaterThan(5);
  });

  // THE REGRESSION TEST. This is the check that was missing.
  it("every value the SQL rules insert exists in the enum", () => {
    const used = literalsUsedByRules();
    expect(used.size).toBeGreaterThan(0);

    const missing = [...used].filter((v) => !fromMigrations.has(v));
    expect(missing).toEqual([]);
  });

  it("includes submission_pending_on, the value that was forgotten", () => {
    expect(fromMigrations.has("submission_pending_on")).toBe(true);
  });

  it("the hand-maintained TypeScript list matches the migrations exactly", () => {
    expect([...QUEUE_ACTION_TYPES].sort()).toEqual([...fromMigrations].sort());
  });

  it("the generated Database enum matches too", () => {
    const types = readFileSync(join(import.meta.dir, "../integrations/supabase/types.ts"), "utf8");
    const block = types.match(/\n {6}queue_action_type:\n((?: {8}\| "[a-z_]+"\n)+)/);
    expect(block).not.toBeNull();
    const generated = [...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(generated.sort()).toEqual([...fromMigrations].sort());
  });
});

describe("the automation engine's contract", () => {
  it("run_sales_automations still emits overdue notifications", () => {
    expect(SQL).toContain("_notified := public.notify_overdue_items();");
  });

  it("the notifier is bounded, so a repaired engine does not blast the backlog", () => {
    expect(SQL).toMatch(/_lookback\s+INTEGER\s*:=\s*\d+;/);
    expect(SQL).toContain("f.due_date >= CURRENT_DATE - _lookback");
  });

  it("the run log records how many notifications went out", () => {
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS notified INT");
    expect(SQL).toContain("notified = _notified");
  });

  // A second scheduler would give the nightly run and the Action Center button
  // different behaviour — the thing 20260806120000 set out to prevent.
  it("adds no second scheduler", () => {
    const overdueMigration = readFileSync(
      join(MIGRATIONS, "20260819110000_phase_4_overdue_automation.sql"),
      "utf8",
    );
    expect(overdueMigration).not.toMatch(/cron\.schedule/);
  });

  it("rule 12 casts its CASE result to priority_tier", () => {
    // The CASE yields text; the column is priority_tier. Without the cast the
    // rule fails even once the enum value exists — the second half of the same
    // never-executed rule.
    expect(SQL).toContain("END)::public.priority_tier");
  });
});
