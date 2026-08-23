// =============================================================================
// Historical sales — the read side of the staging layer (2022-2026).
//
// 679 quotation records live in `historical_sales_search`, a view that gates
// itself: the sales team, estimation and finance see all of it; viewer,
// system_admin-alone and anon see nothing. Nothing here re-implements that
// rule — if this module asked the wrong question the database would still
// answer correctly, which is the point of putting the gate there.
//
// Read-only by construction. There is no INSERT, UPDATE or DELETE policy on
// any staging table, so there is nothing for this module to offer.
//
// The filtering and quality logic is pure and lives here rather than in the
// component, because "does an unmatched company count as a quality issue" is a
// rule worth testing without mounting React.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";

export type HistoricalSaleRow = {
  row_id: string;
  sales_code: string | null;
  base_code: string | null;
  revision_no: number | null;
  variant: string | null;
  owner_prefix: string | null;
  owner_user_id: string | null;
  owner: string | null;
  client: string | null;
  company_id: string | null;
  company_matched: boolean;
  project: string | null;
  location: string | null;
  route: string | null;
  status: string | null;
  status_canonical: string | null;
  amount: number | null;
  currency: string;
  date_received: string | null;
  date_submitted: string | null;
  contact_name: string | null;
  email_subject: string | null;
  update_log: string | null;
  row_number: number;
  search_text: string | null;
};

export type HistoricalQuality = {
  batch_id: string;
  total_rows: number;
  codes_unparsed: number;
  codes_placeholder: number;
  revisions: number;
  amounts_unparsed: number;
  amounts_absent: number;
  companies_unmatched: number;
  owners_legacy_only: number;
  statuses_needing_decision: number;
  submission_dates_missing: number;
  route_unknown: number;
  total_amount_excl_vat: number | null;
};

/**
 * The whole archive, once.
 *
 * 679 rows is small enough to fetch in one request and filter in the browser,
 * and that is deliberately the cheaper choice: a salesperson scanning history
 * changes their filter constantly, and a round trip per keystroke would be
 * slower and noisier than one 679-row payload held in the query cache. If this
 * grows past a few thousand it should move server-side; it is nowhere near.
 */
export async function listHistoricalSales(): Promise<HistoricalSaleRow[]> {
  const { data, error } = await supabase
    .from("historical_sales_search")
    .select("*")
    .order("date_submitted", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as HistoricalSaleRow[];
}

export async function getHistoricalQuality(): Promise<HistoricalQuality | null> {
  const { data, error } = await supabase.from("historical_sales_quality").select("*").maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as HistoricalQuality | null;
}

// ---- Quality flags per row --------------------------------------------------

export type QualityFlag = "missing_owner" | "missing_amount" | "unmatched_company" | "unparsed_code";

/**
 * What is wrong with one record, from the sales team's point of view.
 *
 * These are the four the business asked to see, and each one changes what a
 * person can do with the row:
 *
 *   missing_owner      679 of 679. Nine of ten owner prefixes have no account,
 *                      so the row carries a legacy label. It is not a defect in
 *                      the import — it is a mapping decision nobody has made.
 *   missing_amount     92 rows. The spreadsheet had no figure, or had text
 *                      where a figure belongs ('RATES ONLY'). Never coerced to
 *                      zero, because a zero would quietly understate the
 *                      pipeline by whatever it hides.
 *   unmatched_company  373 rows. The client name matched no company, so the
 *                      row is not linked to the CRM. Nothing was auto-created.
 *   unparsed_code      29 rows, plus 55 placeholders like a bare `BA`. The
 *                      sales code does not fit any known shape, so it cannot be
 *                      grouped into a revision family.
 */
export function qualityFlags(r: HistoricalSaleRow): QualityFlag[] {
  const f: QualityFlag[] = [];
  if (!r.owner_user_id) f.push("missing_owner");
  if (r.amount === null || r.amount === undefined) f.push("missing_amount");
  if (!r.company_matched && r.client) f.push("unmatched_company");
  // A placeholder is a code we understood well enough to reject; both leave the
  // row ungroupable, so both surface as the same problem to a reader.
  if (!r.base_code || (r.base_code.length <= 2 && !r.revision_no)) f.push("unparsed_code");
  return f;
}

// ---- Filtering --------------------------------------------------------------

export type HistoricalFilters = {
  q: string;                 // free text across code, client, project, owner, status
  status: string;            // canonical status, or "" for all
  route: string;             // 'jih' | 'tender' | '' for all
  owner: string;             // owner prefix, or "" for all
  minAmount: number | null;
  maxAmount: number | null;
  fromDate: string | null;   // submission date, inclusive
  toDate: string | null;
  flag: QualityFlag | "";    // show only rows carrying this problem
};

export const EMPTY_FILTERS: HistoricalFilters = {
  q: "", status: "", route: "", owner: "",
  minAmount: null, maxAmount: null, fromDate: null, toDate: null, flag: "",
};

/**
 * Apply the filters. Pure, so the rules are testable without a browser.
 *
 * Free text matches the pre-built `search_text` column the view exposes, which
 * already concatenates code, client, project, location, owner, status and
 * contact — searching the same seven fields the team was promised, rather than
 * whatever the component happens to render.
 */
export function filterHistorical(rows: HistoricalSaleRow[], f: HistoricalFilters): HistoricalSaleRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q) {
      const hay = r.search_text ?? [r.sales_code, r.client, r.project, r.owner, r.status].join(" ").toLowerCase();
      // Every word must appear somewhere, so "binladen mataf" narrows rather
      // than widening — which is how people actually expect search to behave.
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    if (f.status && r.status_canonical !== f.status) return false;
    if (f.route && r.route !== f.route) return false;
    if (f.owner && r.owner_prefix !== f.owner) return false;
    // A row with no amount is excluded by an amount filter rather than treated
    // as zero — 92 rows have no figure and they are not cheap deals.
    if (f.minAmount !== null && (r.amount === null || r.amount < f.minAmount)) return false;
    if (f.maxAmount !== null && (r.amount === null || r.amount > f.maxAmount)) return false;
    if (f.fromDate && (!r.date_submitted || r.date_submitted < f.fromDate)) return false;
    if (f.toDate && (!r.date_submitted || r.date_submitted > f.toDate)) return false;
    if (f.flag && !qualityFlags(r).includes(f.flag)) return false;
    return true;
  });
}

/** Totals for whatever is currently on screen, not for the whole archive. */
export function summarise(rows: HistoricalSaleRow[]) {
  const withAmount = rows.filter((r) => r.amount !== null);
  return {
    count: rows.length,
    valued: withAmount.length,
    // Excludes rows with no figure rather than counting them as zero.
    total: withAmount.reduce((s, r) => s + (r.amount ?? 0), 0),
    won: rows.filter((r) => r.status_canonical === "won").length,
    lost: rows.filter((r) => r.status_canonical === "lost").length,
    submitted: rows.filter((r) => r.status_canonical === "submitted").length,
    needsDecision: rows.filter((r) => !r.status_canonical).length,
  };
}

// ---- CSV export -------------------------------------------------------------

/**
 * The eight columns the business asked to export, in order.
 *
 * Deliberately a subset of what the archive holds: `update_log` is prose that
 * breaks a spreadsheet, and the internal ids mean nothing outside this system.
 * What leaves is what a person sees on screen.
 */
export const EXPORT_COLUMNS = [
  "Sales Code", "Client", "Project", "Status", "Amount", "Submission Date", "Route", "Legacy Owner",
] as const;

/** RFC 4180 quoting: double the quotes, wrap anything that could break a cell. */
function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build the CSV for whatever is currently filtered.
 *
 * Takes the already-filtered rows rather than rows plus filters, so the export
 * cannot disagree with the table: there is only one filtering path and both the
 * screen and the file are downstream of it.
 *
 * Amount is written as a bare number with no thousands separator and no
 * currency symbol — a formatted string is text to a spreadsheet, and the first
 * thing anyone does with this file is sum a column. Currency is not a column
 * because the archive is entirely SAR and a constant column is noise; the
 * filename carries the context instead.
 */
export function toCsv(rows: HistoricalSaleRow[]): string {
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push([
      csvCell(r.sales_code),
      csvCell(r.client),
      csvCell(r.project),
      // The raw status when nothing canonical was decided, so the export says
      // what the spreadsheet said rather than inventing a blank.
      csvCell(r.status_canonical ?? r.status),
      csvCell(r.amount),
      csvCell(r.date_submitted),
      csvCell(r.route),
      csvCell(r.owner),
    ].join(","));
  }
  // Trailing newline: without it some tools drop the last row.
  return lines.join("\r\n") + "\r\n";
}

export function exportFilename(today: string, count: number): string {
  return `phc-historical-sales-archive_${today}_${count}-records.csv`;
}

/** Distinct owner prefixes present, for the filter dropdown. */
export function ownerOptions(rows: HistoricalSaleRow[]): Array<{ prefix: string; label: string; count: number }> {
  const m = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    if (!r.owner_prefix) continue;
    const e = m.get(r.owner_prefix) ?? { label: r.owner ?? r.owner_prefix, count: 0 };
    e.count += 1;
    m.set(r.owner_prefix, e);
  }
  return [...m.entries()]
    .map(([prefix, v]) => ({ prefix, ...v }))
    .sort((a, b) => b.count - a.count);
}

export function statusOptions(rows: HistoricalSaleRow[]): Array<{ value: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.status_canonical) continue;
    m.set(r.status_canonical, (m.get(r.status_canonical) ?? 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

// ---- Year view -------------------------------------------------------------

/**
 * Which years the archive actually covers, newest first, with a count.
 *
 * Derived from the data rather than hardcoded: the import spans 2021-2026 today
 * and will span more next year, and a fixed list would quietly stop offering
 * the current one — the year people most want.
 *
 * Falls back to the received date when a record was never submitted, so a live
 * enquiry still lands in the year it arrived rather than in "no date".
 */
export function yearOptions(rows: HistoricalSaleRow[]): Array<{ year: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const d = r.date_submitted ?? r.date_received;
    const y = d ? d.slice(0, 4) : "";
    if (!y) continue;
    m.set(y, (m.get(y) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

/** The from/to pair that selects one calendar year. */
export function yearRange(year: string): { fromDate: string; toDate: string } {
  return { fromDate: `${year}-01-01`, toDate: `${year}-12-31` };
}

/**
 * The year currently selected by the filters, or "" when the range is not
 * exactly one calendar year. Read back from the dates rather than stored
 * separately, so a hand-edited date range and the year buttons can never
 * disagree about what is on screen.
 */
export function selectedYear(f: Pick<HistoricalFilters, "fromDate" | "toDate">): string {
  if (!f.fromDate || !f.toDate) return "";
  const y = f.fromDate.slice(0, 4);
  const r = yearRange(y);
  return f.fromDate === r.fromDate && f.toDate === r.toDate ? y : "";
}

/**
 * Status breakdown for whatever is on screen, ordered by value.
 *
 * Value, not count: a year with forty small losses and two large wins is a good
 * year, and ordering by count would put the losses at the top and say the
 * opposite. Records with no decided status are surfaced as "undecided" rather
 * than dropped — how much of the book is unclassified is itself the finding.
 */
export function statusBreakdown(rows: HistoricalSaleRow[]): Array<{
  status: string; count: number; total: number; valued: number;
}> {
  const m = new Map<string, { count: number; total: number; valued: number }>();
  for (const r of rows) {
    const k = r.status_canonical ?? "undecided";
    const e = m.get(k) ?? { count: 0, total: 0, valued: 0 };
    e.count += 1;
    if (r.amount !== null && r.amount !== undefined) {
      e.total += r.amount;
      e.valued += 1;
    }
    m.set(k, e);
  }
  return [...m.entries()]
    .map(([status, v]) => ({ status, ...v }))
    .sort((a, b) => b.total - a.total || b.count - a.count);
}
