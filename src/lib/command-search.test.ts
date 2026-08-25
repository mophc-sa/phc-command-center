import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSearchResults,
  filterPages,
  isCommandEmpty,
  type SearchablePage,
} from "./command-search";

const root = join(import.meta.dir, "../..");

// QA 2026-08-10 (ISSUE-001/ISSUE-002): the palette rendered <CommandItem
// value={`result-${uuid}`}>, and cmdk's default client-side filter scores that
// value against the typed query. A UUID only contains hex characters, so
// "acc" fuzzy-matched a UUID while "MURABBA" could not — every record whose
// name held a non-hex letter was silently hidden even though the server had
// already returned it. Worse, `results.length > 0` suppressed the empty state,
// so the dialog rendered completely blank with no feedback at all.

const PAGES: SearchablePage[] = [
  { to: "/reports", labelEn: "Reports", labelAr: "التقارير", group: "Reports" },
  { to: "/accounts", labelEn: "Accounts", labelAr: "الحسابات", group: "CRM" },
  { to: "/opportunities", labelEn: "Opportunities", labelAr: "الفرص", group: "Pipeline" },
];

describe("buildSearchResults", () => {
  const rows = {
    companies: [{ id: "c1", name: "Cscec" }],
    opportunities: [{ id: "o1", project_name: "NEW MURABBA ACTIVATION CENTRE" }],
    projects: [{ id: "p1", name: "ajwad" }],
    contacts: [{ id: "k1", name: "Bilawal", title: "Procurement Lead" }],
  };

  test("maps every record type to a navigable result", () => {
    const results = buildSearchResults(rows);
    expect(results.map((r) => r.type)).toEqual(["account", "opportunity", "project", "contact"]);
    expect(results.map((r) => r.to)).toEqual([
      "/accounts/c1",
      "/opportunities/o1",
      "/projects/p1",
      "/contacts?q=Bilawal",
    ]);
  });

  test("every result carries a text search value containing its label", () => {
    // This is the actual ISSUE-001 regression guard: the value handed to cmdk
    // must contain the human-readable label, never a bare UUID.
    for (const r of buildSearchResults(rows)) {
      expect(r.searchValue).toContain(r.label);
      expect(r.searchValue).not.toMatch(/^result-[0-9a-f-]+$/);
    }
  });

  test("a non-hex query is present in the matching result's search value", () => {
    const results = buildSearchResults(rows);
    const opp = results.find((r) => r.type === "opportunity");
    expect(opp?.searchValue.toLowerCase()).toContain("murabba");
  });

  test("tolerates partially failed queries", () => {
    expect(buildSearchResults({}).length).toBe(0);
    expect(buildSearchResults({ companies: null, opportunities: undefined }).length).toBe(0);
  });

  test("skips records with no usable label", () => {
    const results = buildSearchResults({
      companies: [{ id: "c1", name: "" }, { id: "c2", name: "Real" }],
    });
    expect(results.map((r) => r.label)).toEqual(["Real"]);
  });

  test("url-encodes contact names so the deep link stays valid", () => {
    const results = buildSearchResults({ contacts: [{ id: "k1", name: "Abu Dhabi & Co" }] });
    expect(results[0]?.to).toBe("/contacts?q=Abu%20Dhabi%20%26%20Co");
  });
});

describe("filterPages", () => {
  test("matches English label, Arabic label, and group", () => {
    expect(filterPages(PAGES, "report").map((p) => p.to)).toEqual(["/reports"]);
    expect(filterPages(PAGES, "الحسابات").map((p) => p.to)).toEqual(["/accounts"]);
    expect(filterPages(PAGES, "crm").map((p) => p.to)).toEqual(["/accounts"]);
  });

  test("returns everything for an empty query", () => {
    expect(filterPages(PAGES, "   ").length).toBe(PAGES.length);
  });

  test("returns nothing when a record-only term is typed", () => {
    expect(filterPages(PAGES, "MURABBA")).toEqual([]);
  });
});

describe("isCommandEmpty", () => {
  test("stays quiet while the debounced search is still running", () => {
    expect(isCommandEmpty({ searching: true, query: "murabba", resultCount: 0, pageCount: 0 })).toBe(false);
  });

  test("stays quiet below the minimum query length", () => {
    expect(isCommandEmpty({ searching: false, query: "m", resultCount: 0, pageCount: 0 })).toBe(false);
  });

  test("reports empty when nothing matched at all", () => {
    expect(isCommandEmpty({ searching: false, query: "zzzz", resultCount: 0, pageCount: 0 })).toBe(true);
  });

  test("stays quiet when only pages matched", () => {
    expect(isCommandEmpty({ searching: false, query: "report", resultCount: 0, pageCount: 1 })).toBe(false);
  });

  test("stays quiet when only records matched", () => {
    expect(isCommandEmpty({ searching: false, query: "murabba", resultCount: 1, pageCount: 0 })).toBe(false);
  });
});

describe("CommandPalette wiring (ISSUE-001 regression guard)", () => {
  const source = readFileSync(join(root, "src/components/phc/CommandPalette.tsx"), "utf8");

  test("disables cmdk's client-side filter so server results are not re-filtered", () => {
    expect(source).toContain("shouldFilter={false}");
  });

  test("never hands cmdk a bare uuid as an item value", () => {
    expect(source).not.toContain("value={`result-${r.id}`}");
  });

  test("searches contacts alongside companies, opportunities and projects", () => {
    expect(source).toContain('from("contacts")');
  });

  test("CommandDialog forwards shouldFilter to the inner Command", () => {
    const dialogSource = readFileSync(join(root, "src/components/ui/command.tsx"), "utf8");
    expect(dialogSource).toContain("shouldFilter");
  });
});
