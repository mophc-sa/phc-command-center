// PHC Sales OS — Contract test: every opportunity is born with a sales_stage.
//
// Live audit, 2026-08-05: 2 of 4 production opportunities carried
// sales_stage = NULL. Root cause was not a migration or a trigger — it was two
// of the five INSERT sites simply not setting the column:
//
//   • src/lib/crm-actions.ts          createOpportunityForCompany  (Account → New Opportunity)
//   • supabase/functions/.../pipeline.ts  convert_lead_to_opportunity
//
// The consequence is a silent one. The WRITE path treats NULL as "jih"
// (`opp.sales_stage ?? "jih"` in advance_sales_stage, and `TRANSITIONS[from ??
// "jih"]` in workflow-actions), while every READ path filters it out — the
// dashboards use `.in("sales_stage", [...])` and computeJihPipelineTotal
// explicitly skips nulls. So the record is workable but invisible: it never
// appears in a JIH panel, an award queue, or a pipeline total.
//
// These tests scan the source of every INSERT site so a new one cannot
// reintroduce the gap.
import { test, expect, describe } from "bun:test";

const INSERT_SITES = [
  "src/lib/rfq-actions.ts",
  "src/lib/crm-actions.ts",
  "supabase/functions/sales-os-api/handlers/pipeline.ts",
  "supabase/functions/sales-os-api/shared.ts",
];

/** Extracts each `.from("opportunities").insert({ ... })` object literal body. */
function opportunityInsertBodies(src: string): string[] {
  const bodies: string[] = [];
  const re = /from\(\s*["']opportunities["']\s*\)\s*\r?\n?\s*\.insert\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // Walk forward balancing braces from the opening `{` of the insert object.
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    bodies.push(src.slice(re.lastIndex, i - 1));
  }
  return bodies;
}

describe("every opportunity INSERT sets sales_stage", () => {
  test.each(INSERT_SITES)("%s", async (file) => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(file, "utf8");
    const bodies = opportunityInsertBodies(src);

    // Guard the guard: if the parser stops matching (refactor, formatting
    // change), the test must fail loudly rather than vacuously pass.
    expect(bodies.length).toBeGreaterThan(0);

    for (const body of bodies) {
      expect(body).toContain("sales_stage");
    }
  });

  test("finds every known insert site — the set has not silently shrunk", async () => {
    const fs = await import("fs/promises");
    let total = 0;
    for (const file of INSERT_SITES) {
      total += opportunityInsertBodies(await fs.readFile(file, "utf8")).length;
    }
    // 5 sites as of 2026-08-05. A new one is fine — bump this and confirm the
    // new site sets sales_stage. A DROP means an insert moved somewhere
    // unscanned, which is what this test exists to catch.
    expect(total).toBeGreaterThanOrEqual(5);
  });
});

describe("the two paths fixed on 2026-08-05", () => {
  test("Account → New Opportunity sets the enum entry stage, not a fabricated one", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/crm-actions.ts", "utf8");
    const body = opportunityInsertBodies(src).find((b) => b.includes("company_id"));
    expect(body).toBeDefined();
    expect(body).toContain(`sales_stage: "rfq_received"`);
  });

  test("lead conversion sets the enum entry stage", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("supabase/functions/sales-os-api/handlers/pipeline.ts", "utf8");
    const body = opportunityInsertBodies(src).find((b) => b.includes("qualified_lead"));
    expect(body).toBeDefined();
    expect(body).toContain(`sales_stage: "rfq_received"`);
  });
});

describe("read/write disagreement about NULL is documented, not accidental", () => {
  test("the write path's NULL fallback still exists and is still 'jih'", async () => {
    const fs = await import("fs/promises");
    const shared = await fs.readFile("supabase/functions/sales-os-api/shared.ts", "utf8");
    const handler = await fs.readFile(
      "supabase/functions/sales-os-api/handlers/pipeline.ts",
      "utf8",
    );
    // If this fallback is ever removed, NULL rows become unadvanceable rather
    // than merely invisible — a harder failure that should be a deliberate choice.
    expect(handler + shared).toContain(`sales_stage ?? "jih"`);
  });

  test("the JIH pipeline total still excludes NULL", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/dashboard-helpers.ts", "utf8");
    expect(src).toContain("o.sales_stage !== null");
  });
});
