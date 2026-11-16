// Order of the pricing queue: what is due first, then what has waited longest,
// then the bigger deal. Pure so pricing-queue.test.ts can pin it.

import { riyadhDay } from "@/lib/riyadh-day";

export type QueueSortItem = {
  fileId: string;
  /** date (YYYY-MM-DD) or null */
  dueAt: string | null;
  days: number;
  value: number | null;
};

/** Ascending, nulls last. */
function cmpNullsLast<T extends string | number>(a: T | null, b: T | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareQueue(a: QueueSortItem, b: QueueSortItem): number {
  return (
    cmpNullsLast(a.dueAt, b.dueAt) ||
    b.days - a.days ||
    (a.value == null || b.value == null ? cmpNullsLast(a.value, b.value) : b.value - a.value) ||
    (a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0)
  );
}

/** Today as a Riyadh calendar day, YYYY-MM-DD — the business day, not the browser's. */
export const localDateString = (now: Date = new Date()): string => riyadhDay(now);

/** A date-only due value is overdue once the local day has passed it. */
export const isOverdue = (due: string | null, today: string = localDateString()): boolean => due != null && due < today;
