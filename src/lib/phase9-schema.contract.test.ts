// =============================================================================
// Phase 9 invariants.
//
// Most of this phase's surface already existed — activities, follow_ups,
// tasks, account_interactions. The two things that matter here are that the
// migration did NOT rebuild any of it, and that the one new table treats a
// promise as a record rather than an editable field.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = join(root, "supabase/migrations");
const FILE = "20260831100000_phase9_commitments_and_next_action.sql";
const sql = readFileSync(join(MIGRATIONS, FILE), "utf8");

const code = (s: string) =>
  s.replace(/COMMENT ON [\s\S]*?';/g, "")
   .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("nothing that already worked was rebuilt", () => {
  it("creates exactly one table", () => {
    const created = [...code(sql).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(["commitments"]);
  });

  it("alters none of the existing activity tables", () => {
    const altered = [...code(sql).matchAll(/ALTER TABLE public\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(altered)]).toEqual(["commitments"]);
  });

  it("adds no policy to a table it does not own", () => {
    const policied = [...code(sql).matchAll(/ON public\.(\w+)\s+FOR (?:SELECT|INSERT|UPDATE|DELETE)/g)].map((m) => m[1]);
    expect([...new Set(policied)]).toEqual(["commitments"]);
  });

  it("writes no business data", () => {
    expect(code(sql)).not.toMatch(/^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+public\./im);
  });
});

describe("a promise is a record, not a field", () => {
  it("its terms cannot be edited once made", () => {
    const guard = sql.match(/FUNCTION public\.commitment_guard[\s\S]*?\$\$;/)?.[0] ?? "";
    for (const col of ["description", "direction", "due_date", "opportunity_id"]) {
      expect(guard, `${col} must be immutable`).toMatch(new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}`));
    }
  });

  it("direction is modelled, not inferred from wording", () => {
    expect(sql).toMatch(/CREATE TYPE public\.commitment_direction AS ENUM \('we_owe_client', 'client_owes_us'\)/);
  });

  it("a close is always stamped and never reopened", () => {
    expect(sql).toMatch(/cm_closed_is_stamped/);
    const guard = sql.match(/FUNCTION public\.commitment_guard[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(guard).toMatch(/closed commitment cannot be reopened/i);
    expect(guard).toMatch(/NEW\.closed_by := coalesce\(NEW\.closed_by, _uid\)/);
  });

  it("waiving needs a reason", () => {
    expect(sql).toMatch(/cm_waived_has_reason/);
  });

  it("nothing is deleted", () => {
    expect(code(sql)).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
    expect(sql).toContain("commitments_no_delete");
  });
});

describe("access reuses the deal's existing boundary", () => {
  it("every commitment policy is scoped by can_read_boq", () => {
    const policies = code(sql).split("CREATE POLICY").slice(1);
    expect(policies.length).toBe(3);
    for (const p of policies) expect(p).toContain("can_read_boq(opportunity_id");
  });

  it("no new access helper is invented", () => {
    expect(code(sql)).not.toMatch(/CREATE OR REPLACE FUNCTION public\.can_/);
  });

  it("never widened to helpers that admit viewer or system_admin", () => {
    for (const bad of ["can_view_all_sales_data", "is_platform_admin", "is_active_user"]) {
      expect(code(sql)).not.toContain(bad);
    }
  });
});

describe("the views are gated and carry nothing they should not", () => {
  it("each view gates itself rather than trusting the caller", () => {
    for (const v of ["opportunity_next_action", "communication_log", "overdue_commitments"]) {
      const def = sql.match(new RegExp(`CREATE OR REPLACE VIEW public\\.${v}[\\s\\S]*?;\\n`))?.[0] ?? "";
      expect(def.length, `${v} not found`).toBeGreaterThan(0);
      expect(def, `${v} must gate itself`).toMatch(/can_read_boq|is_sales_contributor/);
    }
  });

  // activities is currently readable by every active user. The log must not
  // inherit that — it is deliberately narrower than the table beneath it.
  it("the communication log does not inherit the blanket read on activities", () => {
    const v = sql.match(/CREATE OR REPLACE VIEW public\.communication_log[\s\S]*?;\n/)?.[0] ?? "";
    expect(v).toContain("can_read_boq(a.related_opportunity_id");
    expect(v).not.toMatch(/WHERE\s+public\.is_active_user/);
  });

  it("unsent drafts stay out of the contact history", () => {
    const v = sql.match(/CREATE OR REPLACE VIEW public\.communication_log[\s\S]*?;\n/)?.[0] ?? "";
    expect(v).not.toContain("draft_content");
  });

  it("next action returns one row per opportunity, deterministically", () => {
    const v = sql.match(/CREATE OR REPLACE VIEW public\.opportunity_next_action[\s\S]*?;\n/)?.[0] ?? "";
    expect(v).toContain("DISTINCT ON (d.opportunity_id)");
    // Without a tiebreaker beyond due_date the row could change between reads.
    expect(v).toMatch(/ORDER BY d\.opportunity_id, d\.due_date ASC, d\.source/);
  });

  it("next action reads all three sources of a due date", () => {
    const v = sql.match(/CREATE OR REPLACE VIEW public\.opportunity_next_action[\s\S]*?;\n/)?.[0] ?? "";
    for (const t of ["follow_ups", "tasks", "commitments"]) expect(v).toContain(t);
  });
});

describe("the migration is shaped for a safe apply", () => {
  it("says LOCAL ONLY and sorts after Phase 8", () => {
    expect(sql).toContain("LOCAL ONLY");
    expect(FILE > "20260830100000_phase8_margin_integrity.sql").toBe(true);
    expect(readdirSync(MIGRATIONS).filter((f) => /_phase9_/.test(f))).toEqual([FILE]);
  });

  it("drops nothing", () => {
    expect(code(sql)).not.toMatch(/DROP (TABLE|COLUMN|TYPE)\b/i);
  });
});
