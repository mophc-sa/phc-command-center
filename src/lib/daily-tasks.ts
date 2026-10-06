// =============================================================================
// A person's day: tasks, follow-ups and commitments due by today plus what was
// finished today (day_items in 20261006100000_daily_task_completion.sql). The
// rate is done ÷ (done + still due); a day with nothing on it has no rate.
// Days are Riyadh calendar days, in SQL and here.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import { formatNumber } from "@/lib/i18n";

export type Bucket = "mandatory" | "manager" | "self" | "ai" | "meeting";
export type DayItem = {
  kind: "task" | "follow_up" | "commitment";
  id: string;
  title: string;
  due_date: string;
  done: boolean;
  overdue: boolean;
  bucket: Bucket;
  opportunity_id: string | null;
  opportunity_name: string | null;
};
export type RepDay = {
  user_id: string;
  full_name: string | null;
  done: number;
  open_due: number;
  overdue: number;
  buckets: Partial<Record<Bucket, { done: number; total: number }>>;
};

export function riyadhDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function rate(done: number, openDue: number): number | null {
  const total = done + openDue;
  return total === 0 ? null : Math.floor((done / total) * 100);
}

export function formatRate(r: number | null, lang: "ar" | "en"): string {
  if (r == null) return "—";
  return formatNumber(r / 100, lang, { style: "percent" });
}

export async function myDay(day: string): Promise<DayItem[]> {
  const { data, error } = await supabase.rpc("my_day" as never, { _day: day } as never);
  if (error) throw error;
  return (data ?? []) as DayItem[];
}

export async function teamDay(day: string): Promise<RepDay[]> {
  const { data, error } = await supabase.rpc("daily_completion" as never, { _day: day } as never);
  if (error) throw error;
  return (data ?? []) as RepDay[];
}

export async function createTask(input: { title: string; dueDate?: string | null; opportunityId?: string | null; ownerId?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("create_task" as never, {
    _title: input.title, _due_date: input.dueDate ?? null, _opportunity_id: input.opportunityId ?? null, _owner_id: input.ownerId ?? null,
  } as never);
  if (error) throw error;
  return data as unknown as string;
}

export async function setTaskStatus(id: string, status: "open" | "done" | "cancelled", reason?: string): Promise<void> {
  const { error } = await supabase.rpc("set_task_status" as never, { _id: id, _status: status, _reason: reason ?? null } as never);
  if (error) throw error;
}
