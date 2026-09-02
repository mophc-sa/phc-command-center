// =============================================================================
// Transition bridge — reads the SharePoint quotation sheet, reports the drift.
//
// READS AND REPORTS. NEVER WRITES TO opportunities.
// The goal this serves is moving the team into the system. A bridge that wrote
// would defeat that on its first run: a salesperson advances a stage in the
// app, the next sync reads the older spreadsheet row, and their work is gone.
// They would learn the app does not hold, and go back to the sheet -- the exact
// outcome the bridge exists to prevent. So it produces findings for a human,
// and applying them is done in the app, which is itself the habit being built.
//
// The only table it writes is its own run log.
//
// IT IS MEANT TO BE SWITCHED OFF.
// Every run records an adoption figure and a sunset verdict. A temporary bridge
// nobody removes becomes a second system of record forever; this one carries
// the number that says when it is finished.
//
// ---------------------------------------------------------------------------
// WHAT IT NEEDS FROM AZURE (an IT decision, not a code change)
//
//   1. An app registration in the PHC tenant.
//   2. Application permission `Files.Read.All` -- READ only. Never
//      `Files.ReadWrite`: this function has no reason to write to SharePoint,
//      and a credential that cannot write cannot be made to.
//   3. Admin consent for that permission.
//   4. A client secret.
//
// Then four secrets on the function:
//   SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET,
//   SHAREPOINT_SHARE_URL   (the ordinary sharing link -- Graph resolves it, so
//                           nobody has to hunt for a driveId and itemId)
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GRAPH = "https://graph.microsoft.com/v1.0";
const WORKSHEET = "QUOTATION LIST 2022-2026";
/** Header row in the worksheet. Data starts on the next one. */
const HEADER_ROW = 4;

type Cell = string | number | boolean | null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Graph resolves an ordinary sharing URL to a drive item, so the secret can be
 * the link someone already has rather than opaque ids they would have to go
 * and find. The encoding below is Microsoft's documented scheme for it.
 */
function shareId(url: string): string {
  const b64 = btoa(url).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  return "u!" + b64;
}

async function graphToken(): Promise<string> {
  const tenant = Deno.env.get("SHAREPOINT_TENANT_ID");
  const clientId = Deno.env.get("SHAREPOINT_CLIENT_ID");
  const secret = Deno.env.get("SHAREPOINT_CLIENT_SECRET");
  if (!tenant || !clientId || !secret) {
    throw new Error("SHAREPOINT_BRIDGE_NOT_CONFIGURED");
  }
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`GRAPH_AUTH_FAILED_${res.status}`);
  return (await res.json()).access_token as string;
}

/**
 * Reads the used range through the Excel REST API rather than downloading the
 * workbook. Two reasons: the file is 375 KB and growing, and `usedRange`
 * returns *values* -- so a formula arrives as its result, which is what the
 * sheet's reader sees and therefore what the comparison must use.
 */
async function readSheet(token: string, share: string): Promise<Cell[][]> {
  const base = `${GRAPH}/shares/${shareId(share)}/driveItem`;
  const url =
    `${base}/workbook/worksheets('${encodeURIComponent(WORKSHEET)}')` +
    `/usedRange(valuesOnly=true)?$select=values`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GRAPH_READ_FAILED_${res.status}: ${detail.slice(0, 300)}`);
  }
  return ((await res.json()).values ?? []) as Cell[][];
}

const str = (c: Cell): string | null => {
  const v = typeof c === "string" ? c.trim() : c === null || c === undefined ? "" : String(c).trim();
  return v === "" ? null : v;
};
const num = (c: Cell): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const started = new Date().toISOString();
  try {
    const share = Deno.env.get("SHAREPOINT_SHARE_URL");
    if (!share) throw new Error("SHAREPOINT_BRIDGE_NOT_CONFIGURED");

    const token = await graphToken();
    const grid = await readSheet(token, share);

    // Column letters from the workbook: B EMAIL SUBJECT · C DATE RECEIVED ·
    // D JIH/TENDER · E SALES CODE · F PROJECT NAME · G AMOUNT · H STATUS ·
    // K CLIENT COMPANY. usedRange is zero-based from column A.
    const COL = { salesCode: 4, projectName: 5, amount: 6, status: 7, client: 10 };

    const sheetRows = grid
      .map((cells, i) => ({ cells, sheetRow: i + 1 }))
      .filter((r) => r.sheetRow > HEADER_ROW)
      .map((r) => ({
        sheetRow: r.sheetRow,
        projectName: str(r.cells[COL.projectName] ?? null),
        client: str(r.cells[COL.client] ?? null),
        quotationStatus: str(r.cells[COL.status] ?? null)?.toUpperCase() ?? null,
        salesCode: str(r.cells[COL.salesCode] ?? null),
        amount: num(r.cells[COL.amount] ?? null),
      }))
      .filter((r) => r.projectName);

    const { data: opps, error } = await supabase
      .from("opportunities")
      .select("id, project_name, client, quotation_value, extra_data");
    if (error) throw new Error(`READ_OPPORTUNITIES_FAILED: ${error.message}`);

    const systemRows = (opps ?? []).map((o: Record<string, unknown>) => {
      const extra = (o.extra_data ?? {}) as Record<string, unknown>;
      const sr = extra.sheet_row;
      return {
        id: o.id as string,
        projectName: (o.project_name as string) ?? null,
        client: (o.client as string) ?? null,
        quotationValue: o.quotation_value === null ? null : Number(o.quotation_value),
        sourceSheetRow: typeof sr === "number" ? sr : sr ? Number(sr) : null,
        sourceStatus: (extra.quotation_status as string) ?? null,
      };
    });

    // The comparison itself is the pure module in src/lib/sheet-bridge.ts,
    // inlined here because Edge Functions do not share the app's bundle. Its
    // behaviour is pinned by tests there; this is transport only.
    const report = compare(sheetRows, systemRows);

    await supabase.from("sheet_bridge_runs").insert({
      started_at: started,
      sheet_rows: sheetRows.length,
      sheet_only: report.sheetOnly,
      changed: report.changed,
      unchanged: report.unchanged,
      system_only: report.systemOnly,
      adoption: report.adoption,
      shift_suspected: report.shiftSuspected,
      findings: report.findings.filter((f) => f.kind !== "unchanged").slice(0, 500),
    });

    return json({ ok: true, ...report, findings: undefined, findingCount: report.findings.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from("sheet_bridge_runs").insert({ started_at: started, error: message });
    // A configuration gap is not a server fault -- it means nobody has done the
    // Azure side yet, and the caller should be told that rather than "500".
    const status = message === "SHAREPOINT_BRIDGE_NOT_CONFIGURED" ? 501 : 500;
    return json({ ok: false, error: message }, status);
  }
});

// --- inlined from src/lib/sheet-bridge.ts (see the note above) --------------

type SheetRow = {
  sheetRow: number;
  projectName: string | null;
  client: string | null;
  quotationStatus: string | null;
  salesCode: string | null;
  amount: number | null;
};
type FieldDiff = {
  field: "projectName" | "client" | "amount" | "quotationStatus";
  sheet: string | number | null;
  system: string | number | null;
};
type Finding =
  | { kind: "sheet_only"; sheetRow: number; row: SheetRow }
  | { kind: "changed"; sheetRow: number; opportunityId: string; diffs: FieldDiff[] }
  | { kind: "unchanged"; sheetRow: number; opportunityId: string };

type SystemRow = {
  id: string;
  projectName: string | null;
  client: string | null;
  quotationValue: number | null;
  sourceSheetRow: number | null;
  sourceStatus: string | null;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const sameAmount = (a: number | null, b: number | null) =>
  a === null && b === null ? true : a === null || b === null ? false : Math.abs(a - b) < 1;
const SHIFT_SUSPECT_RATIO = 0.5;

function compare(sheet: SheetRow[], system: SystemRow[]) {
  const byRow = new Map<number, SystemRow>();
  let imported = 0;
  let systemOnly = 0;
  for (const s of system) {
    if (s.sourceSheetRow === null) {
      systemOnly++;
      continue;
    }
    imported++;
    if (!byRow.has(s.sourceSheetRow)) byRow.set(s.sourceSheetRow, s);
  }

  const findings: Finding[] = [];
  let changed = 0;
  let unchanged = 0;
  let sheetOnly = 0;

  for (const row of sheet) {
    if (!norm(row.projectName)) continue;
    const match = byRow.get(row.sheetRow);
    if (!match) {
      sheetOnly++;
      findings.push({ kind: "sheet_only", sheetRow: row.sheetRow, row });
      continue;
    }
    const diffs: FieldDiff[] = [];
    if (norm(row.projectName) !== norm(match.projectName))
      diffs.push({ field: "projectName", sheet: row.projectName, system: match.projectName });
    if (norm(row.client) !== norm(match.client))
      diffs.push({ field: "client", sheet: row.client, system: match.client });
    if (!sameAmount(row.amount, match.quotationValue))
      diffs.push({ field: "amount", sheet: row.amount, system: match.quotationValue });
    if (norm(row.quotationStatus) !== norm(match.sourceStatus))
      diffs.push({ field: "quotationStatus", sheet: row.quotationStatus, system: match.sourceStatus });

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
    adoption: systemOnly + imported > 0 ? systemOnly / (systemOnly + imported) : null,
    shiftSuspected: matched > 0 && changed / matched > SHIFT_SUSPECT_RATIO,
  };
}
