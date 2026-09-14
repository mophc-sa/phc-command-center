// =============================================================================
// Project codes follow the rep: <CODE>-<YY>-<NNNN> from intake onward.
//
// The database behaviour is pinned in supabase/tests/intake_code_follows_sales_rep.test.sql.
// These pin the wiring a pgTAP test cannot see: that conversion actually tells
// the database which intake an RFQ came from.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIGRATION = read("supabase/migrations/20260930140000_intake_code_follows_sales_rep.sql");

describe("an intake's code is carried to its RFQ", () => {
  it("converting an intake passes the intake to the RFQ", () => {
    const inbox = read("src/lib/inbox-actions.ts");
    const fn = inbox.slice(inbox.indexOf("export async function convertInboxToRfq"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("sourceInboxId: id");
  });

  it("the RFQ insert stores that link", () => {
    const rfq = read("src/lib/rfq-actions.ts");
    expect(rfq).toContain("source_inbox_id: input.sourceInboxId ?? null");
    const withOpp = rfq.slice(rfq.indexOf("export async function createRfqWithOpportunity"));
    expect(withOpp).toContain("sourceInboxId: input.sourceInboxId ?? null");
  });
});

describe("numbering", () => {
  it("numbers intakes from the RFQ sequence, never INT-", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.generate_inbox_project_number()"));
    const body = fn.slice(0, fn.indexOf("END $$;"));
    expect(body).toContain("nextval('public.rfq_number_seq')");
    expect(body).toContain("public.sales_code_for(COALESCE(NEW.created_by, auth.uid()))");
    expect(body).not.toContain("'INT-'");
  });

  it("inherits only for someone who may convert the intake, while it is open, and once", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.generate_rfq_number()"));
    const inherit = fn.slice(fn.indexOf("NEW.source_inbox_id IS NOT NULL"), fn.indexOf("NEW.rfq_number := _inherited"));
    expect(inherit).toContain("i.status NOT IN ('converted', 'archived', 'marked_duplicate')");
    expect(inherit).toContain("public.is_pipeline_operator(_uid)");
    expect(inherit).toContain("NOT EXISTS (SELECT 1 FROM public.rfqs r WHERE r.rfq_number = i.project_number)");
  });

  it("keeps the manual-override guard ahead of inheritance", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.generate_rfq_number()"));
    expect(fn.indexOf("NOT public.can_edit_rfq_number(_uid)")).toBeLessThan(fn.indexOf("NEW.source_inbox_id IS NOT NULL"));
  });

  it("renumbers only intakes still open, and audits each change", () => {
    const block = MIGRATION.slice(MIGRATION.indexOf("-- ---- 3. Renumber"));
    expect(block).toContain("project_number LIKE 'INT-%'");
    expect(block).toContain("status NOT IN ('converted', 'archived', 'marked_duplicate')");
    expect(block).toContain("'inbox.project_number_renumbered'");
  });
});
