// =============================================================================
// Meetings phase 1: the numbers on /meetings, and the default due date.
// Spec: docs/superpowers/specs/2026-10-22-meetings-phase1-scope.md
//
// Computed from the meetings the reader can see (RLS), so a manager sees the
// team and a salesperson sees their own meetings.
// =============================================================================

import { riyadhDay } from "@/lib/daily-tasks";

const DAY = 86_400_000;

/** The Saudi working week is Sunday to Thursday. Mirrors public.add_business_days. */
export function addBusinessDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  let left = Math.max(0, Math.floor(n));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(); // 5 = Friday, 6 = Saturday
    if (dow !== 5 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** The Sunday that starts the Riyadh week containing `now`. */
export function weekStart(now: Date = new Date()): string {
  const today = riyadhDay(now);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export type MetricItem = { status: string; created_at: string; decided_at: string | null; decided_by: string | null };
export type MetricMeeting = { occurred_at: string | null; meeting_action_items: MetricItem[] };

export type MeetingMetrics = {
  meetingsThisWeek: number;
  /** Approved ÷ all action items, 0–100; null with no items. */
  approvedPct: number | null;
  /** Mean hours from arrival to a person's decision; auto-dismissals are not decisions. */
  avgDecisionHours: number | null;
  pendingOver7Days: number;
};

export function meetingMetrics(rows: MetricMeeting[], now: Date = new Date()): MeetingMetrics {
  const start = weekStart(now);
  const items = rows.flatMap((m) => m.meeting_action_items ?? []);
  const approved = items.filter((i) => i.status === "approved").length;
  const decided = items.filter((i) => i.status !== "pending" && i.decided_by && i.decided_at);
  const hours = decided.map((i) => (Date.parse(i.decided_at as string) - Date.parse(i.created_at)) / 3_600_000);
  const cutoff = now.getTime() - 7 * DAY;
  return {
    meetingsThisWeek: rows.filter((m) => m.occurred_at && riyadhDay(new Date(m.occurred_at)) >= start).length,
    approvedPct: items.length ? Math.round((approved / items.length) * 100) : null,
    avgDecisionHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    pendingOver7Days: items.filter((i) => i.status === "pending" && Date.parse(i.created_at) < cutoff).length,
  };
}

/** "< 1 h" within the hour, "5 h" under two days, "3.5 d" after; "—" with nothing decided. */
export function formatDecisionTime(hours: number | null, lang: "en" | "ar"): string {
  if (hours == null) return "—";
  if (hours < 1) return lang === "ar" ? "أقل من ساعة" : "< 1 h";
  if (hours < 48) return lang === "ar" ? `${Math.round(hours)} ساعة` : `${Math.round(hours)} h`;
  const days = Math.round((hours / 24) * 10) / 10;
  return lang === "ar" ? `${days} يوم` : `${days} d`;
}
