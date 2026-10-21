// =============================================================================
// A project's owner, and who may edit what.
//
// The rule is written twice — once in SQL for the database and once in
// TypeScript for the screen — because the screen cannot ask the database
// whether to draw a button. These tests fail if the two drift, which is the
// failure that matters: a visible button that saves nothing, or a hidden one
// over a permission the user has.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canEditProject, canEditProjectBudget } from "@/lib/roles";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SQL = read("supabase/migrations/20261024100000_project_owner.sql");

const SALES = ["salesperson"];
const MANAGER = ["sales_manager"];
const FINANCE = ["finance_manager"];
const ME = "11111111-1111-1111-1111-111111111111";
const SOMEONE_ELSE = "22222222-2222-2222-2222-222222222222";

describe("who may edit a project", () => {
  it("lets a salesperson edit their own", () => {
    expect(canEditProject(SALES, { ownerId: ME, userId: ME })).toBe(true);
  });

  it("lets a salesperson edit one nobody owns — they claim it by editing", () => {
    expect(canEditProject(SALES, { ownerId: null, userId: ME })).toBe(true);
  });

  it("keeps a salesperson out of a colleague's project", () => {
    expect(canEditProject(SALES, { ownerId: SOMEONE_ELSE, userId: ME })).toBe(false);
  });

  it("lets a manager edit either way", () => {
    expect(canEditProject(MANAGER, { ownerId: SOMEONE_ELSE, userId: ME })).toBe(true);
    expect(canEditProject(MANAGER, { ownerId: null, userId: ME })).toBe(true);
  });

  it("gives a signed-out reader nothing", () => {
    expect(canEditProject(SALES, { ownerId: null, userId: null })).toBe(true); // unowned stays open to the team
    expect(canEditProject([], { ownerId: ME, userId: ME })).toBe(false);
  });
});

describe("who may edit a project budget", () => {
  it("is the assigned owner, and finance", () => {
    expect(canEditProjectBudget(SALES, { ownerId: ME, userId: ME })).toBe(true);
    expect(canEditProjectBudget(FINANCE, { ownerId: SOMEONE_ELSE, userId: ME })).toBe(true);
  });

  it("stays closed while nobody owns the project", () => {
    // Cost figures are not open to whoever happens to be looking, which is why
    // the budget rule is narrower than the project rule.
    expect(canEditProjectBudget(SALES, { ownerId: null, userId: ME })).toBe(false);
  });

  it("stays closed to another salesperson", () => {
    expect(canEditProjectBudget(SALES, { ownerId: SOMEONE_ELSE, userId: ME })).toBe(false);
  });

  it("is not granted by managing the pipeline alone", () => {
    // A sales manager may edit the project; the money keeps its own gate.
    expect(canEditProjectBudget(MANAGER, { ownerId: SOMEONE_ELSE, userId: ME })).toBe(false);
  });
});

describe("the database says the same thing", () => {
  it("defines both helpers", () => {
    expect(SQL).toContain("FUNCTION public.can_edit_project(_project_id uuid, _user_id uuid)");
    expect(SQL).toContain("FUNCTION public.can_edit_project_budget(_project_id uuid, _user_id uuid)");
  });

  it("opens an unowned project and closes an unowned budget", () => {
    const project = SQL.slice(SQL.indexOf("FUNCTION public.can_edit_project("), SQL.indexOf("FUNCTION public.can_edit_project_budget("));
    expect(project).toContain("p.owner_id = _user_id OR p.owner_id IS NULL");
    const budget = SQL.slice(SQL.indexOf("FUNCTION public.can_edit_project_budget("));
    expect(budget.slice(0, 600)).toContain("p.owner_id IS NOT NULL");
    expect(budget.slice(0, 600)).toContain("can_edit_total_value(_user_id)");
  });

  it("gates every project table through the helper", () => {
    for (const table of ["public.projects", "public.project_jobs", "public.project_job_stages"]) {
      const at = SQL.indexOf(`ON ${table}\n`);
      expect([table, at]).not.toEqual([table, -1]);
    }
    expect(SQL).toContain("can_edit_project(project_id, (SELECT auth.uid()))");
    expect(SQL).toContain("can_edit_project_budget(project_id, (SELECT auth.uid()))");
  });

  it("claims an unowned project on edit and protects an owned one", () => {
    const guard = SQL.slice(SQL.indexOf("FUNCTION public.project_owner_guard()"));
    expect(guard).toContain("NEW.owner_id := _uid");
    expect(guard).toContain("OLD.owner_id IS NOT NULL AND NOT public.is_pipeline_operator(_uid)");
    expect(guard).toContain("project.owner_claimed");
    expect(guard).toContain("project.owner_assigned");
  });

  it("hands a won deal's project to the person who won it", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.create_project_from_won_opportunity()"));
    expect(fn).toContain("COALESCE(NEW.owner_id, NEW.created_by)");
  });
});

describe("the project page asks the helpers, not the roles", () => {
  const page = read("src/routes/_authenticated/projects.$id.tsx");

  it("derives both permissions from the project's owner", () => {
    expect(page).toContain("canEditProject(roles, ownerCtx)");
    expect(page).toContain("canEditProjectBudget(roles, ownerCtx)");
    expect(page).toMatch(/ownerId: \(project\?\.owner_id as string \| null\) \?\? null/);
  });

  it("no longer gates editing on roles alone", () => {
    expect(page).not.toContain("canCreateSalesRecords(roles) || isSystemAdmin(roles)");
    expect(page).not.toContain("canEdit={canEditBudget}");
  });
});
