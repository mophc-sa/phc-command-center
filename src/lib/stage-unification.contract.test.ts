// PHC Sales OS — Contract test: management views read the canonical stage.
//
// `opportunities` carries two progress columns. `sales_stage` is the real PHC
// pipeline; `stage` is the generic CRM vocabulary the system started with, and
// applySalesStage only keeps them in step at won and lost. Mid-pipeline they
// drift, and the drift was visible in production on 2026-08-05:
//
//   legacy stage   sales_stage        count
//   quotation      verbally_awarded   1     ← a verbal award filed under "Quotation"
//
// Command Center, Reports and the opportunities list all read `stage`, so the
// management dashboard disagreed with My Workspace about the same deal. These
// tests pin the three pages to the canonical resolver.
import { test, expect, describe } from "bun:test";

const CANONICAL_PAGES = [
  "src/routes/_authenticated/command-center.tsx",
  "src/routes/_authenticated/reports.tsx",
  "src/routes/_authenticated/opportunities.index.tsx",
];

async function read(file: string): Promise<string> {
  const fs = await import("fs/promises");
  return fs.readFile(file, "utf8");
}

describe("management views resolve stage canonically", () => {
  test.each(CANONICAL_PAGES)("%s imports the canonical resolver", async (file) => {
    expect(await read(file)).toContain("@/lib/stage-canonical");
  });

  test.each(CANONICAL_PAGES)("%s selects sales_stage from the database", async (file) => {
    const src = await read(file);
    // The trap this catches: switching the code to the canonical resolver while
    // the query still only fetches `stage`. Everything type-checks, every test
    // that scans for the import passes, and the resolver silently falls back to
    // inference on every single row — a no-op refactor that looks done.
    const selectsOpportunities = src.includes('from("opportunities")');
    if (!selectsOpportunities) return; // opportunities.index uses "*"
    const usesStar = /\.select\(\s*\n?\s*"\*/.test(src);
    expect(usesStar || src.includes("sales_stage")).toBe(true);
  });

  test("no management view still buckets by the legacy CRM stages", async () => {
    for (const file of CANONICAL_PAGES) {
      const src = await read(file);
      // The generic vocabulary that used to drive the pipeline charts.
      const legacyBuckets = /"discovery",\s*"qualification",\s*"preparation"/.test(src);
      expect([file, legacyBuckets]).toEqual([file, false]);
    }
  });

  test("command-center groups by canonical stage, not o.stage", async () => {
    const src = await read("src/routes/_authenticated/command-center.tsx");
    expect(src).toContain("groupByCanonicalStage");
    expect(src).not.toMatch(/map\.get\(o\.stage\)/);
  });

  test("reports groups by canonical stage, not o.stage", async () => {
    const src = await read("src/routes/_authenticated/reports.tsx");
    expect(src).toContain("groupByCanonicalStage");
    expect(src).not.toMatch(/o\.stage === s/);
  });

  test("the opportunities list computes no KPI of its own", async () => {
    const src = await read("src/routes/_authenticated/opportunities.index.tsx");
    // This used to require `resolveCanonicalStage` in the file, because the
    // page counted open deals and closed deals itself and had been doing it off
    // the legacy `stage` column. It no longer counts anything: the strip comes
    // whole from the shared engine, which resolves canonically for every screen
    // at once. Requiring the helper by name would now fail a page that got
    // strictly safer, so the assertion follows the intent instead.
    expect(src).toContain("commercialBookKpis");
    expect(src).not.toMatch(/CLOSED\.includes\(o\.stage\)/);
    expect(src).not.toMatch(/o\.stage === ["'](won|lost)["']/);
  });

  test("My Workspace and Award Queue still read sales_stage directly", async () => {
    // They were already correct. If they ever stop being, the two halves of the
    // app disagree again — just in the other direction.
    for (const file of [
      "src/routes/_authenticated/my-workspace.tsx",
      "src/routes/_authenticated/award-queue.tsx",
    ]) {
      expect([file, (await read(file)).includes("sales_stage")]).toEqual([file, true]);
    }
  });
  // `groupByCanonicalStage` returns `inferredCount` — how many bars rest on a
  // stage that had to be guessed because the row carries no sales_stage. The
  // dashboard computed it on every render and rendered it nowhere, so a chart
  // built partly from inference was indistinguishable from one built from
  // recorded data. The count's own arithmetic is tested in stage-canonical.test.ts;
  // this asserts it actually reaches the screen.
  test("command-center discloses how many bars rest on an inferred stage", async () => {
    const src = await read("src/routes/_authenticated/command-center.tsx");
    expect(src).toContain("inferredCount > 0");
  });
});
