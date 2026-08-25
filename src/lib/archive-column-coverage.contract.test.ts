import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * SQL with the comments removed.
 *
 * The first version of the "no ALTER TABLE" check below matched the migration's
 * own header, which says it "needs no ALTER TABLE, no backfill". A grep that
 * cannot tell code from prose is the exact failure this repo has been unpicking
 * all session, and it caught me writing one.
 */
const code = (sql: string) =>
  sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const MIGRATION = "supabase/migrations/20260912100000_archive_surface_designation_last_update.sql";

// =============================================================================
// The masterlist has 23 columns. Every one is stored verbatim in
// historical_sales_rows.raw — verified 2026-08-25 against the source file and
// production: 679 rows, 653 sales codes, 560 unique, matching exactly.
//
// Fifteen were read by the mapper. Of the eight that were not, two carry real
// data — DESIGNATION (589/679) and LAST UPDATE (483/679) — and six are
// effectively empty. This pins which of those eight are surfaced and which are
// deliberately left in raw, so "we should show all 23" is answered with the
// fill rates rather than re-litigated.
// =============================================================================

describe("every masterlist column that carries data is reachable", () => {
  const sql = read(MIGRATION);

  it("surfaces the two columns that have data", () => {
    expect(sql).toContain("'^DESIGNATION$'");
    expect(sql).toContain("'^LAST UPDATE$'");
    expect(sql).toContain("AS contact_designation");
    expect(sql).toContain("AS last_update_note");
  });

  // Six columns are 1% filled or less; one is entirely empty. Surfacing them
  // would add six permanently blank fields to every record.
  it("does not surface the six empty ones", () => {
    for (const col of ["NOTES", "DATE REQUESTED", "ONEDRIVE", "STATUS$"]) {
      expect(sql).not.toContain(`AS ${col.toLowerCase()}`);
    }
  });

  it("keeps LAST UPDATE as text rather than casting it to a date", () => {
    // 398 of 483 values parse as M/D/YYYY. Casting would silently drop the 85
    // that are notes somebody typed into a date column.
    expect(sql).not.toMatch(/LAST UPDATE\$'\)\s*::\s*date/i);
    expect(sql).not.toMatch(/parse_historical_date\([^)]*LAST UPDATE/i);
  });

  it("lets a person search by job title", () => {
    // "procurement engineer" is 35 rows and a real way to find who you dealt
    // with, so designation joins search_text.
    const searchBlock = sql.slice(sql.indexOf("AS search_text") - 600, sql.indexOf("AS search_text"));
    expect(searchBlock).toContain("'^DESIGNATION$'");
  });

  // The migration replaces a view. If it ever grows an ALTER TABLE or a
  // backfill it stops being safe to re-run, and the whole reason this went in
  // the view is that raw already holds the data.
  it("stays a view replacement — no table change, no backfill", () => {
    const body = code(sql);
    expect(body).toContain("CREATE OR REPLACE VIEW public.historical_sales_search");
    expect(body).not.toMatch(/ALTER TABLE/i);
    expect(body).not.toMatch(/\bUPDATE public\./i);
    expect(body).not.toMatch(/\bINSERT INTO\b/i);
    // Specific DDL forms, not the bare word: the first attempt at this matched
    // "casting would drop them" inside the view's own COMMENT string. Twice in
    // one file, a grep read prose as code.
    expect(body).not.toMatch(/DROP\s+(TABLE|VIEW|COLUMN|FUNCTION)/i);
  });

  it("keeps every column the view already exposed", () => {
    for (const col of ["sales_code", "base_code", "owner_prefix", "company_matched",
                       "status_canonical", "amount", "date_received", "date_submitted",
                       "email_subject", "update_log", "search_text"]) {
      expect(sql, col).toContain(col);
    }
  });
});

describe("the archive row type matches what the view returns", () => {
  it("declares the two new fields", () => {
    const src = read("src/lib/historical-sales.ts");
    expect(src).toContain("contact_designation: string | null;");
    expect(src).toContain("last_update_note: string | null;");
  });

  // The export is "the eight columns the business asked to export". Two more
  // fields being available is not a reason to widen it.
  it("does not quietly widen the CSV export", () => {
    const src = read("src/lib/historical-sales.ts");
    const block = src.slice(src.indexOf("EXPORT_COLUMNS"), src.indexOf("EXPORT_COLUMNS") + 300);
    expect(block).not.toContain("Designation");
    expect(block).not.toContain("Last Update");
  });
});
