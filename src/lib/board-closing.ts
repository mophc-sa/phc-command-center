// =============================================================================
// The wall board's closing view, built from the November 2026 master list
// (PHC_Quotation_Masterlist_Updated November 2026.xlsx, sheet MASTERLIST_Nov2026),
// which the data sync stores on each deal as extra_data.master_list_2026_11.
//
// Brief (Mo, 2026-11-17): the board prioritises closing — verbal awards first,
// column A drives the follow-up queues, JIH and Tender are separate views, held
// deals are counted apart from active ones, and every total opens the records
// behind it. Missing dates are shown as missing, never guessed.
//
// Column map: A priority · B code · C project · D updated amount · E status ·
// F next action date · G JIH/Tender · H RFQ contact · I main client · J location ·
// K last update · L remarks.
//
// Contractor quotations (Mo, 2026-11-17): the same project quoted to several
// contractors is one record per contractor, but the project's value counts
// once — on the primary record. A secondary record carries quotation_value NULL
// and extra_data.value_counted_on; it is NOT "unvalued".
// =============================================================================
import { opportunityValue } from "@/lib/opportunity-value";
import { resolveCanonicalStage, type CanonicalStage } from "@/lib/stage-canonical";
import { riyadhDay } from "@/lib/riyadh-day";

export type ClosingOpp = {
  id: string;
  project_name: string | null;
  owner_id: string | null;
  stage: string | null;
  sales_stage?: string | null;
  contract_value: number | string | null;
  quotation_value: number | string | null;
  estimated_value_max?: number | string | null;
  next_action?: string | null;
  next_action_due?: string | null;
  last_activity_at?: string | null;
  won_at?: string | null;
  hold_reason?: string | null;
  /** The stage kept while on hold (2026-11-18). */
  hold_from_stage?: string | null;
  contract_signed_date?: string | null;
  contract_received_date?: string | null;
  extra_data?: Record<string, unknown> | null;
};

export type Route = "jih" | "tender" | "unknown";
export type PriorityKey =
  | "verbal_a"
  | "follow_up"
  | "priority_b"
  | "on_hold"
  | "dead"
  | "not_priority"
  | "none";

export type Rec = {
  id: string;
  project: string;
  code: string | null;
  ownerId: string | null;
  /** The value that counts in totals. Null on a secondary contractor quote (counted on its primary). */
  value: number | null;
  /** What this record quoted, including a secondary contractor's own amount. */
  quoted: number | null;
  secondary: boolean;
  stage: CanonicalStage | null;
  /** True when the stage came from a fallback, not a recorded sales stage. */
  unmappedStage: boolean;
  /** Column E as written. */
  status: string | null;
  /** Column A as written. */
  priority: string | null;
  priorityKey: PriorityKey;
  route: Route;
  /** Column G as written (or the older list's JIH/Tender). */
  routeLabel: string | null;
  lastUpdate: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  /** The actual RFQ received date from the linked source record; null when missing. */
  received: string | null;
  year: number | null;
  /** Where `year` came from: the RFQ received date, or the code (labelled fallback). */
  yearBasis: "received" | "code" | null;
  held: boolean;
  /** The hold as the source wrote it, and its reason when recorded. */
  holdLabel: string | null;
  holdReason: string | null;
  open: boolean;
  wonAt: string | null;
  /** The contract or PO date — signed sales count only from it (2026-11-18). */
  signedAt: string | null;
  /** How the won date is known. No contract date is recorded today, so this is mostly "master_list". */
  wonDateBasis: "contract" | "master_list" | null;
  remarks: string | null;
};

const OPEN: CanonicalStage[] = [
  "qualified",
  "rfq_received",
  "pricing",
  "jih",
  "jih_bafo",
  "under_negotiation",
  "verbally_awarded",
  "contract_received",
  "contract_signed",
  "on_hold",
];

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

export function priorityKeyOf(p: string | null): PriorityKey {
  const u = (p ?? "").toUpperCase().trim();
  if (!u) return "none";
  if (u.startsWith("PRIORITY - A") || u.startsWith("PRIORITY A")) return "verbal_a";
  if (u === "PRIORITY B" || u.startsWith("PRIORITY - B")) return "priority_b";
  if (u.startsWith("NEED FOLLOW")) return "follow_up";
  if (u.includes("HOLD")) return "on_hold";
  if (u.startsWith("DEAD")) return "dead";
  if (u.startsWith("NOT PRIORITY")) return "not_priority";
  return "none";
}

export function routeOf(label: string | null): Route {
  const u = (label ?? "").toUpperCase();
  if (u.startsWith("JIH")) return "jih";
  if (u.startsWith("TENDER")) return "tender";
  return "unknown";
}

/** FA25106 → 2025. Only a fallback: the code says when it was numbered, not when the RFQ came in. */
export function codeYear(code: string | null): number | null {
  const m = /^[A-Z]+(\d{2})\d{3}/.exec((code ?? "").toUpperCase().replace(/\s+/g, ""));
  if (!m) return null;
  const y = 2000 + Number(m[1]);
  return y >= 2020 && y <= 2035 ? y : null;
}

export function toRec(o: ClosingOpp): Rec {
  const x = (o.extra_data ?? {}) as Record<string, unknown>;
  const nov = (x.master_list_2026_11 ?? null) as Record<string, unknown> | null;
  const sept = (x.master_list ?? null) as Record<string, unknown> | null;
  const resolved = resolveCanonicalStage({ sales_stage: o.sales_stage, stage: o.stage });
  const stage = resolved.stage;
  const secondary = typeof x.value_counted_on === "string";
  const own = opportunityValue(o);
  const contractorQuote =
    typeof x.contractor_quote_value === "number"
      ? x.contractor_quote_value
      : Number(x.contractor_quote_value ?? NaN);
  const code = str(nov?.code) ?? str(x.sales_code) ?? str(x.source_sales_code);
  const priority = str(nov?.priority);
  const routeLabel = str(nov?.route) ?? str(x.jih_tender) ?? str(sept?.route);
  const received = day(sept?.received) ?? day(x.source_date_received);
  const cy = codeYear(code);
  const pk = priorityKeyOf(priority);
  const held = stage === "on_hold" || (pk === "on_hold" && stage !== "won" && stage !== "lost");
  const signed = day(o.contract_signed_date) ?? day(o.contract_received_date);
  return {
    id: o.id,
    project: o.project_name ?? code ?? "—",
    code,
    ownerId: o.owner_id,
    value: secondary ? null : own,
    quoted: own ?? (Number.isFinite(contractorQuote) ? contractorQuote : null),
    secondary,
    stage,
    unmappedStage: resolved.source === "inferred",
    status: str(nov?.status) ?? str(x.quotation_status),
    priority,
    priorityKey: pk,
    route: routeOf(routeLabel),
    routeLabel,
    lastUpdate: day(nov?.last_update) ?? day(o.last_activity_at),
    nextAction: str(o.next_action),
    nextActionDate: day(nov?.next_action_date) ?? day(o.next_action_due),
    received,
    year: received ? Number(received.slice(0, 4)) : cy,
    yearBasis: received ? "received" : cy ? "code" : null,
    held,
    holdLabel: held
      ? `${pk === "on_hold" ? priority : "On hold"}${o.hold_from_stage ? ` · kept at ${o.hold_from_stage.replace(/_/g, " ")}` : ""}`
      : null,
    holdReason: held ? str(o.hold_reason) : null,
    open: !!stage && OPEN.includes(stage),
    wonAt: stage === "won" ? (signed ?? (o.won_at ? riyadhDay(new Date(o.won_at)) : null)) : null,
    wonDateBasis: stage === "won" ? (signed ? "contract" : o.won_at ? "master_list" : null) : null,
    signedAt: stage === "won" || stage === "contract_received" || stage === "contract_signed" ? signed : null,
    remarks: str(nov?.remarks),
  };
}

export type Bucket = { rows: Rec[]; count: number; value: number };
export function bucket(rows: Rec[]): Bucket {
  return { rows, count: rows.length, value: rows.reduce((a, r) => a + (r.value ?? 0), 0) };
}
const byValue = (a: Rec, b: Rec) => (b.value ?? b.quoted ?? 0) - (a.value ?? a.quoted ?? 0);

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** Verbal awards: confirmed in column E, and column A priority still to reconcile. Never won. */
export function verbalAwards(recs: Rec[]) {
  const confirmed = recs.filter((r) => r.open && r.stage === "verbally_awarded").sort(byValue);
  // A later Won / Lost (the current status) overrides an older verbal-award mention.
  const reconcile = recs
    .filter((r) => r.priorityKey === "verbal_a" && r.open && r.stage !== "verbally_awarded")
    .sort(byValue);
  return {
    confirmed: bucket(confirmed),
    reconcile: bucket(reconcile),
    all: bucket([...confirmed, ...reconcile]),
  };
}

export type ClosingGroup = { key: "verbal" | "direct_2026" | "priority"; rows: Rec[] };

/** Priority opportunities to close: verbal awards → open 2026 JIH-Direct → column A priority; holds apart. */
export function closingList(recs: Rec[], thisYear: number) {
  const seen = new Set<string>();
  const take = (rows: Rec[]) => rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).sort(byValue);
  const active = recs.filter((r) => r.open && !r.held);
  const v = verbalAwards(recs);
  const verbal = take([...v.confirmed.rows, ...v.reconcile.rows].filter((r) => !r.held));
  const direct = take(
    active.filter((r) => r.year === thisYear && /JIH\s*-\s*DIRECT/i.test(r.routeLabel ?? "")),
  );
  const priority = take(
    active.filter((r) => ["verbal_a", "priority_b", "follow_up"].includes(r.priorityKey)),
  );
  const holds = recs.filter((r) => r.open && r.held).sort(byValue);
  return {
    groups: [
      { key: "verbal", rows: verbal },
      { key: "direct_2026", rows: direct },
      { key: "priority", rows: priority },
    ] as ClosingGroup[],
    holds: bucket(holds),
  };
}

/** Open pipeline by classification: JIH (active vs held) and Tender kept apart. */
export function pipelineByRoute(recs: Rec[]) {
  const open = recs.filter((r) => r.open);
  const part = (route: Route) => ({
    active: bucket(open.filter((r) => r.route === route && !r.held)),
    held: bucket(open.filter((r) => r.route === route && r.held)),
  });
  return {
    jih: part("jih"),
    tender: part("tender"),
    unknown: part("unknown"),
    unmapped: bucket(recs.filter((r) => r.unmappedStage)),
  };
}

/** RFQs by their actual received date. Records without one are reported, never placed by another date. */
export function rfqIntake(recs: Rec[], today: string) {
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const year = today.slice(0, 4);
  const last30 = recs.filter((r) => r.received && r.received > from && r.received <= today);
  const months = Array.from({ length: Number(today.slice(5, 7)) }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month: m, ...bucket(recs.filter((r) => r.received?.startsWith(m))) };
  });
  const missing = recs.filter((r) => !r.received);
  return {
    last30: bucket(last30.sort(byValue)),
    months,
    missing: bucket(missing),
    coverage: recs.length ? (recs.length - missing.length) / recs.length : null,
  };
}

/**
 * Signed sales year to date against the company target (Mo, 2026-11-18): a deal
 * counts once its contract or PO is recorded, by that document's date. Won deals
 * without a document are listed as missing, never counted.
 */
export function targetYtd(recs: Rec[], today: string, target: number | null) {
  const year = today.slice(0, 4);
  const ytd = recs.filter((r) => r.signedAt && r.signedAt >= `${year}-01-01` && r.signedAt <= today);
  const undated = recs.filter((r) => r.stage === "won" && !r.signedAt);
  const b = bucket(ytd.sort(byValue));
  const quarters = [1, 2, 3, 4].map((q) =>
    bucket(ytd.filter((r) => Math.ceil(Number(r.signedAt!.slice(5, 7)) / 3) === q)),
  );
  return {
    won: b,
    target,
    ratio: target ? b.value / target : null,
    remaining: target ? Math.max(target - b.value, 0) : null,
    quarters,
    /** Won without a contract or PO recorded: not counted until one is entered. */
    undated: bucket(undated),
  };
}

/** Column A drives the queues; column F decides overdue; missing dates stay missing. */
export function attentionQueues(recs: Rec[], today: string) {
  const open = recs.filter((r) => r.open);
  const q = (k: PriorityKey) =>
    bucket(open.filter((r) => r.priorityKey === k && (k === "on_hold" || !r.held)).sort(byValue));
  const queue = [
    ...open.filter(
      (r) => ["verbal_a", "follow_up", "priority_b"].includes(r.priorityKey) && !r.held,
    ),
  ];
  return {
    closing: q("verbal_a"),
    followUp: q("follow_up"),
    secondary: q("priority_b"),
    holdReview: bucket(open.filter((r) => r.held).sort(byValue)),
    overdue: bucket(
      queue.filter((r) => r.nextActionDate && r.nextActionDate < today).sort(byValue),
    ),
    dueSoon: bucket(
      queue.filter(
        (r) =>
          r.nextActionDate &&
          r.nextActionDate >= today &&
          daysBetween(today, r.nextActionDate) <= 7,
      ),
    ),
    missingDate: bucket(queue.filter((r) => !r.nextActionDate)),
    excludedDead: recs.filter((r) => r.priorityKey === "dead").length,
    excludedNotPriority: open.filter((r) => r.priorityKey === "not_priority").length,
  };
}

export const daysSince = (d: string | null, today: string) => (d ? daysBetween(d, today) : null);

/** Per representative, from the latest status only. */
export function repSummary(recs: Rec[], ownerId: string, today: string) {
  const mine = recs.filter((r) => r.ownerId === ownerId);
  const v = verbalAwards(mine);
  const t = targetYtd(mine, today, null);
  const openMine = mine.filter((r) => r.open);
  return {
    verbal: v.confirmed,
    reconcile: v.reconcile,
    openJih: bucket(openMine.filter((r) => r.route === "jih" && !r.held)),
    wonYtd: t.won,
    followUps: bucket(openMine.filter((r) => r.priorityKey === "follow_up")),
    overdue: bucket(
      openMine.filter(
        (r) => r.nextActionDate && r.nextActionDate < today && r.priorityKey !== "not_priority",
      ),
    ),
  };
}

const ENGAGEMENT = [
  /meet|met\b/i,
  /visit/i,
  /call(ed|s)?\b|phone/i,
  /negotiat/i,
  /revis|discount|BAFO/i,
  /request(ed)?/i,
  /verbal|commit|award/i,
];
export function engagementOf(remarks: string | null): number {
  if (!remarks) return 0;
  return ENGAGEMENT.reduce((a, re) => a + (re.test(remarks) ? 1 : 0), 0);
}

/** Unresolved JIH opportunities that originated July–December 2025, by the RFQ received date. */
export function redFlags2025(recs: Rec[], today: string) {
  const cand = recs.filter((r) => r.open && r.route === "jih");
  const rows = cand
    .map((r) => {
      const inPeriod = r.received ? r.received >= "2025-07-01" && r.received <= "2025-12-31" : null;
      return {
        rec: r,
        inPeriod,
        engagement: engagementOf(r.remarks),
        daysInactive: daysSince(r.lastUpdate, today),
      };
    })
    // Confirmed by its received date, or a 2025 code with no received date ("period requires verification").
    .filter(
      (x) =>
        x.inPeriod === true ||
        (x.inPeriod === null && x.rec.yearBasis === "code" && x.rec.year === 2025),
    )
    .sort(
      (a, b) =>
        b.engagement - a.engagement ||
        (b.rec.value ?? b.rec.quoted ?? 0) - (a.rec.value ?? a.rec.quoted ?? 0),
    );
  return {
    rows,
    verified: rows.filter((x) => x.inPeriod === true).length,
    needsVerification: rows.filter((x) => x.inPeriod === null).length,
    all: bucket(rows.map((x) => x.rec)),
  };
}
