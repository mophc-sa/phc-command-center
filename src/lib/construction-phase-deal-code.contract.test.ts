// =============================================================================
// Site stage from intake to home page, and a code for every deal (20261026100000).
//
// The database behaviour is pinned in
// supabase/tests/construction_phase_and_deal_code.test.sql. These pin the wiring
// a pgTAP test cannot see: that the form asks, conversion carries, updates send
// and the screens show.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const fnBody = (src: string, signature: string) => {
  const fn = src.slice(src.indexOf(signature));
  return fn.slice(0, fn.indexOf("\n}\n"));
};
const MIGRATION = read("supabase/migrations/20261026100000_construction_phase_and_deal_code.sql");

describe("the site stage travels from intake to the home page", () => {
  it("the intake form asks it, in the project section, and sends it", () => {
    const dialog = read("src/components/phc/NewIntakeDialog.tsx");
    expect(dialog).toContain('{ key: "projectStage", type: "select"');
    expect(dialog).toMatch(/"locationOther", "projectStage", "completionPct"/);
    expect(dialog).toContain("projectStage: v.projectStage ? (v.projectStage as never) : undefined");
  });

  it("the intake row stores it, and conversion carries it to the deal", () => {
    const inbox = read("src/lib/inbox-actions.ts");
    expect(fnBody(inbox, "export async function createInboxItem(")).toContain("project_stage: input.projectStage ?? null");
    expect(fnBody(inbox, "export async function convertInboxToRfq(")).toContain("projectStage: item.project_stage ?? null");
    const rfq = read("src/lib/rfq-actions.ts");
    expect(fnBody(rfq, "export async function createRfqWithOpportunity(")).toContain("project_stage: input.projectStage");
  });

  it("a project update sends the stage it reports", () => {
    const actions = read("src/lib/project-update-actions.ts");
    expect(fnBody(actions, "export async function postProjectUpdate(")).toContain("project_stage: input.stage");
    const panel = read("src/components/phc/ProjectUpdatesPanel.tsx");
    expect(panel).toContain('key: "stage"');
    expect(panel).toContain("stage: check.stage");
  });

  it("the home page reads it and shows it next to the %", () => {
    const panel = read("src/components/phc/ProjectProgressPanel.tsx");
    expect(panel).toContain("completion_pct, project_stage,");
    expect(panel).toContain("siteStageLabel(it.siteStage, lang)");
  });

  it("an update with a stage moves the deal's stage", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.apply_opportunity_update()"));
    expect(fn.slice(0, fn.indexOf("END $$;"))).toContain("project_stage    = COALESCE(NEW.project_stage, project_stage)");
  });
});

describe("every deal has a code", () => {
  it("draws from the owner's code and the RFQ sequence when there is no numbered RFQ", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.generate_opportunity_project_code()"));
    const body = fn.slice(0, fn.indexOf("END $$;"));
    expect(body).toContain("public.sales_code_for(NEW.owner_id)");
    expect(body).toContain("nextval('public.rfq_number_seq')");
    expect(body).toContain("r.rfq_number IS NOT NULL");
  });

  it("only can_edit_rfq_number changes it by hand, ahead of generation", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.generate_opportunity_project_code()"));
    expect(fn.indexOf("NOT public.can_edit_rfq_number(_uid)")).toBeGreaterThan(-1);
    expect(fn.indexOf("NOT public.can_edit_rfq_number(_uid)")).toBeLessThan(fn.indexOf("nextval("));
    expect(fn).toContain("'opportunity.project_code_overridden'");
  });

  it("fires on creation and on owner assignment", () => {
    expect(MIGRATION).toContain("BEFORE INSERT OR UPDATE OF project_code, owner_id ON public.opportunities");
  });

  it("the Production project uses the deal's code before PRJ-", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.next_project_number(_project_id uuid)"));
    const body = fn.slice(0, fn.indexOf("END $$;"));
    expect(body.indexOf("o.project_code INTO _number")).toBeGreaterThan(-1);
    expect(body.indexOf("o.project_code INTO _number")).toBeLessThan(body.indexOf("'PRJ-'"));
  });

  it("backfills each deal with an audit row", () => {
    const block = MIGRATION.slice(MIGRATION.indexOf("-- ---- 3. Backfill"));
    expect(block.match(/'opportunity\.project_code_backfilled'/g)?.length).toBe(2);
  });

  it("the deal page and the list show it when there is no RFQ number", () => {
    const page = read("src/routes/_authenticated/opportunities.$id.tsx");
    expect(page).toContain("const dealCode = rfqQ.data?.rfq_number ?? o.project_code ?? null");
    const list = read("src/routes/_authenticated/opportunities.index.tsx");
    expect(list).toContain("rfq?.rfq_number ?? o.project_code");
  });
});
