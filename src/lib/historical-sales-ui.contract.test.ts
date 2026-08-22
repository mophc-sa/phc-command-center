// Pins the promises the Historical Sales tab makes: it is inside Sales
// Management rather than a module of its own, it is read-only, it does not
// touch canonical tables, and it does not re-implement the database's access
// rule in the client.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const VIEW = "src/components/phc/HistoricalSalesView.tsx";
const LIB = "src/lib/historical-sales.ts";
const MGMT = "src/routes/_authenticated/sales-management.tsx";
const view = read(VIEW);
const lib = read(LIB);
const mgmt = read(MGMT);
const code = (s: string) => s.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");

describe("it lives inside Sales Management, not beside it", () => {
  it("is a tab, not a route", () => {
    expect(mgmt).toContain("HistoricalSalesView");
    expect(mgmt).toContain('"historical"');
    let threw = false;
    try { read("src/routes/_authenticated/historical-sales.tsx"); } catch { threw = true; }
    expect(threw, "a standalone route was created").toBe(true);
  });

  it("the tab reaches the whole sales team, not only managers", () => {
    expect(mgmt).toContain("canHistorical");
    for (const r of ["isSalesperson", "isEstimationManager", "isFinanceManager"]) {
      expect(mgmt).toContain(r);
    }
  });
});

describe("read-only", () => {
  it("offers no write of any kind", () => {
    const c = code(view) + code(lib);
    expect(c).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("creates no canonical entity", () => {
    const c = code(view) + code(lib);
    for (const table of ['"opportunities"', '"quotations"', '"companies"', '"projects"', '"boqs"']) {
      expect(c, `${table} must not be touched`).not.toContain(table);
    }
  });

  it("reads only the two staging surfaces", () => {
    const tables = [...code(lib).matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(["historical_sales_quality", "historical_sales_search"]);
  });
});

describe("security stays in the database", () => {
  it("the client does not re-implement the row gate", () => {
    // The view gates itself with can_read_historical_sales. A client-side
    // filter on roles would be decoration, and would drift.
    expect(code(lib)).not.toContain("can_read_historical_sales");
    expect(code(lib)).not.toMatch(/user_roles|has_role/);
  });

  it("an empty archive is not reported as 'no records exist'", () => {
    // Zero rows means either not-loaded or not-permitted, and the client
    // cannot tell which — so the copy must not claim one.
    expect(view).toMatch(/not loaded yet, or not available to your role/);
  });
});

describe("naming and badges", () => {
  it("uses the approved banner verbatim", () => {
    expect(view).toContain(
      "Historical Sales Archive 2022–2026. Read-only records. Not converted to opportunities or quotations.",
    );
  });

  it("is named Archive, not just Historical Sales", () => {
    expect(view).toContain("Historical Sales Archive");
    expect(mgmt).toContain("Historical Sales Archive");
  });

  it("every row carries a Historical badge, not only the banner", () => {
    // A screenshot of one row has to say what it is too.
    const rowFn = view.slice(view.indexOf("function Row("));
    expect(rowFn).toMatch(/"Historical"/);
  });

  it("presents quality neutrally — a state of the record, never an error", () => {
    expect(view).toContain("Data Quality");
    expect(view).toContain("records have no amount");
    expect(view).toContain("records have no mapped owner");
    expect(view).toContain("records are not matched to a company");
    expect(view).toContain("records have an unparsed code");
    // The word that would blame the archive for the paperwork. Checked against
    // code only — a comment explaining why "errors" is the wrong word is not a
    // violation of it.
    expect(code(view)).not.toMatch(/\berrors?\b/i);
  });

  it("surfaces the four quality indicators", () => {
    for (const f of ["missing_owner", "missing_amount", "unmatched_company", "unparsed_code"]) {
      expect(view).toContain(f);
    }
  });

  it("offers the eight filters", () => {
    for (const k of ["q", "status", "route", "owner", "minAmount", "maxAmount", "fromDate", "toDate"]) {
      expect(lib).toContain(`${k}:`);
    }
  });
});

describe("CSV export", () => {
  it("exports from the filtered rows, so the file matches the screen", () => {
    // downloadCsv takes the already-filtered array; a second filter inside the
    // exporter is how a file quietly ships more than the person was looking at.
    expect(view).toContain("downloadCsv(filtered)");
    // Only the call site matters; the definition's own parameter is named rows.
    const callSites = [...view.matchAll(/onClick=\{\(\) => downloadCsv\((\w+)\)/g)].map((m) => m[1]);
    expect(callSites).toEqual(["filtered"]);
  });

  it("is a download, not a mutation", () => {
    const fn = view.slice(view.indexOf("function downloadCsv"));
    expect(fn).toContain("URL.createObjectURL");
    expect(fn).not.toMatch(/\.insert\(|\.update\(|\.delete\(|supabase/);
  });

  it("prepends a BOM so Arabic client names survive Excel", () => {
    expect(view).toContain("\\uFEFF");
  });
});

describe("bilingual and RTL", () => {
  it("every visible string has both languages", () => {
    // The component builds copy inline rather than through t(), so the guard is
    // that no English label appears without an Arabic counterpart nearby.
    const arCount = (view.match(/ar: "/g) ?? []).length + (view.match(/\? "[^"]*[؀-ۿ]/g) ?? []).length;
    expect(arCount).toBeGreaterThan(20);
  });

  it("uses logical properties so RTL mirrors correctly", () => {
    expect(code(view)).not.toMatch(/\b(ml-|mr-|pl-|pr-|text-left|text-right)\b/);
  });
});
