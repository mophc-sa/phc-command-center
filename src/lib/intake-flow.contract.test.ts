// PHC Sales OS — Intake flow, per the field report of 2026-08-05.
//
// Faisal (salesperson) walked the intake flow end to end and hit six distinct
// problems. Each is covered here, tied to the spec clause that settles it.
import { test, expect, describe } from "bun:test";
import { inferClassification } from "./inbox-actions";

// ─── §25.3 "Classify it as Tender or JIH" — automatically ────────────────────
describe("classification is derived from the form, not asked again", () => {
  test("a JIH project routes to the RFQ track", () => {
    expect(inferClassification({ projectType: "jih", projectName: "KAFD A07" })).toBe("rfq");
  });

  test("a tender project routes to the tender track", () => {
    expect(inferClassification({ projectType: "tender", projectName: "KAFD A07" })).toBe("tender");
  });

  test("no project type — cannot tell, so it asks", () => {
    expect(inferClassification({ projectName: "KAFD A07" })).toBeNull();
    expect(inferClassification({ projectType: null, projectName: "KAFD A07" })).toBeNull();
  });

  test("no project name — a bare type is not enough to route on", () => {
    expect(inferClassification({ projectType: "jih" })).toBeNull();
    expect(inferClassification({ projectType: "jih", projectName: "" })).toBeNull();
    expect(inferClassification({ projectType: "jih", projectName: "   " })).toBeNull();
  });

  test("manual classification survives for the cases it is actually for", async () => {
    // Vague signals, duplicates, incomplete captures, and items that turn out
    // to be a company or contact still need a human. Inference must not have
    // swallowed that path.
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/inbox-actions.ts", "utf8");
    expect(src).toContain("export async function classifyInboxItem");
    const ui = await fs.readFile("src/routes/_authenticated/lead-tender-inbox.tsx", "utf8");
    expect(ui).toContain("setClassifyFor");
  });
});

// ─── §40 "Preserve the original RFQ" ─────────────────────────────────────────
describe("a converted intake item cannot be silently re-routed", () => {
  test("classifyInboxItem refuses once the item is converted", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/inbox-actions.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function classifyInboxItem"));
    expect(fn).toContain(`current?.status === "converted"`);
    expect(fn.slice(0, fn.indexOf("export async function updateInboxItem"))).toContain("orphaned");
  });

  test("markConverted refuses to overwrite an existing link", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/inbox-actions.ts", "utf8");
    const fn = src.slice(src.indexOf("async function markConverted"));
    expect(fn).toContain("converted_record_id");
    expect(fn.slice(0, 900)).toContain("already linked");
  });

  test("an un-converted item IS correctable — that was the real gap", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/inbox-actions.ts", "utf8");
    expect(src).toContain("export async function updateInboxItem");
    // project_type specifically: it is what "make this a Tender instead" means
    // once classification is derived from the form.
    const fn = src.slice(src.indexOf("export async function updateInboxItem"));
    expect(fn.slice(0, 1600)).toContain("project_type");
  });
});

// ─── §25.2/§25.10 vs §29 — where the project belongs in the lifecycle ───────
describe("classify + convert lands on an Opportunity, not a Project", () => {
  test("converting an RFQ creates the opportunity, not just an RFQ row", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/inbox-actions.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function convertInboxToRfq"));
    const body = fn.slice(0, fn.indexOf("export async function convertInboxToTender"));
    // It must go through the §25 path, which builds opportunity + RFQ + contact
    // + company + follow-up + activity together.
    expect(body).toContain("createRfqWithOpportunity");
    // The bare createRfq call is what left the pipeline empty after conversion.
    expect(body).not.toMatch(/await createRfq\(/);
  });

  test("the intake item points at the opportunity, so that is what opens", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/inbox-actions.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function convertInboxToRfq"));
    expect(fn.slice(0, fn.indexOf("export async function convertInboxToTender"))).toContain(
      'markConverted(id, "opportunity", result.opportunityId)',
    );
  });

  test("the UI navigates to the opportunity after converting an RFQ", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/routes/_authenticated/lead-tender-inbox.tsx", "utf8");
    // Anchor on the call itself — "classification === rfq" also appears in the
    // fields branch further up.
    const branch = src.slice(src.indexOf("await convertInboxToRfq("));
    expect(branch.slice(0, 900)).toContain('to: "/opportunities/$id"');
  });

  test("the RFQ convert dialog can no longer create a Production project", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/routes/_authenticated/lead-tender-inbox.tsx", "utf8");
    // The inline creator and its resolver state are gone entirely.
    expect(src).not.toContain("creatingProjectFor");
    expect(src).not.toContain("wf_add_new_project");
  });

  test("linking to an EXISTING project stays available for the §39 multi-bidder case", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/routes/_authenticated/lead-tender-inbox.tsx", "utf8");
    expect(src).toContain("rfq_link_existing_project");
  });

  test("the Production project is still created on win, by trigger", async () => {
    const fs = await import("fs/promises");
    const sql = await fs.readFile(
      "supabase/migrations/20260803110000_auto_create_project_on_opportunity_won.sql",
      "utf8",
    );
    expect(sql).toContain("NEW.stage = 'won'");
    // Only when the opportunity has no project yet — which is precisely why
    // handing it one at intake used to suppress the real post-award project.
    expect(sql).toContain("NEW.project_id IS NULL");
  });
});

// ─── §24 "Email reference" / §6 "+ New RFQ" ──────────────────────────────────
describe("the RFQ-first entry point", () => {
  test("evidence accepts a pasted link, not only a file", async () => {
    const fs = await import("fs/promises");
    const dialog = await fs.readFile("src/components/phc/ActionDialog.tsx", "utf8");
    expect(dialog).toContain(`type: "file_or_url"`);
    const intake = await fs.readFile("src/routes/_authenticated/lead-tender-inbox.tsx", "utf8");
    expect(intake).toMatch(/key: "evidenceUrl", type: "file_or_url"/);
  });

  test("+ New RFQ lives in the shell, so it is reachable from every page", async () => {
    const fs = await import("fs/promises");
    const shell = await fs.readFile("src/components/phc/AppShell.tsx", "utf8");
    expect(shell).toContain("NewRfqDialog");
    expect(shell).toContain("nav_new_rfq");
  });

  test("it is gated by the same authority as other record creation", async () => {
    const fs = await import("fs/promises");
    const shell = await fs.readFile("src/components/phc/AppShell.tsx", "utf8");
    expect(shell).toContain("canCreateSalesRecords");
  });

  test("§25: one save produces opportunity, RFQ, contact, company, follow-up, activity", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/rfq-actions.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function createRfqWithOpportunity"));
    expect(fn).toContain(`from("opportunities")`);
    expect(fn).toContain("createRfq(");
    expect(fn).toContain(`from("contacts")`);
    expect(fn).toContain(`from("companies")`);
    expect(fn).toContain(`from("follow_ups")`);
    expect(fn).toContain(`from("activities")`);
  });

  test("the RFQ is linked to its opportunity — it used to be an orphan", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/rfq-actions.ts", "utf8");
    expect(src).toContain("opportunity_id: input.opportunityId");
    const fn = src.slice(src.indexOf("export async function createRfqWithOpportunity"));
    expect(fn).toContain("opportunityId: opp.id");
  });

  test("the opportunity starts at rfq_received, per D6", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/rfq-actions.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function createRfqWithOpportunity"));
    expect(fn).toContain(`sales_stage: "rfq_received"`);
  });
});

// ─── §9/§16 a row in a work queue must open its record ───────────────────────
describe("My Day urgent submissions", () => {
  test("rows navigate instead of only looking clickable", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/routes/_authenticated/my-workspace.tsx", "utf8");
    // Anchor on the row-rendering map, not the earlier empty-state check.
    const rows = src.slice(src.indexOf("(urgentRfqs as any[]).map"));
    expect(rows.slice(0, 2500)).toContain("<Link");
    expect(rows.slice(0, 2500)).toContain(`to="/opportunities/$id"`);
  });

  test("the query fetches what the row needs to navigate and to be recognised", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/routes/_authenticated/my-workspace.tsx", "utf8");
    const q = src.slice(src.indexOf("ws-urgent-rfqs"));
    expect(q.slice(0, 900)).toContain("opportunity_id");
    expect(q.slice(0, 900)).toContain("projects(name)");
  });

  test("the header no longer says 'Project Name' over a column of RFQ numbers", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/routes/_authenticated/my-workspace.tsx", "utf8");
    const rowsAt = src.indexOf("(urgentRfqs as any[]).map");
    const header = src.slice(rowsAt - 1600, rowsAt);
    expect(header).toContain("RFQ No.");
    expect(header).toContain("Project / Client");
    // The old header claimed "Project Name" over a cell that rendered an RFQ
    // number or a UUID fragment.
    expect(header).not.toMatch(/"رقم الطلب" : "Project Name"/);
  });
});
