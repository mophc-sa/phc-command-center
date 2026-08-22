// Pure logic behind the Historical Sales tab. The rules worth pinning are the
// ones that decide what a salesperson sees, and the two that could quietly
// misreport the pipeline: an absent amount is not zero, and an amount filter
// must not silently drop the 92 rows that have no figure.

import { describe, expect, it } from "bun:test";
import {
  EMPTY_FILTERS, filterHistorical, ownerOptions, qualityFlags, statusOptions, summarise,
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
