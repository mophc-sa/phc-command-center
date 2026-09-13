// =============================================================================
// A private calendar feed Outlook subscribes to — the pure core.
//
// The third requested feature. The Microsoft Graph route is blocked on a
// GoDaddy-held tenant admin, so instead each person gets a private link that
// Outlook subscribes to once ("Add calendar → Subscribe from web"). From then on
// their follow-ups and deadlines appear in their Outlook calendar.
//
// THE TRADE-OFF, STATED ONCE AND NOT HIDDEN
//
// Outlook refreshes subscribed calendars on its own schedule — about every three
// hours, and Microsoft says it can take more than a day — with no manual refresh.
// This is not live sync. A follow-up added now is in Outlook later today, not
// this minute. The UI and the setup doc say so.
//
// WHAT A FEED CONTAINS: WHAT THAT PERSON OWNS, NOTHING ELSE
//
// The feed is served without a user session, so the database cannot apply RLS
// as that person. Rather than reproduce every read rule, it answers a narrower
// and correct question: what is on THIS person's plate. Every source is filtered
// by its owner column. A manager's feed is their own work, not their team's — a
// subscribed calendar is a personal calendar, and the pipeline has its own pages.
//
// Closed work is left out using the same rules as the in-app calendar
// (src/lib/calendar.ts), mirrored here because Edge Functions cannot import the
// browser code. A contract test fails if the two sets drift.
// =============================================================================

// ---- Closed-work rules, mirrored from src/lib/calendar.ts --------------------
export const DONE_FOLLOW_UP = new Set(["completed", "cancelled", "done"]);
export const CLOSED_STAGE = new Set(["won", "lost", "archived"]);
export const CLOSED_RFQ = new Set(["quoted", "cancelled", "lost", "won", "closed"]);
export const DONE_FLAG = new Set(["completed", "cancelled", "dismissed"]);
export const CLOSED_INTAKE = new Set(["converted", "rejected", "archived", "cancelled", "closed"]);
export const CLOSED_TENDER = new Set(["awarded", "lost", "cancelled", "archived", "closed"]);

const lc = (v: unknown) => String(v ?? "").toLowerCase();
const day = (v: unknown) => String(v ?? "").slice(0, 10);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export type FeedEvent = {
  /** Stable across refreshes, so Outlook updates an event instead of duplicating it. */
  uid: string;
  date: string; // YYYY-MM-DD, all-day
  summary: string;
  /** Path inside the app, e.g. /opportunities/<id>. */
  path: string | null;
};

export type OwnedRows = {
  followUps?: Array<{ id: string; opportunity_id?: string | null; due_date?: string | null; status?: string | null; channel?: string | null }>;
  opportunities?: Array<{
    id: string;
    project_name?: string | null;
    next_action?: string | null;
    next_action_due?: string | null;
    expected_contract_date?: string | null;
    hold_review_date?: string | null;
    sales_stage?: string | null;
  }>;
  rfqs?: Array<{ id: string; rfq_number?: string | null; response_due_date?: string | null; status?: string | null; opportunity_id?: string | null }>;
  tasks?: Array<{ id: string; title?: string | null; due_date?: string | null; completed_at?: string | null; related_opportunity_id?: string | null }>;
  commitments?: Array<{ id: string; description?: string | null; due_date?: string | null; closed_at?: string | null; opportunity_id?: string | null }>;
  quotations?: Array<{ id: string; quote_number?: string | null; valid_until?: string | null; related_opportunity_id?: string | null }>;
  tenders?: Array<{ id: string; tender_name?: string | null; tender_stage?: string | null; expected_award_date?: string | null; next_follow_up_date?: string | null }>;
  flags?: Array<{ id: string; reason?: string | null; flag_kind?: string | null; due_date?: string | null; status?: string | null; completed_at?: string | null; linked_record_type?: string | null; linked_record_id?: string | null }>;
  intake?: Array<{ id: string; project_name?: string | null; deadline?: string | null; follow_up_date?: string | null; info_due_date?: string | null; status?: string | null }>;
};

const opp = (id: string | null | undefined) => (id ? `/opportunities/${id}` : null);

/**
 * Every dated obligation this person owns, still open, as all-day events.
 *
 * Projects are deliberately absent: they carry no owner, so there is no honest
 * answer to whose calendar their BOQ and signage dates belong in.
 */
export function collectFeedEvents(rows: OwnedRows): FeedEvent[] {
  const out: FeedEvent[] = [];
  const push = (uid: string, date: unknown, summary: string, path: string | null) => {
    const d = day(date);
    if (!isDay(d)) return;
    out.push({ uid, date: d, summary: summary.trim() || "PHC", path });
  };

  for (const f of rows.followUps ?? []) {
    if (DONE_FOLLOW_UP.has(lc(f.status))) continue;
    push(`follow_up-${f.id}`, f.due_date, `Follow-up${f.channel ? ` (${f.channel})` : ""}`, opp(f.opportunity_id));
  }
  for (const o of rows.opportunities ?? []) {
    const closed = CLOSED_STAGE.has(lc(o.sales_stage));
    const name = o.project_name ?? "Opportunity";
    if (!closed) {
      push(`next_action-${o.id}`, o.next_action_due, `${o.next_action || "Next action"} — ${name}`, opp(o.id));
      push(`expected_contract-${o.id}`, o.expected_contract_date, `Expected contract — ${name}`, opp(o.id));
    }
    // A hold review is the one date a closed deal can still owe, as in-app.
    push(`hold_review-${o.id}`, o.hold_review_date, `Hold review — ${name}`, opp(o.id));
  }
  for (const r of rows.rfqs ?? []) {
    if (CLOSED_RFQ.has(lc(r.status))) continue;
    push(`rfq-${r.id}`, r.response_due_date, `RFQ response due${r.rfq_number ? ` — ${r.rfq_number}` : ""}`, opp(r.opportunity_id));
  }
  for (const t of rows.tasks ?? []) {
    if (t.completed_at) continue;
    push(`task-${t.id}`, t.due_date, t.title || "Task", opp(t.related_opportunity_id));
  }
  for (const c of rows.commitments ?? []) {
    if (c.closed_at) continue;
    push(`commitment-${c.id}`, c.due_date, c.description || "Commitment", opp(c.opportunity_id));
  }
  for (const q of rows.quotations ?? []) {
    // Not filtered on status, as in-app: a quotation expiring unnoticed is the point.
    push(`quotation-${q.id}`, q.valid_until, `Quotation expires${q.quote_number ? ` — ${q.quote_number}` : ""}`, opp(q.related_opportunity_id));
  }
  for (const t of rows.tenders ?? []) {
    if (CLOSED_TENDER.has(lc(t.tender_stage))) continue;
    const name = t.tender_name ?? "Tender";
    push(`tender_award-${t.id}`, t.expected_award_date, `Award expected — ${name}`, null);
    push(`tender_follow_up-${t.id}`, t.next_follow_up_date, `Tender follow-up — ${name}`, null);
  }
  for (const f of rows.flags ?? []) {
    if (f.completed_at || DONE_FLAG.has(lc(f.status))) continue;
    const path = f.linked_record_type === "opportunity" ? opp(f.linked_record_id) : null;
    push(`flag-${f.id}`, f.due_date, f.reason || f.flag_kind || "Flag due", path);
  }
  for (const i of rows.intake ?? []) {
    if (CLOSED_INTAKE.has(lc(i.status))) continue;
    const name = i.project_name ?? "Enquiry";
    push(`intake_deadline-${i.id}`, i.deadline, `Enquiry deadline — ${name}`, null);
    push(`intake_follow_up-${i.id}`, i.follow_up_date, `Enquiry follow-up — ${name}`, null);
    push(`intake_info-${i.id}`, i.info_due_date, `Information due — ${name}`, null);
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
}

// ---- iCalendar (RFC 5545) ---------------------------------------------------

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
export function icsText(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold a content line at 75 octets, as RFC 5545 §3.1 requires.
 *
 * Octets, not characters: an Arabic project name is two bytes per letter, and
 * folding by character count produces lines some clients reject outright. The
 * fold never splits a multi-byte character.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // First line holds 75 octets; continuation lines hold 74 after the leading space.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + n > limit) {
      parts.push(current);
      current = ch;
      bytes = n;
    } else {
      current += ch;
      bytes += n;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function toICS(events: FeedEvent[], opts: { appUrl: string; now: Date; name: string }): string {
  const base = opts.appUrl.replace(/\/+$/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PHC//Command Center//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(opts.name)}`,
    // A hint only — Outlook keeps its own schedule — but clients that honour it
    // refresh sooner.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const dtstamp = stamp(opts.now);
  for (const e of events) {
    const url = e.path ? `${base}${e.path}` : null;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@phc-command-center`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${nextDay(e.date).replace(/-/g, "")}`,
      `SUMMARY:${icsText(e.summary)}`,
      ...(url ? [`DESCRIPTION:${icsText(`Open in PHC: ${url}`)}`, `URL:${url}`] : []),
      // All-day reminders would fire at midnight; the day itself is the reminder.
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ---- Feed tokens ------------------------------------------------------------

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 160 bits. Longer than a reply id: this one is a standing read credential. */
export const FEED_TOKEN_LENGTH = 32;

export function newFeedToken(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = rand(FEED_TOKEN_LENGTH);
  let s = "";
  for (let i = 0; i < FEED_TOKEN_LENGTH; i++) s += B32[bytes[i] % 32];
  return s;
}

export function isFeedToken(v: string): boolean {
  return new RegExp(`^[${B32}]{${FEED_TOKEN_LENGTH}}$`).test(v);
}
