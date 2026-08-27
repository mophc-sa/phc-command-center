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

export type CalendarSource = "follow_up" | "rfq_deadline" | "next_action";

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
    sales_stage?: string | null;
  }>;
};

const DONE_FOLLOW_UP = new Set(["completed", "cancelled", "done"]);
const CLOSED_STAGE = new Set(["won", "lost", "archived"]);
const CLOSED_RFQ = new Set(["quoted", "cancelled", "lost", "won", "closed"]);

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

  const ORDER: Record<CalendarSource, number> = { rfq_deadline: 0, follow_up: 1, next_action: 2 };
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
