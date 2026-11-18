// =============================================================================
// Master quotation list import (Omar's CRM review, point 16; Mo, 2026-11-18).
//
// The rules Mo set while the November 2026 file was applied by hand, now in one
// tested place so a person can run the import from the Master list sync page:
//   · A tender is the NUMBER in its code (any letters before/after) + its value
//     (0.1% tolerance). Names are never a duplicate signal.
//   · The same project quoted to several contractors is one record per
//     contractor; the project value counts once (on the primary record).
//   · Revisions to the same contractor are not new opportunities.
//   · A deal won in the system is never pulled back to open by the file: that
//     is a conflict for a person to decide.
//   · Nothing is written here. The plan is shown, a person decides each row,
//     and the server applies only what was approved (master_list_import).
// The file's own layout (MASTERLIST_Nov2026): A priority · B code · C project ·
// D updated amount · E status · F next action date · G JIH/Tender · H RFQ
// contact · I main client · J location · K last update · L remarks · M–P
// revision amounts (never summed) · Q PO/SCA · R agreement.
// =============================================================================
import { opportunityValue } from "@/lib/opportunity-value";

export type MlRow = {
  row_no: number;
  priority?: string;
  code?: string;
  project?: string;
  amount?: number;
  status?: string;
  next_action_date?: string;
  route?: string;
  rfq_contact?: string;
  client?: string;
  location?: string;
  last_update?: string;
  remarks?: string;
  po_status?: string;
  agreement_status?: string;
};

const COLS = ["priority", "code", "project", "amount", "status", "next_action_date", "route", "rfq_contact", "client", "location", "last_update", "remarks"] as const;

const clean = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/_x000D_/g, "").replace(/\r/g, "").trim();
  return s === "" ? undefined : s;
};

/** A spreadsheet date (Date, ISO text, or Excel serial) as YYYY-MM-DD on the Riyadh calendar. */
export function sheetDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  let d: Date | null = null;
  if (v instanceof Date) d = v;
  else if (typeof v === "number" && v > 20000 && v < 80000) d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000);
  else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) d = new Date(v.length === 10 ? `${v}T12:00:00Z` : v);
  if (!d || Number.isNaN(d.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Rows of the sheet (array of arrays, header row with "Project Code"). Blank and formatting-only rows are dropped. */
export function parseMasterList(aoa: unknown[][]): MlRow[] {
  const h = aoa.findIndex((r) => (r ?? []).some((c) => /project\s*code/i.test(String(c ?? ""))));
  if (h < 0) throw new Error("No header row with “Project Code” found in this sheet.");
  const out: MlRow[] = [];
  aoa.slice(h + 1).forEach((r, i) => {
    const row = (r ?? []) as unknown[];
    const code = clean(row[1]);
    const project = clean(row[2]);
    if (!code && !project) return;
    const rec: MlRow = { row_no: h + 2 + i };
    COLS.forEach((k, j) => {
      const v = row[j];
      if (k === "amount") {
        if (typeof v === "number" && Number.isFinite(v)) rec.amount = v;
      } else if (k === "next_action_date" || k === "last_update") {
        const d = sheetDate(v);
        if (d) rec[k] = d;
      } else {
        const s = clean(v);
        if (s) (rec as Record<string, unknown>)[k] = k === "code" ? s.replace(/\s+/g, "").toUpperCase() : s;
      }
    });
    const po = clean(row[16]);
    const agr = clean(row[17]);
    if (po) rec.po_status = po;
    if (agr) rec.agreement_status = agr;
    out.push(rec);
  });
  return out;
}

export const codeNumber = (c?: string | null) => /\d{5}/.exec(c ?? "")?.[0] ?? null;
const sameValue = (a?: number | null, b?: number | null) =>
  a != null && b != null && a > 0 && b > 0 && Math.abs(a - b) <= 0.001 * Math.max(a, b);
const normCode = (c?: string | null) => (c ?? "").replace(/\s+/g, "").toUpperCase().replace(/_X000D_/g, "");

/** The contractor a row was quoted to: the first segment of the RFQ contact. */
export function rfqEntity(t?: string): string | null {
  const s = (t ?? "").replace(/\r/g, "").split(/\||\t|\n/)[0]?.trim().toUpperCase().slice(0, 30);
  return s ? s : null;
}

export type ParsedContact = { company?: string; name?: string; title?: string; email?: string; phone?: string };
export function parseContact(t?: string): ParsedContact | null {
  if (!t) return null;
  const text = t.replace(/\r/g, "");
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(text)?.[0];
  const phone = /(?:\+?966|00966)?[\s-]*\(?0?5\d(?:[\s-]*\d){7,8}/.exec(text)?.[0]?.replace(/\s+/g, " ").trim();
  const sep = text.includes("|") ? "|" : text.includes("\t") ? "\t" : "\n";
  const toks = text.split(sep).map((x) =>
    x.trim().replace(/^["']|["']$/g, "")
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "").replace(/[\d+()\s-]{8,}/g, "")
      .replace(/((Mob(ile)?|Tel|Email)\s*[:.]?|\b[EMT]\s*[:.])\s*$/i, "")
      .replace(/^(Mob(ile)?|Tel|Email|E|M|T)\s*[:.]\s*/i, "").replace(/^[\s:/,-]+|[\s:/,-]+$/g, "").trim(),
  ).filter((x) => x && !/^(Mob(ile)?|Tel|Email|E|M|T)$/i.test(x));
  const companyFirst = sep === "|" || (toks.length >= 2 && /(co\.|ltd|group|contract|company|engineering|construction|\(.*\))/i.test(toks[0]));
  const title = companyFirst ? toks[2] : toks[1];
  let company = companyFirst ? toks[0] : toks.length > 2 ? toks[toks.length - 1] : undefined;
  let name: string | undefined = companyFirst ? toks[1] : toks[0];
  if (name && (name.length > 60 || !/[A-Za-z\u0600-\u06FF]/.test(name))) name = undefined;
  if (name && !email && !phone && toks.length === 1 && sep !== "|") [company, name] = [name, undefined];
  const out: ParsedContact = { company, name, title, email, phone };
  return Object.values(out).some(Boolean) ? out : null;
}

/** Column E (and A for hold / dead) as a sales stage. Never invents a stage for an unknown status. */
export function targetStage(r: MlRow): string | null {
  const st = (r.status ?? "").toUpperCase();
  const pr = (r.priority ?? "").toUpperCase();
  if (st === "WON") return "won";
  if (st === "LOST") return "lost";
  if (pr === "DEAD PROJECT") return "lost";
  if (pr === "ON-HOLD") return "on_hold";
  if (st.includes("AWARD")) return "verbally_awarded";
  if (st.includes("DISCOUNT")) return "jih_bafo";
  if (st.startsWith("SUBMITTED")) return "jih";
  if (st === "NOT SUBMITTED") return "rfq_received";
  return null;
}

const OPEN_ORDER = ["rfq_received", "jih", "jih_bafo", "under_negotiation", "verbally_awarded", "contract_received", "contract_signed", "won"];

export type ExistingDeal = {
  id: string;
  stage: string | null;
  sales_stage: string | null;
  quotation_value: number | null;
  contract_value: number | null;
  project_name: string | null;
  code: string | null;
  created_at: string;
  has_master_list: boolean;
  duplicate_of: string | null;
  value_counted_on: string | null;
  owner_id: string | null;
  last_activity_at: string | null;
};

export type PlanKind = "update" | "create" | "restore" | "conflict" | "unknown_status";
export type PlanItem = {
  key: string;
  kind: PlanKind;
  /** The deal written (update/restore), or null for a new one. */
  dealId: string | null;
  /** Secondary contractor quotation: the deal its value is counted on. */
  countedOn: string | null;
  row: MlRow;
  /** Every file row this record stands for (same tender, same contractor). */
  rowNos: number[];
  codes: string[];
  stage: string | null;
  changes: Record<string, unknown>;
  reason: string;
  /** Default decision: apply. Conflicts default to keeping the system. */
  apply: boolean;
};

const val = (d: ExistingDeal) => opportunityValue(d);

/** The plan for a file against the deals in the system. Pure: nothing is written. */
export function planImport(rows: MlRow[], deals: ExistingDeal[], ownerByPrefix: Record<string, string | null>): PlanItem[] {
  const live = deals.filter((d) => d.stage !== "archived");
  const byId = new Map(deals.map((d) => [d.id, d]));
  const claimed = new Set<string>();
  const projectKey = (s?: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  // 1. Tenders: number + value. A row whose code has no number joins a tender
  //    with the same project and the same value (another contractor for it).
  type Group = { num: string | null; value: number | null; project: string; entities: MlRow[][]; deal: ExistingDeal | null; restore: boolean; how: string };
  const groups: Group[] = [];
  const addRow = (g: Group, r: MlRow) => {
    const e = rfqEntity(r.rfq_contact) ?? `row${r.row_no}`;
    const hit = g.entities.find((rs) => (rfqEntity(rs[0].rfq_contact) ?? `row${rs[0].row_no}`) === e);
    if (hit) hit.push(r);
    else g.entities.push([r]);
  };
  for (const r of rows.filter((x) => codeNumber(x.code))) {
    const num = codeNumber(r.code);
    let g = groups.find((x) => x.num === num && sameValue(x.value, r.amount ?? null));
    if (!g) groups.push((g = { num, value: r.amount ?? null, project: projectKey(r.project), entities: [], deal: null, restore: false, how: "new tender" }));
    addRow(g, r);
  }
  for (const r of rows.filter((x) => !codeNumber(x.code))) {
    const g = groups.find((x) => x.num && sameValue(x.value, r.amount ?? null) && x.project === projectKey(r.project));
    if (g) addRow(g, r);
    else groups.push({ num: null, value: r.amount ?? null, project: projectKey(r.project), entities: [[r]], deal: null, restore: false, how: "new" });
  }
  const allCodes = (g: Group) => new Set(g.entities.flat().map((r) => normCode(r.code)));
  const codeUse = new Map<string, number>();
  for (const g of groups) for (const c of allCodes(g)) codeUse.set(c, (codeUse.get(c) ?? 0) + 1);
  const take = (g: Group, d: ExistingDeal, how: string, restore = false) => { g.deal = d; g.how = how; g.restore = restore; claimed.add(d.id); };

  // 2. Each tender's deal, in passes across the whole file so a value match is
  //    never taken by an earlier row's code-only match.
  for (const g of groups) {
    if (!g.num) continue;
    const a = live.filter((d) => codeNumber(d.code) === g.num && sameValue(val(d), g.value) && !claimed.has(d.id) && !d.value_counted_on)
      .sort((x, y) => Number(y.has_master_list) - Number(x.has_master_list) || x.created_at.localeCompare(y.created_at));
    if (a[0]) take(g, a[0], "number + value");
  }
  for (const g of groups) {
    if (!g.num || g.deal) continue;
    const arch = deals.find((d) => d.stage === "archived" && codeNumber(d.code) === g.num && sameValue(val(d), g.value) && !claimed.has(d.id) && !d.value_counted_on);
    if (!arch) continue;
    const kept = arch.duplicate_of ? byId.get(arch.duplicate_of) : undefined;
    if (kept && kept.stage !== "archived" && sameValue(val(kept), g.value) && !claimed.has(kept.id)) take(g, kept, "archived copy → kept deal");
    else take(g, arch, "archived as a duplicate of a different value — restored", true);
  }
  for (const g of groups) {
    if (!g.num || g.deal) continue;
    const codes = allCodes(g);
    const exact = live.filter((d) => codes.has(normCode(d.code)) && !claimed.has(d.id) && !d.value_counted_on);
    if (exact.length === 1 && [...codes].every((c) => codeUse.get(c) === 1)) take(g, exact[0], "same code, value revised");
  }
  for (const g of groups) {
    if (g.num || g.deal) continue;
    const d = live.find((x) => projectKey(x.project_name) === g.project && !/\d/.test(x.code ?? "") && !claimed.has(x.id));
    if (d) take(g, d, "code without number, same project name");
  }

  const rank = (r: MlRow) => {
    const st = (r.status ?? "").toUpperCase();
    return st === "WON" ? 0 : st.includes("AWARD") ? 1 : st === "LOST" ? 3 : 2;
  };
  const keyRow = (rs: MlRow[]) =>
    [...rs].sort((a, b) => rank(a) - rank(b) || (b.last_update ?? "").localeCompare(a.last_update ?? ""))[0];

  // 3. Within a tender, pair each contractor with its own record by code: the
  //    deal itself, an existing second-contractor record, or an archived copy.
  const items: PlanItem[] = [];
  for (const g of groups) {
    const P = g.deal;
    const secondaries = P ? live.filter((d) => d.value_counted_on === P.id && !claimed.has(d.id)) : [];
    const has = (rs: MlRow[], d: ExistingDeal | null | undefined) => !!d && rs.some((r) => normCode(r.code) === normCode(d.code));
    const pairs: { rs: MlRow[]; deal: ExistingDeal | null; restore: boolean; primary: boolean; how: string }[] = [];
    let primaryTaken = false;
    const rest: MlRow[][] = [];
    for (const rs of g.entities) {
      if (P && !primaryTaken && has(rs, P)) { pairs.push({ rs, deal: P, restore: g.restore, primary: true, how: g.how }); primaryTaken = true; continue; }
      const sec = secondaries.find((d) => has(rs, d) && !claimed.has(d.id));
      if (sec) { claimed.add(sec.id); pairs.push({ rs, deal: sec, restore: false, primary: false, how: "another contractor for the same tender (value counted once)" }); continue; }
      rest.push(rs);
    }
    for (const rs of rest) {
      if (!primaryTaken) { pairs.push({ rs, deal: P, restore: g.restore, primary: true, how: g.how }); primaryTaken = true; continue; }
      const arch = deals.find((d) => d.stage === "archived" && has(rs, d) && !claimed.has(d.id) && (val(d) == null || sameValue(val(d), g.value)));
      if (arch) claimed.add(arch.id);
      pairs.push({ rs, deal: arch ?? null, restore: !!arch, primary: false, how: "another contractor for the same tender (value counted once)" });
    }
    const prim = pairs.find((x) => x.primary)!;
    const primaryItem = toItem(prim.rs, prim.deal, prim.restore, null, prim.how);
    items.push(primaryItem);
    for (const x of pairs) if (!x.primary) items.push(toItem(x.rs, x.deal, x.restore, primaryItem.dealId ?? primaryItem.key, x.how));
  }
  return items;
  function toItem(rs: MlRow[], deal: ExistingDeal | null, restore: boolean, countedOn: string | null, how: string): PlanItem {
    const row = keyRow(rs);
    const stage = targetStage(row);
    const key = `r${rs.map((r) => r.row_no).join("-")}`;
    const base = { key, dealId: deal?.id ?? null, countedOn, row, rowNos: rs.map((r) => r.row_no), codes: [...new Set(rs.map((r) => r.code ?? ""))].filter(Boolean), stage };
    if (!stage) return { ...base, kind: "unknown_status", changes: {}, reason: `Status not recognised: ${row.status ?? "(empty)"}`, apply: false };
    const prefix = /^[A-Z]+/.exec(row.code ?? "")?.[0] ?? "";
    if (!deal) {
      const changes = { sales_stage: stage, quotation_value: countedOn ? null : row.amount ?? null, owner_id: ownerByPrefix[prefix] ?? null };
      // Same number as a deal already in the system but another value: a new
      // tender, or the same one revised? Only a person can say (e.g. KSP OM23077).
      const num = codeNumber(row.code);
      const kin = num && !countedOn ? live.filter((d) => codeNumber(d.code) === num) : [];
      if (kin.length) {
        return { ...base, kind: "conflict", changes, reason: `Same number as ${kin.map((d) => `${d.code} (${val(d) ?? "no value"})`).join(", ")} with a different value — a new tender, or the same one?`, apply: false };
      }
      return { ...base, kind: "create", changes, reason: how, apply: true };
    }
    const cur = deal.sales_stage ?? "jih";
    const ch: Record<string, unknown> = {};
    if (["won", "lost", "on_hold"].includes(stage)) {
      if (stage !== cur) {
        if (cur === "won") return { ...base, kind: "conflict", changes: { sales_stage: stage }, reason: `Won in the system, ${stage.replace("_", " ")} in the file`, apply: false };
        ch.sales_stage = stage;
      }
    } else if (cur === "won") {
      return { ...base, kind: "conflict", changes: { sales_stage: stage }, reason: "Won in the system, open in the file", apply: false };
    } else if (cur === "lost" || cur === "on_hold" || OPEN_ORDER.indexOf(stage) > OPEN_ORDER.indexOf(cur)) {
      ch.sales_stage = stage;
    }
    // Within 0.1% is the same value (typos, decimals); a person's exact figure stays.
    if (!countedOn && row.amount && !sameValue(deal.quotation_value, row.amount)) ch.quotation_value = row.amount;
    if (row.last_update && (!deal.last_activity_at || deal.last_activity_at.slice(0, 10) < row.last_update)) ch.last_activity_at = row.last_update;
    if (!deal.owner_id && ownerByPrefix[prefix]) ch.owner_id = ownerByPrefix[prefix];
    return { ...base, kind: restore ? "restore" : "update", changes: ch, reason: how, apply: true };
  }
}
