// =============================================================================
// bd_manager reads targets. It must never gain the authority to write them.
//
// The wall board runs on a bd_manager account because every role that could see
// everything it needs was either MFA-required (and a wall is idle by
// definition) or `ceo`, which is the most privileged role in the system. The
// gap was sales_targets, and 20260920100000 widened the READ gate to close it.
//
// The tempting shortcut was to add bd_manager to `is_commercial_manager`
// instead. That function is not about targets: it also gates writing approval
// DECISIONS and updating source_registry. Taking the shortcut would have handed
// bd_manager the power to decide approvals -- which the four-step BAFO chain
// exists specifically to prevent any single role from doing.
//
// These read the migration text rather than the database, because the defect
// they guard is someone editing this file to make a future problem go away.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "@/lib/source-under-test";

const MIGRATIONS = join(import.meta.dir, "..", "..", "supabase", "migrations");
const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));

const TARGETS_MIGRATION = "20260920100000_bd_manager_reads_targets.sql";
const { code: targetsSql } = readSource(join(MIGRATIONS, TARGETS_MIGRATION));

describe("the read gate was widened, and only the read gate", () => {
  it("the migration exists at all", () => {
    expect(all).toContain(TARGETS_MIGRATION);
  });

  it("grants bd_manager on a SELECT policy", () => {
    expect(targetsSql).toMatch(/FOR SELECT TO authenticated/i);
    expect(targetsSql).toMatch(/'bd_manager'/);
  });

  it("touches no write policy on sales_targets", () => {
    // INSERT/UPDATE/DELETE stay behind is_commercial_manager. bd_manager may
    // see a target and may not set, change or remove one.
    for (const cmd of ["FOR INSERT", "FOR UPDATE", "FOR DELETE"]) {
      expect([cmd, targetsSql.toUpperCase().includes(cmd)]).toEqual([cmd, false]);
    }
  });

  it("does not redefine is_commercial_manager", () => {
    // The shortcut this whole migration exists to avoid. That function also
    // gates writing approval decisions and source_registry.
    expect(targetsSql).not.toMatch(/(CREATE|REPLACE)\s+FUNCTION[^;]*is_commercial_manager/i);
  });

  it("touches no table other than sales_targets", () => {
    const tables = [...targetsSql.matchAll(/ON\s+public\.(\w+)/gi)].map((m) => m[1].toLowerCase());
    expect([...new Set(tables)]).toEqual(["sales_targets"]);
  });
});

describe("no later migration quietly hands bd_manager commercial-manager authority", () => {
  it("is_commercial_manager never lists bd_manager", () => {
    // If someone widens the function later, the board's justification for a
    // low-privilege account evaporates and approvals authority moves with it.
    const offenders: string[] = [];
    for (const f of all) {
      const { code } = readSource(join(MIGRATIONS, f));
      const fn = code.match(
        /FUNCTION\s+public\.is_commercial_manager[\s\S]{0,600}?\$\$;/i,
      )?.[0];
      if (fn && /bd_manager/.test(fn)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
