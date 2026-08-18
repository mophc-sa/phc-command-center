// Phase 1 — Sales IA cleanup + canonical stage + admin governance.
// PRD 2026-08-12: "Existing Pages — Final Decision" and §111–114.
//
// These tests describe the REQUIRED behaviour, not the shape of the code that
// implements it. The one rule learned the hard way on this repo: a contract
// test that pins an implementation literal will eventually block a legitimate
// fix (see phase2-page-consolidation's old `beforeLoad` assertion, which
// guarded a white-screen bug). So: assert what the user gets.
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Source with comments removed. Several assertions below are about what the
 *  code DOES; the files also explain in prose what they used to do, and those
 *  explanations contain the very patterns being banned. */
const readCode = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const APP_SHELL = read("src/components/phc/AppShell.tsx");
const PALETTE = read("src/components/phc/CommandPalette.tsx");

/** Nav entries actually rendered in the sidebar, in order. */
function navPaths(): string[] {
  return [...APP_SHELL.matchAll(/kind: "link",\s*(?:\n\s*)?to: "([^"]+)"/g)].map((m) => m[1]);
}

describe("Sales navigation carries exactly the four PRD destinations", () => {
  test("the Sales group is Inbox, Opportunities, Tenders, Awarded Projects", () => {
    const group = APP_SHELL.slice(
      APP_SHELL.indexOf('key: "navgroup_sales"'),
      APP_SHELL.indexOf('key: "navgroup_crm"'),
    );
    expect(group).toContain('to: "/lead-tender-inbox"');
    expect(group).toContain('to: "/opportunities"');
    expect(group).toContain('to: "/tenders"');
    expect(group).toContain("nav_awarded_projects");

    // Four link entries, no more — the point of the cleanup.
    expect([...group.matchAll(/kind: "link"/g)].length).toBe(4);
  });

  test("Awarded Projects is a filtered view of Opportunities, not its own module", () => {
    const group = APP_SHELL.slice(
      APP_SHELL.indexOf('key: "navgroup_sales"'),
      APP_SHELL.indexOf('key: "navgroup_crm"'),
    );
    const awarded = group.slice(group.indexOf("nav_awarded_projects") - 400, group.indexOf("nav_awarded_projects"));
    expect(awarded).toContain('to: "/opportunities"');
    expect(awarded).toContain('stage: "won"');
    // Not pointed at the retired standalone queue.
    expect(group).not.toContain('to: "/award-queue"');
  });
});

describe("surfaces removed from primary business navigation", () => {
  const REMOVED = ["/quotations", "/follow-ups", "/targets", "/award-queue", "/tender-conversion"];

  test.each(REMOVED)("%s is not a sidebar destination", (path) => {
    expect(navPaths()).not.toContain(path);
  });

  test.each(REMOVED)("%s still exists as a working route", (path) => {
    // Nav membership and route existence are separate concerns. Nothing was
    // deleted; these must keep resolving for bookmarks and deep links.
    const file = path.replace(/^\//, "");
    const candidates = [
      `src/routes/_authenticated/${file}.tsx`,
      `src/routes/_authenticated/${file}.index.tsx`,
    ];
    expect(candidates.some((c) => existsSync(join(root, c)))).toBe(true);
  });

  test.each(REMOVED)("%s stays reachable from the command palette", (path) => {
    expect(PALETTE).toContain(`to: "${path}"`);
  });

  test("AI Configuration and AI Audit live under Admin, out of the business groups", () => {
    const admin = APP_SHELL.slice(APP_SHELL.indexOf('key: "navgroup_admin"'));
    expect(admin).toContain('to: "/ai-agents"');
    expect(admin).toContain('to: "/agent-activity"');
    // Admin is collapsed by default so it does not compete with daily work.
    expect(admin).toContain("collapsible: true");
  });
});

describe("the duplicated intake tab strip is gone", () => {
  test("IntakeHubTabs no longer exists and nothing imports it", () => {
    expect(existsSync(join(root, "src/components/phc/IntakeHubTabs.tsx"))).toBe(false);
    for (const f of [
      "src/routes/_authenticated/lead-tender-inbox.tsx",
      "src/routes/_authenticated/opportunities.index.tsx",
      "src/routes/_authenticated/quotations.tsx",
    ]) {
      expect(read(f)).not.toContain("IntakeHubTabs");
    }
  });

  test("Inbox does not render Opportunities or Quotations as its own tabs", () => {
    const inbox = read("src/routes/_authenticated/lead-tender-inbox.tsx");
    expect(inbox).not.toMatch(/to="\/opportunities"/);
    expect(inbox).not.toMatch(/to="\/quotations"/);
  });
});

describe("canonical stage — every sales and management view agrees", () => {
  // my-workspace joined this list in Phase 1. It was the last surface making a
  // business decision from the legacy column, which is why a verbal award
  // could read one way in My Workspace and another in Command Center.
  const CANONICAL_PAGES = [
    "src/routes/_authenticated/command-center.tsx",
    "src/routes/_authenticated/reports.tsx",
    "src/routes/_authenticated/opportunities.index.tsx",
    "src/routes/_authenticated/my-workspace.tsx",
  ];

  test.each(CANONICAL_PAGES)("%s resolves stage through the canonical resolver", (f) => {
    expect(read(f)).toContain("@/lib/stage-canonical");
  });

  test.each(CANONICAL_PAGES)("%s does not filter business lists on the legacy stage column", (f) => {
    const src = readCode(f);
    // The two shapes that were actually in use, and the reason the views
    // disagreed. Both must be gone; reading the column for the resolver's
    // fallback is still fine.
    expect(src).not.toMatch(/\.eq\(\s*"stage"\s*,/);
    expect(src).not.toMatch(/\.not\(\s*"stage"\s*,\s*"in"/);
    expect(src).not.toMatch(/\.in\(\s*"stage"\s*,/);
  });

  test("my-workspace still fetches the legacy column so the resolver can fall back", () => {
    // Dropping `stage` from the select would make resolveCanonicalStage infer
    // on every legacy row — a refactor that type-checks and silently loses
    // won/lost rows created before sales_stage existed.
    const src = read("src/routes/_authenticated/my-workspace.tsx");
    expect(src).toContain("sales_stage");
    expect(src).toMatch(/stage, sales_stage|sales_stage, stage/);
  });

  test("stage-canonical no longer claims it is unused", () => {
    const src = read("src/lib/stage-canonical.ts");
    expect(src).not.toContain("Nothing in the UI imports this yet");
    expect(src).toContain("my-workspace.tsx");
  });

  test("stage and pipeline_step are retained as deprecated, not deleted", () => {
    // Phase 1 explicitly does not drop them.
    const src = read("src/lib/stage-canonical.ts");
    expect(src.toLowerCase()).toContain("deprecated");
    expect(src).toContain("pipeline_step");
  });
});

describe("system_admin governance is enforced in the database too", () => {
  const MIGRATION = read("supabase/migrations/20260812100000_system_admin_no_commercial_authority.sql");

  test("the BAFO trigger grants system_admin no step", () => {
    // Every role array in the replaced trigger must exclude system_admin.
    const arrays = [...MIGRATION.matchAll(/ARRAY\[([^\]]*)\]::public\.app_role\[\]/g)].map((m) => m[1]);
    expect(arrays.length).toBeGreaterThanOrEqual(4);
    for (const a of arrays) expect(a).not.toContain("system_admin");
  });

  test("can_edit_total_value grants system_admin nothing", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.can_edit_total_value"));
    expect(fn).toContain("finance_manager");
    expect(fn).toContain("bd_manager");
    expect(fn).not.toContain("system_admin'");
  });

  test("the migration is additive — it replaces functions and drops nothing", () => {
    expect(MIGRATION).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|POLICY|TRIGGER)\b/i);
    expect(MIGRATION).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(MIGRATION).not.toMatch(/\bTRUNCATE\b/i);
    expect(MIGRATION).not.toMatch(/\bUPDATE\s+public\./i);
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION");
  });

  test("the ordering guarantee survives the rewrite", () => {
    // Narrowing the role checks must not have loosened the sequence.
    expect(MIGRATION).toContain("Commercial review must be approved before cost approval");
    expect(MIGRATION).toContain("Cost approval must be approved before finance review");
    expect(MIGRATION).toContain("Finance review must be approved before final approval");
    expect(MIGRATION).toContain("Cannot mark a BAFO request as sent to client before it is fully approved");
  });
});

describe("bilingual integrity of the new navigation", () => {
  const I18N = read("src/lib/i18n.tsx");

  test.each([
    "navgroup_home",
    "navgroup_sales",
    "nav_awarded_projects",
    "nav_ai_configuration",
    "nav_ai_audit",
  ])("%s has both an English and an Arabic string", (key) => {
    const entry = I18N.slice(I18N.indexOf(`${key}:`), I18N.indexOf(`${key}:`) + 200);
    expect(entry).toMatch(/en:\s*"[^"]+"/);
    expect(entry).toMatch(/ar:\s*"[^"]+"/);
    // Arabic must actually be Arabic, not an untranslated copy.
    const ar = entry.match(/ar:\s*"([^"]+)"/)?.[1] ?? "";
    expect(ar).toMatch(/[؀-ۿ]/);
  });

  test("every nav key rendered by the shell exists in the dictionary", () => {
    const keys = [...APP_SHELL.matchAll(/key: "(nav(?:group)?_[a-z_]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    for (const k of new Set(keys)) expect(I18N).toContain(`${k}:`);
  });
});
