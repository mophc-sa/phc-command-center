// =============================================================================
// The transition bridge: SharePoint sheet → this system, one way, temporarily.
//
// WHY IT READS AND REPORTS, AND NEVER WRITES
// The goal is to move the team into the system. A bridge that writes defeats
// that on day one: a salesperson updates a stage in the app, the next sync
// reads the older spreadsheet row, and their work is overwritten. They learn
// that the app does not hold, and they go back to the sheet. The bridge would
// have caused exactly the outcome it was built to prevent.
//
// So this compares and reports. A human applies what should be applied, in the
// app, and that act is itself the habit the transition is trying to build.
//
// WHY IT MEASURES ITS OWN OBSOLESCENCE
// A temporary bridge nobody turns off becomes permanent, and then there are two
// systems of record forever. `adoption` counts work that exists only in the
// system -- deals entered by a person, not carried in by an import. When that
// share is high and `sheetOnly` is near zero, the sheet has stopped being where
// work happens and the bridge can be switched off. That is a number, not an
// opinion, and it is the only honest signal for when to stop.
//
// Pure and transport-free: this takes rows that someone else fetched. The Graph
// call, the credentials and the schedule live in the Edge Function; everything
// here is testable without a network or a tenant.
// =============================================================================

/** A row as it appears in the workbook, already normalised by the caller. */
export type SheetRow = {
  /** 1-based row number in the worksheet. The join key -- see `IMPORT_KEY`. */
  sheetRow: number;
  projectName: string | null;
  client: string | null;
  /** The sheet's own status vocabulary, e.g. SUBMITTED / LOST / WON. */
  quotationStatus: string | null;
  salesCode: string | null;
  amount: number | null;
};

/** An opportunity as it currently stands in the system. */
export type SystemRow = {
  id: string;
  projectName: string | null;
  client: string | null;
  quotationValue: number | null;
  /** From extra_data. Null for anything a person created in the app. */
  sourceSheetRow: number | null;
  /** From extra_data. Null for anything a person created in the app. */
  sourceStatus: string | null;
};

/**
 * What identifies "the same row" across a re-read.
 *
 * The original import stored the worksheet row number in
 * `extra_data->>'sheet_row'`, which is what makes a second read a comparison
 * rather than a duplication. It is not a perfect key -- inserting a row in the
 * middle of the sheet shifts every number below it -- so `shiftSuspected` below
 * exists to notice that rather than to silently report hundreds of changes.
 */
export const IMPORT_KEY = "sheet_row";

export type FieldDiff = {
  field: "projectName" | "client" | "amount" | "quotationStatus";
  sheet: string | number | null;
  system: string | number | null;
};

export type Finding =
  | { kind: "sheet_only"; sheetRow: number; row: SheetRow }
  | { kind: "changed"; sheetRow: number; opportunityId: string; diffs: FieldDiff[] }
  | { kind: "unchanged"; sheetRow: number; opportunityId: string };

export type BridgeReport = {
  findings: Finding[];
  /** Rows present in the sheet with no counterpart here. Work to bring over. */
  sheetOnly: number;
  changed: number;
  unchanged: number;
  /**
   * Opportunities that exist only in the system -- created by a person, never
   * imported. The adoption signal: when this grows and `sheetOnly` does not,
   * the team has moved and the bridge has done its job.
   */
  systemOnly: number;
  /** systemOnly / (systemOnly + imported), 0-1. Null when there is nothing yet. */
  adoption: number | null;
  /**
   * True when the sheet appears to have had rows inserted or deleted, which
   * shifts every row number below the change and would otherwise surface as a
   * flood of false "changed" findings. A human should re-anchor before trusting
   * the diff.
   */
  shiftSuspected: boolean;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Money differing by under a riyal is not a change anyone made. */
const sameAmount = (a: number | null, b: number | null) => {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1;
};

/**
 * Above this share of matched rows reporting a change, the likelier
 * explanation is that row numbers shifted -- not that the team edited most of
 * the sheet in one day.
 */
const SHIFT_SUSPECT_RATIO = 0.5;

export function compareSheet(sheet: readonly SheetRow[], system: readonly SystemRow[]): BridgeReport {
  const byRow = new Map<number, SystemRow>();
  let importedCount = 0;
  let systemOnly = 0;
  for (const s of system) {
    if (s.sourceSheetRow === null) {
      systemOnly++;
      continue;
    }
    importedCount++;
    // First one wins. A duplicate sheet_row means the import ran twice; that is
    // a data problem to fix, not a reason for the bridge to pick arbitrarily.
    if (!byRow.has(s.sourceSheetRow)) byRow.set(s.sourceSheetRow, s);
  }

  const findings: Finding[] = [];
  let changed = 0;
  let unchanged = 0;
  let sheetOnly = 0;

  for (const row of sheet) {
    // A row with no project name is not a deal; the import skipped these too.
    if (!norm(row.projectName)) continue;

    const match = byRow.get(row.sheetRow);
    if (!match) {
      sheetOnly++;
      findings.push({ kind: "sheet_only", sheetRow: row.sheetRow, row });
      continue;
    }

    const diffs: FieldDiff[] = [];
    if (norm(row.projectName) !== norm(match.projectName)) {
      diffs.push({ field: "projectName", sheet: row.projectName, system: match.projectName });
    }
    if (norm(row.client) !== norm(match.client)) {
      diffs.push({ field: "client", sheet: row.client, system: match.client });
    }
    if (!sameAmount(row.amount, match.quotationValue)) {
      diffs.push({ field: "amount", sheet: row.amount, system: match.quotationValue });
    }
    if (norm(row.quotationStatus) !== norm(match.sourceStatus)) {
      // The status the sheet carried at import time is stored verbatim, so a
      // change here means someone moved the deal in the SHEET -- which is the
      // thing the transition is trying to stop, and worth showing plainly.
      diffs.push({ field: "quotationStatus", sheet: row.quotationStatus, system: match.sourceStatus });
    }

    if (diffs.length) {
      changed++;
      findings.push({ kind: "changed", sheetRow: row.sheetRow, opportunityId: match.id, diffs });
    } else {
      unchanged++;
      findings.push({ kind: "unchanged", sheetRow: row.sheetRow, opportunityId: match.id });
    }
  }

  const matched = changed + unchanged;
  return {
    findings,
    sheetOnly,
    changed,
    unchanged,
    systemOnly,
    adoption: systemOnly + importedCount > 0 ? systemOnly / (systemOnly + importedCount) : null,
    shiftSuspected: matched > 0 && changed / matched > SHIFT_SUSPECT_RATIO,
  };
}

export type SunsetVerdict = {
  ready: boolean;
  /** Plain reason, shown to whoever is deciding. Never just a boolean. */
  reasonAr: string;
  reasonEn: string;
};

/**
 * Whether the bridge has done its job and can be switched off.
 *
 * Two conditions, and both are needed. High adoption alone is not enough: the
 * team could be entering new work in the app while still maintaining the sheet
 * for old deals, and cutting the bridge then loses those edits. A quiet sheet
 * alone is not enough either -- it may just be a slow week.
 */
export function sunsetVerdict(
  report: BridgeReport,
  opts: { minAdoption?: number; maxSheetOnly?: number } = {},
): SunsetVerdict {
  const minAdoption = opts.minAdoption ?? 0.6;
  const maxSheetOnly = opts.maxSheetOnly ?? 0;
  const a = report.adoption;

  if (a === null) {
    return {
      ready: false,
      reasonAr: "لا بيانات كافية للحكم بعد.",
      reasonEn: "Not enough data to judge yet.",
    };
  }
  if (report.sheetOnly > maxSheetOnly) {
    return {
      ready: false,
      reasonAr: `الورقة ما زالت تُستعمل: ${report.sheetOnly} صفًّا جديدًا فيها ليس في النظام.`,
      reasonEn: `The sheet is still in use: ${report.sheetOnly} new rows are not in the system.`,
    };
  }
  if (a < minAdoption) {
    return {
      ready: false,
      reasonAr: `التبنّي ${Math.round(a * 100)}% — دون الحدّ (${Math.round(minAdoption * 100)}%).`,
      reasonEn: `Adoption is ${Math.round(a * 100)}% — below the ${Math.round(minAdoption * 100)}% bar.`,
    };
  }
  return {
    ready: true,
    reasonAr: `التبنّي ${Math.round(a * 100)}% ولا صفوف جديدة في الورقة — يمكن فصل الجسر.`,
    reasonEn: `Adoption is ${Math.round(a * 100)}% and the sheet has no new rows — the bridge can be switched off.`,
  };
}
