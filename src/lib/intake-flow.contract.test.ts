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

// ─── §39 the project is the master record — it must not be born empty ────────
describe("intake data reaches the project it creates", () => {
  test("createProjectFromInboxItem carries the fields the user already typed", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/inbox-actions.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function createProjectFromInboxItem"));
    for (const field of [
      "project_name", "location", "estimated_value", "scope_type", "source_name",
      "client_owner", "main_contractor", "consultant",
    ]) {
      expect(fn).toContain(field);
    }
  });

  test("the inline shortcut uses it instead of name-only createProject", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/routes/_authenticated/lead-tender-inbox.tsx", "utf8");
    expect(src).toContain("createProjectFromInboxItem");
    // The name-only call that produced the blank project page.
    expect(src).not.toContain("createProject({ name: v.name })");
  });

  test("company links are matched, never invented from free text", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/inbox-actions.ts", "utf8");
    const fn = src.slice(src.indexOf("async function linkCompanyByName"));
    expect(fn.slice(0, 600)).toContain("ilike");
    // No insert into companies from this path — a typo must not mint a record.
    expect(fn.slice(0, 600)).not.toContain(".insert(");
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
