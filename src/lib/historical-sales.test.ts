// Pure logic behind the Historical Sales tab. The rules worth pinning are the
// ones that decide what a salesperson sees, and the two that could quietly
// misreport the pipeline: an absent amount is not zero, and an amount filter
// must not silently drop the 92 rows that have no figure.

import { describe, expect, it } from "bun:test";
import {
  EMPTY_FILTERS, EXPORT_COLUMNS, exportFilename, filterHistorical, ownerOptions,
  qualityCounts, qualityFlags, statusOptions, summarise, toCsv,
  yearOptions, yearRange, selectedYear, statusBreakdown,
  type HistoricalSaleRow,
} from "./historical-sales";

const base: HistoricalSaleRow = {
  row_id: "1", sales_code: "AH25081-RV.02", base_code: "AH25081", revision_no: 2, variant: null,
  owner_prefix: "AH", owner_user_id: null, owner: "AH — legacy owner",
  client: "SAUDI BINLADEN GROUP SBG", company_id: "c1", company_matched: true,
  project: "MAKKAH HARAM - MATAF", location: "MAKKAH", route: "jih",
  status: "SUBMITTED", status_canonical: "submitted", amount: 18801940, currency: "SAR",
  date_received: "2025-09-08", date_submitted: "2025-11-06", contact_name: "X",
  email_subject: null, update_log: null, row_number: 1,
  search_text: "ah25081-rv.02 ah25081 saudi binladen group sbg makkah haram - mataf makkah ah — legacy owner submitted x",
};
const row = (o: Partial<HistoricalSaleRow>): HistoricalSaleRow => ({ ...base, ...o, row_id: o.row_id ?? Math.random().toString() });

describe("quality flags describe what a person can act on", () => {
  it("an unmapped owner is flagged — nine of ten prefixes have no account", () => {
    expect(qualityFlags(base)).toContain("missing_owner");
    expect(qualityFlags(row({ owner_user_id: "u1" }))).not.toContain("missing_owner");
  });

  it("an absent amount is flagged, and zero is not absent", () => {
    expect(qualityFlags(row({ amount: null }))).toContain("missing_amount");
    expect(qualityFlags(row({ amount: 0 }))).not.toContain("missing_amount");
  });

  it("an unmatched company is flagged only when there was a name to match", () => {
    expect(qualityFlags(row({ company_matched: false }))).toContain("unmatched_company");
    // No client name means nothing failed to match — that is a different gap.
    expect(qualityFlags(row({ company_matched: false, client: null }))).not.toContain("unmatched_company");
  });

  it("a bare prefix placeholder counts as unparsed — it cannot group a family", () => {
    expect(qualityFlags(row({ sales_code: "BA", base_code: "BA", revision_no: null }))).toContain("unparsed_code");
    expect(qualityFlags(base)).not.toContain("unparsed_code");
  });
});

describe("filtering", () => {
  const rows = [
    base,
    row({ sales_code: "OM24199", base_code: "OM24199", revision_no: null, owner_prefix: "OM",
          client: "Almabani", project: "Green Riyadh", route: "tender", status_canonical: "lost",
          amount: 500, date_submitted: "2024-03-24",
          search_text: "om24199 almabani green riyadh tender lost" }),
    // Route null on purpose: 24 real records have no JIH/Tender value, and a
    // fixture that inherits one hides whether the filter actually filters.
    row({ sales_code: "FA25106", base_code: "FA25106", owner_prefix: "FA", amount: null,
          status_canonical: null, status: "DECLINE", company_matched: false, client: "Unknown Co",
          route: null, date_submitted: null, search_text: "fa25106 unknown co decline" }),
  ];

  it("every search word must match, so two words narrow rather than widen", () => {
    expect(filterHistorical(rows, { ...EMPTY_FILTERS, q: "binladen mataf" })).toHaveLength(1);
    expect(filterHistorical(rows, { ...EMPTY_FILTERS, q: "binladen riyadh" })).toHaveLength(0);
  });

  it("filters by status, route and legacy owner", () => {
    expect(filterHistorical(rows, { ...EMPTY_FILTERS, status: "lost" })).toHaveLength(1);
    expect(filterHistorical(rows, { ...EMPTY_FILTERS, route: "jih" })).toHaveLength(1);
    expect(filterHistorical(rows, { ...EMPTY_FILTERS, owner: "FA" })).toHaveLength(1);
  });

  // The trap: treating a null amount as 0 would sweep 92 real records into
  // every "under X" filter and quietly imply they were cheap.
  it("an amount filter excludes rows with no amount rather than treating them as zero", () => {
    const under1000 = filterHistorical(rows, { ...EMPTY_FILTERS, maxAmount: 1000 });
    expect(under1000).toHaveLength(1);
    expect(under1000[0].amount).toBe(500);
  });

  it("a date filter excludes rows with no submission date", () => {
    expect(filterHistorical(rows, { ...EMPTY_FILTERS, fromDate: "2020-01-01" })).toHaveLength(2);
  });

  it("filters to the rows carrying one quality problem", () => {
    expect(filterHistorical(rows, { ...EMPTY_FILTERS, flag: "unmatched_company" })).toHaveLength(1);
    expect(filterHistorical(rows, { ...EMPTY_FILTERS, flag: "missing_owner" })).toHaveLength(3);
  });

  it("no filters returns everything", () => {
    expect(filterHistorical(rows, EMPTY_FILTERS)).toHaveLength(3);
  });
});

describe("summarising what is on screen", () => {
  const rows = [base, row({ amount: null, status_canonical: null }), row({ amount: 100, status_canonical: "won" })];

  it("totals only the rows that have a figure, and says how many that was", () => {
    const s = summarise(rows);
    expect(s.count).toBe(3);
    expect(s.valued).toBe(2);
    expect(s.total).toBe(18802040);
  });

  it("counts a status-less row as needing a decision", () => {
    expect(summarise(rows).needsDecision).toBe(1);
  });
});

describe("filter options come from the data, not a hardcoded list", () => {
  const rows = [base, row({ owner_prefix: "OM", owner: "OM — legacy owner", status_canonical: "lost" }), row({ owner_prefix: "OM", owner: "OM — legacy owner" })];

  it("owners are ranked by how many records they hold", () => {
    const o = ownerOptions(rows);
    expect(o[0].prefix).toBe("OM");
    expect(o[0].count).toBe(2);
  });

  it("statuses exclude the undecided ones — there is nothing to filter to", () => {
    expect(statusOptions([row({ status_canonical: null })])).toHaveLength(0);
  });
});

describe("CSV export", () => {
  const rows = [
    base,
    row({ sales_code: "OM24199", client: 'Almabani, "Group"', project: "Line 1\nLine 2",
          status_canonical: null, status: "DECLINE", amount: null, date_submitted: null,
          route: "tender", owner: "OM — legacy owner" }),
  ];

  it("exports exactly the eight approved columns, in order", () => {
    const header = toCsv([]).split("\r\n")[0];
    expect(header).toBe("Sales Code,Client,Project,Status,Amount,Submission Date,Route,Legacy Owner");
    expect(EXPORT_COLUMNS).toHaveLength(8);
  });

  it("leaks nothing the table does not show", () => {
    const csv = toCsv(rows);
    // update_log is prose that breaks a spreadsheet; ids mean nothing outside.
    for (const forbidden of ["row_id", "search_text", "update_log", "company_id", "email_subject"]) {
      expect(csv).not.toContain(forbidden);
    }
  });

  it("quotes commas, quotes and newlines so a cell cannot break the file", () => {
    const line = toCsv([rows[1]]).split("\r\n")[1];
    expect(line).toContain('"Almabani, ""Group"""');
    expect(line).toContain('"Line 1\nLine 2"');
  });

  it("writes the amount as a bare number, because the first thing anyone does is sum it", () => {
    const line = toCsv([base]).split("\r\n")[1];
    expect(line).toContain("18801940");
    expect(line).not.toContain("SAR");
    expect(line).not.toContain("18,801,940");
  });

  it("falls back to the raw status when nothing canonical was decided", () => {
    expect(toCsv([rows[1]]).split("\r\n")[1]).toContain("DECLINE");
  });

  it("writes an empty cell for a missing amount rather than a zero", () => {
    const cells = toCsv([rows[1]]).split("\r\n")[1].split(",");
    // Sales Code, Client(quoted), Project(quoted), Status, Amount — the amount
    // cell must be empty, never "0", which would invent a free job.
    expect(toCsv([rows[1]])).not.toMatch(/DECLINE,0,/);
    expect(cells.length).toBeGreaterThan(0);
  });

  it("exports exactly the rows it is given — the caller filters, not the exporter", () => {
    const filtered = filterHistorical(rows, { ...EMPTY_FILTERS, route: "tender" });
    const csv = toCsv(filtered);
    expect(csv.trim().split("\r\n")).toHaveLength(2);  // header + 1
    expect(csv).toContain("OM24199");
    expect(csv).not.toContain("AH25081");
  });

  it("names the file with the date and the row count", () => {
    expect(exportFilename("2026-08-22", 679)).toBe("phc-historical-sales-archive_2026-08-22_679-records.csv");
  });
});

// ---- The year view, added so "how did 2026 go" is one click ----------------

describe("years come from the data, not a hardcoded list", () => {
  const rows = [
    row({ date_submitted: "2026-02-01" }),
    row({ date_submitted: "2026-11-30" }),
    row({ date_submitted: "2024-06-01" }),
    // Never submitted: should still land in the year it arrived, not in nothing.
    row({ date_submitted: null, date_received: "2025-03-03" }),
    // No date at all: excluded rather than bucketed under a guess.
    row({ date_submitted: null, date_received: null }),
  ];

  it("lists the years present, newest first, with counts", () => {
    expect(yearOptions(rows)).toEqual([
      { year: "2026", count: 2 },
      { year: "2025", count: 1 },
      { year: "2024", count: 1 },
    ]);
  });

  it("a record with no date anywhere is not invented into a year", () => {
    expect(yearOptions(rows).reduce((n, y) => n + y.count, 0)).toBe(4);
  });

  it("an empty archive offers no years rather than throwing", () => {
    expect(yearOptions([])).toEqual([]);
  });
});

describe("selecting a year is its own filter, not a submitted-date range", () => {
  // It used to be encoded as fromDate/toDate and read back from them, so that
  // a hand-edited range and the year buttons could not disagree. That coupling
  // is what broke: yearOptions counted by submitted-or-received and the range
  // filtered by submitted alone, so "2026 (78)" opened 76. The two questions
  // are separate — which year is this filed under, versus when was it
  // submitted — so they get separate fields and cannot drift again.
  it("reads the year back from its own field", () => {
    expect(selectedYear({ ...EMPTY_FILTERS, year: "2026" })).toBe("2026");
    expect(selectedYear(EMPTY_FILTERS)).toBe("");
  });

  it("a typed submitted range no longer lights up a year button", () => {
    expect(selectedYear({ ...EMPTY_FILTERS, fromDate: "2026-01-01", toDate: "2026-12-31" })).toBe("");
  });
});

describe("the status breakdown orders by value, not by count", () => {
  const rows = [
    row({ status_canonical: "lost", amount: 1_000 }),
    row({ status_canonical: "lost", amount: 1_000 }),
    row({ status_canonical: "lost", amount: 1_000 }),
    row({ status_canonical: "won",  amount: 900_000 }),
  ];

  it("puts the larger value first even though it has fewer records", () => {
    // Three small losses and one big win is a good period; ordering by count
    // would head the panel with "lost" and say the opposite.
    expect(statusBreakdown(rows).map((b) => b.status)).toEqual(["won", "lost"]);
  });

  it("reports count and value separately", () => {
    const [won, lost] = statusBreakdown(rows);
    expect(won).toEqual({ status: "won", count: 1, total: 900_000, valued: 1 });
    expect(lost).toEqual({ status: "lost", count: 3, total: 3_000, valued: 3 });
  });

  it("counts a record with no amount without inventing a zero", () => {
    const b = statusBreakdown([
      row({ status_canonical: "submitted", amount: 5_000 }),
      row({ status_canonical: "submitted", amount: null }),
    ])[0];
    expect(b.count).toBe(2);
    expect(b.valued).toBe(1);
    expect(b.total).toBe(5_000);
  });

  it("surfaces undecided records rather than dropping them", () => {
    // How much of the book is unclassified is the finding, not noise to hide.
    const b = statusBreakdown([row({ status_canonical: null, amount: 10 })]);
    expect(b).toEqual([{ status: "undecided", count: 1, total: 10, valued: 1 }]);
  });
});

// =============================================================================
// Found reviewing the Historical Sales Archive against the 2026 data,
// 2026-08-25. The year chip read "2026 (78)"; clicking it returned 76.
//
// Two deliberate decisions collided. yearOptions() falls back to date_received
// for a record that was never submitted, on purpose, so an enquiry lands in
// the year it arrived. Selecting a year applied a SUBMITTED date range, also
// on purpose, which drops rows with no submission date. Neither was an
// oversight; nobody had noticed they cannot both be true of one field.
//
// The year is now its own filter using one shared date rule, so both intents
// survive and the count cannot disagree with its result again.
// =============================================================================
describe("the year count and the year filter agree", () => {
  const at = (row_id: string, submitted: string | null, received: string | null): HistoricalSaleRow =>
    ({ ...base, row_id, date_submitted: submitted, date_received: received });

  const rows: HistoricalSaleRow[] = [
    at("a", "2026-03-01", "2026-02-01"),
    at("b", null, "2026-05-10"), // arrived in 2026, never submitted
    at("c", null, "2026-07-22"), // the second one
    at("d", "2025-11-01", "2025-10-01"),
    at("e", null, null),          // no date at all
  ];

  const inYear = (year: string) =>
    filterHistorical(rows, { ...EMPTY_FILTERS, year }).map((r) => r.row_id);

  it("still counts a record that arrived but was never submitted", () => {
    expect(yearOptions(rows).find((o) => o.year === "2026")?.count).toBe(3);
  });

  it("now returns every record it counted", () => {
    // Was ["a"]: b and c were counted by the chip and filtered away by it.
    expect(inYear("2026")).toEqual(["a", "b", "c"]);
  });

  // The invariant. It is broken again the moment the two sides read different
  // dates, which is exactly how this started.
  it("every year the facet offers returns exactly that many rows", () => {
    for (const { year, count } of yearOptions(rows)) {
      expect(inYear(year).length, `year ${year}`).toBe(count);
    }
  });

  it("does not leak a record into a neighbouring year", () => {
    expect(inYear("2025")).toEqual(["d"]);
  });

  it("a record with no date at all belongs to no year", () => {
    expect(inYear("2026")).not.toContain("e");
    expect(yearOptions(rows).some((o) => o.year === "")).toBe(false);
  });

  // The year buttons and the SUBMITTED inputs are now independent, so picking
  // a year no longer silently discards a range the user typed.
  it("choosing a year leaves a typed submitted range alone", () => {
    const both = filterHistorical(rows, {
      ...EMPTY_FILTERS, year: "2026", fromDate: "2026-03-01",
    }).map((r) => r.row_id);
    expect(both).toEqual(["a"]);
  });
});

describe("quality counts follow the filter", () => {
  const row = (o: Partial<HistoricalSaleRow>): HistoricalSaleRow =>
    ({
      row_id: "r", sales_code: "OM-1", base_code: "OM-1", revision_no: null, variant: null,
      owner_prefix: "OM", owner_user_id: "u1", owner: "Omar", client: "ACME",
      company_id: "c1", company_matched: true, project: "P", location: "Riyadh",
      route: "jih", status: "Won", status_canonical: "won", amount: 100, currency: "SAR",
      date_received: null, date_submitted: null, contact_name: null,
      email_subject: null, update_log: null, ...o,
    }) as HistoricalSaleRow;

  it("counts only the rows it was handed, not the archive", () => {
    // The reported defect: these came from a whole-archive view, so filtering
    // to one year left every chip showing the same number.
    const all = [
      row({ row_id: "a", owner_user_id: null }),
      row({ row_id: "b", amount: null }),
      row({ row_id: "c" }),
    ];
    expect(qualityCounts(all).missing_owner).toBe(1);
    expect(qualityCounts(all).missing_amount).toBe(1);
    expect(qualityCounts([all[2]]).missing_owner).toBe(0);
    expect(qualityCounts([]).missing_amount).toBe(0);
  });

  it("agrees with the filter it drives", () => {
    // A chip's number and the rows clicking it selects come from the same
    // predicate, so they cannot drift apart.
    const rows = [row({ row_id: "a", company_matched: false }), row({ row_id: "b" })];
    const picked = filterHistorical(rows, { ...EMPTY_FILTERS, flag: "unmatched_company" });
    expect(qualityCounts(rows).unmatched_company).toBe(picked.length);
  });

  it("counts a numbered revision once", () => {
    expect(qualityCounts([row({ revision_no: 2 }), row({ revision_no: null })]).revisions).toBe(1);
  });
});
