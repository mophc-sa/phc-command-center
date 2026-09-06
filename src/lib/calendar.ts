// =============================================================================
// Everything in this system that carries a date, on one grid.
//
// The dates were never missing — they were scattered. A follow-up's due date
// lives on the follow-up, an RFQ's deadline on the RFQ, and a next action on
// the opportunity. A manager who wants to know what Thursday looks like has
// to open three pages and hold the answer in their head.
//
// This module only READS and arranges. It computes no new fact and invents no
// date: an item with no date does not appear, rather than appearing on a date
// someone guessed for it. That is the same rule the rest of the engine follows
// — absence of a date is not a date.
//
// Overdue is measured against `today` passed in by the caller, never a clock
// read inside a pure function, so a test can ask what October looked like.
// =============================================================================

import type { MessageRef } from "@/lib/messages";
import { msg } from "@/lib/messages";

/**
 * Every kind of dated obligation the system records.
 *
 * It was three. Measured on production, those three covered 19 dated rows and
 * left 37 invisible -- an enquiry deadline, an enquiry follow-up, a flag and a
 * commitment are all things somebody typed into this system on purpose, and
 * none of them reached the one page that answers "what does Thursday look
 * like". A date you recorded and cannot see is worse than one you never
 * recorded: you believe it is being watched.
 *
 * The empty ones are here too, deliberately. `quotations.valid_until` holds no
 * rows today and `expected_contract_date` holds none either -- but they are
 * fields the forms write, so the day they fill is the day they must appear,
 * not the day someone notices they did not.
 */
export type CalendarSource =
  | "follow_up"
  | "rfq_deadline"
  | "next_action"
  | "expected_contract"
  | "hold_review"
  | "intake_deadline"
  | "intake_follow_up"
  | "intake_info_due"
  | "flag_due"
  | "commitment"
  | "task"
  | "quotation_expiry"
  | "project_boq"
  | "project_signage"
  | "tender_award"
  | "tender_follow_up";

/** What a day owes you. */
export type CalendarEvent = {
  id: string;
  source: CalendarSource;
  /** YYYY-MM-DD. Never null — an undated record is not an event. */
  date: string;
  title: string;
  /** The record to open. */
  entityId: string;
  /** Deal or client context, when the row carries one. */
  context: string | null;
  /**
   * How the day should read it.
   *
   * `overdue` is a fact about the date, not a judgement about the deal, so a
   * completed follow-up is never overdue however old it is.
   */
  state: "overdue" | "due" | "upcoming" | "done";
  label: MessageRef;
};

export type CalendarInput = {
  today: string;
  followUps?: Array<{
    id: string;
    opportunity_id: string | null;
    due_date: string | null;
    status: string | null;
    channel?: string | null;
    opportunityName?: string | null;
  }>;
  rfqs?: Array<{
    id: string;
    rfq_number?: string | null;
    response_due_date: string | null;
    status?: string | null;
    opportunity_id?: string | null;
  }>;
  opportunities?: Array<{
    id: string;
    project_name?: string | null;
    client?: string | null;
    next_action?: string | null;
    next_action_due?: string | null;
    expected_contract_date?: string | null;
    hold_review_date?: string | null;
    sales_stage?: string | null;
  }>;
  inboxItems?: Array<{
    id: string;
    project_name?: string | null;
    company_name?: string | null;
    deadline?: string | null;
    follow_up_date?: string | null;
    info_due_date?: string | null;
    status?: string | null;
  }>;
  flags?: Array<{
    id: string;
    linked_record_id?: string | null;
    linked_record_type?: string | null;
    flag_kind?: string | null;
    reason?: string | null;
    due_date?: string | null;
    status?: string | null;
    completed_at?: string | null;
  }>;
  commitments?: Array<{
    id: string;
    opportunity_id?: string | null;
    description?: string | null;
    due_date?: string | null;
    closed_at?: string | null;
  }>;
  tasks?: Array<{
    id: string;
    title?: string | null;
    due_date?: string | null;
    completed_at?: string | null;
    related_opportunity_id?: string | null;
  }>;
  quotations?: Array<{
    id: string;
    quote_number?: string | null;
    valid_until?: string | null;
    status?: string | null;
    related_opportunity_id?: string | null;
  }>;
  projects?: Array<{
    id: string;
    name?: string | null;
    project_number?: string | null;
    expected_boq_date?: string | null;
    expected_signage_date?: string | null;
  }>;
  tenders?: Array<{
    id: string;
    tender_name?: string | null;
    tender_stage?: string | null;
    expected_award_date?: string | null;
    next_follow_up_date?: string | null;
  }>;
};

const DONE_FOLLOW_UP = new Set(["completed", "cancelled", "done"]);
const CLOSED_STAGE = new Set(["won", "lost", "archived"]);
const CLOSED_RFQ = new Set(["quoted", "cancelled", "lost", "won", "closed"]);
const DONE_FLAG = new Set(["completed", "cancelled", "dismissed"]);
const CLOSED_INTAKE = new Set(["converted", "rejected", "archived", "cancelled", "closed"]);
const CLOSED_TENDER = new Set(["awarded", "lost", "cancelled", "archived", "closed"]);

/** YYYY-MM-DD comparison is lexical, which is why every date here stays a string. */
const dayOf = (v: string) => v.slice(0, 10);

function stateFor(date: string, today: string, done: boolean): CalendarEvent["state"] {
  if (done) return "done";
  if (date < today) return "overdue";
  if (date === today) return "due";
  return "upcoming";
}

/**
 * Collect every dated obligation into one list, sorted by date then source.
 *
 * Closed work is excluded rather than shown greyed: a won deal's next action
 * is not something anyone owes, and a calendar that shows it teaches the
 * reader to ignore rows.
 */
export function buildCalendar(input: CalendarInput): CalendarEvent[] {
  const today = dayOf(input.today);
  const out: CalendarEvent[] = [];

  for (const f of input.followUps ?? []) {
    if (!f.due_date) continue;
    const done = DONE_FOLLOW_UP.has((f.status ?? "").toLowerCase());
    if (done) continue;
    out.push({
      id: `follow_up:${f.id}`,
      source: "follow_up",
      date: dayOf(f.due_date),
      title: f.opportunityName ?? f.channel ?? "",
      entityId: f.opportunity_id ?? f.id,
      context: f.channel ?? null,
      state: stateFor(dayOf(f.due_date), today, done),
      label: msg("cal_follow_up"),
    });
  }

  for (const r of input.rfqs ?? []) {
    if (!r.response_due_date) continue;
    if (CLOSED_RFQ.has((r.status ?? "").toLowerCase())) continue;
    out.push({
      id: `rfq:${r.id}`,
      source: "rfq_deadline",
      date: dayOf(r.response_due_date),
      title: r.rfq_number ?? "",
      entityId: r.opportunity_id ?? r.id,
      context: r.status ?? null,
      state: stateFor(dayOf(r.response_due_date), today, false),
      label: msg("cal_rfq_due"),
    });
  }

  for (const o of input.opportunities ?? []) {
    if (!o.next_action_due) continue;
    if (CLOSED_STAGE.has((o.sales_stage ?? "").toLowerCase())) continue;
    out.push({
      id: `next_action:${o.id}`,
      source: "next_action",
      date: dayOf(o.next_action_due),
      title: o.next_action ?? o.project_name ?? "",
      entityId: o.id,
      context: o.project_name ?? o.client ?? null,
      state: stateFor(dayOf(o.next_action_due), today, false),
      label: msg("cal_next_action"),
    });
  }

  // ── The thirteen the calendar could not see ────────────────────────────────
  //
  // One helper rather than thirteen more copies of the same eight lines. Each
  // call still states its own closed-rule explicitly, because that is the part
  // that differs and the part that is worth reading: a completed flag is not
  // an obligation, an expired quotation still is until somebody re-issues it.
  const add = (
    source: CalendarSource,
    label: MessageRef,
    id: string,
    date: string | null | undefined,
    title: string,
    entityId: string,
    context: string | null,
    done = false,
  ) => {
    if (!date) return;
    if (done) return;
    out.push({
      id: `${source}:${id}`,
      source,
      date: dayOf(date),
      title,
      entityId,
      context,
      state: stateFor(dayOf(date), today, false),
      label,
    });
  };

  for (const o of input.opportunities ?? []) {
    const closed = CLOSED_STAGE.has((o.sales_stage ?? "").toLowerCase());
    const name = o.project_name ?? o.client ?? "";
    add("expected_contract", msg("cal_expected_contract"), o.id, o.expected_contract_date,
        name, o.id, o.client ?? null, closed);
    // A hold review is the one date a closed deal can still owe: it is the
    // appointment to decide whether the hold stands.
    add("hold_review", msg("cal_hold_review"), o.id, o.hold_review_date,
        name, o.id, o.client ?? null, false);
  }

  for (const i of input.inboxItems ?? []) {
    const closed = CLOSED_INTAKE.has((i.status ?? "").toLowerCase());
    const name = i.project_name ?? i.company_name ?? "";
    add("intake_deadline", msg("cal_intake_deadline"), i.id, i.deadline, name, i.id, i.company_name ?? null, closed);
    add("intake_follow_up", msg("cal_intake_follow_up"), i.id, i.follow_up_date, name, i.id, i.company_name ?? null, closed);
    add("intake_info_due", msg("cal_intake_info_due"), i.id, i.info_due_date, name, i.id, i.company_name ?? null, closed);
  }

  for (const f of input.flags ?? [])
    // A flag points at whatever record raised it, so the row it opens is that
    // record -- but only when it is an opportunity, which is the only kind the
    // calendar can route to today.
    add("flag_due", msg("cal_flag_due"), f.id, f.due_date, f.reason ?? f.flag_kind ?? "",
        f.linked_record_type === "opportunity" && f.linked_record_id ? f.linked_record_id : f.id,
        // Measured vocabulary: open · in_progress · completed. `completed_at`
        // alone would keep showing a flag closed without one.
        f.flag_kind ?? null, Boolean(f.completed_at) || DONE_FLAG.has((f.status ?? "").toLowerCase()));

  for (const c of input.commitments ?? [])
    add("commitment", msg("cal_commitment"), c.id, c.due_date, c.description ?? "",
        c.opportunity_id ?? c.id, null, Boolean(c.closed_at));

  for (const t of input.tasks ?? [])
    add("task", msg("cal_task"), t.id, t.due_date, t.title ?? "",
        t.related_opportunity_id ?? t.id, null, Boolean(t.completed_at));

  for (const q of input.quotations ?? [])
    // Not filtered on status: a quotation that expires while nobody looked is
    // exactly the thing this page exists to surface.
    add("quotation_expiry", msg("cal_quotation_expiry"), q.id, q.valid_until,
        q.quote_number ?? "", q.related_opportunity_id ?? q.id, q.status ?? null);

  for (const p of input.projects ?? []) {
    const name = p.name ?? p.project_number ?? "";
    add("project_boq", msg("cal_project_boq"), p.id, p.expected_boq_date, name, p.id, p.project_number ?? null);
    add("project_signage", msg("cal_project_signage"), p.id, p.expected_signage_date, name, p.id, p.project_number ?? null);
  }

  for (const t of input.tenders ?? []) {
    // Tenders carry a stage, not a status -- `tender_stage`, and the closed
    // ones are named there.
    const closed = CLOSED_TENDER.has((t.tender_stage ?? "").toLowerCase());
    const name = t.tender_name ?? "";
    add("tender_award", msg("cal_tender_award"), t.id, t.expected_award_date, name, t.id, t.tender_stage ?? null, closed);
    add("tender_follow_up", msg("cal_tender_follow_up"), t.id, t.next_follow_up_date, name, t.id, t.tender_stage ?? null, closed);
  }

  // Ordering within a day, most time-critical first. A deadline someone else
  // set outranks one we set ourselves, and an expiry outranks a forecast.
  const ORDER: Record<CalendarSource, number> = {
    rfq_deadline: 0,
    intake_deadline: 1,
    quotation_expiry: 2,
    follow_up: 3,
    intake_follow_up: 4,
    tender_follow_up: 5,
    next_action: 6,
    commitment: 7,
    task: 8,
    flag_due: 9,
    intake_info_due: 10,
    hold_review: 11,
    tender_award: 12,
    expected_contract: 13,
    project_boq: 14,
    project_signage: 15,
  };
  return out.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.source] - ORDER[b.source]);
}

/** Events keyed by YYYY-MM-DD, for a grid that renders one cell per day. */
export function byDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const m = new Map<string, CalendarEvent[]>();
  for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e]);
  return m;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * The six-week grid a month is drawn on, Monday-first.
 *
 * Always six rows, so the grid does not change height as the reader pages
 * through months — a calendar that jumps is a calendar people mis-click.
 */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay: 0 = Sunday. Shift so Monday starts the week.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - lead);

  const weeks: string[][] = [];
  const cur = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(ymd(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate()));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export const monthOf = (day: string) => Number(day.slice(5, 7));

/** What the reader most needs: what is late, and what is today. */
export function calendarSummary(events: CalendarEvent[]) {
  return {
    overdue: events.filter((e) => e.state === "overdue").length,
    today: events.filter((e) => e.state === "due").length,
    upcoming: events.filter((e) => e.state === "upcoming").length,
    total: events.length,
  };
}
