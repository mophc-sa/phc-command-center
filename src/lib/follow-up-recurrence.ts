// =============================================================================
// Repeating follow-ups (manager feedback group 5, 2026-10-19: "client follow-up
// reminders on a specific date, or repeating monthly or yearly").
//
// The database schedules the next reminder when one is completed
// (schedule_next_follow_up, 20261026100000). nextFollowUpDate mirrors
// next_follow_up_date() so the screen can say when the next one will be; a test
// pins the two to the same cases.
// =============================================================================

type Lang = "en" | "ar";

export const RECURRENCES = ["none", "monthly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export function isRecurrence(v: unknown): v is Recurrence {
  return typeof v === "string" && (RECURRENCES as readonly string[]).includes(v);
}

const LABEL: Record<Recurrence, { en: string; ar: string }> = {
  none: { en: "Once", ar: "مرة واحدة" },
  monthly: { en: "Every month", ar: "كل شهر" },
  yearly: { en: "Every year", ar: "كل سنة" },
};

export const recurrenceLabel = (r: string | null | undefined, lang: Lang) =>
  isRecurrence(r) ? LABEL[r][lang] : LABEL.none[lang];

export const recurrenceOptions = (lang: Lang) => RECURRENCES.map((r) => ({ value: r, label: LABEL[r][lang] }));

/** `anchor` plus whole months, clamped to the month's last day, as Postgres does. */
function addMonths(anchor: string, months: number): string {
  const [y, m, d] = anchor.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * The next date of a series: counted from the anchor (the series' first date) in
 * whole months, the first one after `after` and not before `today`. Null for a
 * one-off reminder. Dates are YYYY-MM-DD.
 */
export function nextFollowUpDate(anchor: string, recurrence: string, after: string, today: string): string | null {
  const step = recurrence === "monthly" ? 1 : recurrence === "yearly" ? 12 : null;
  if (step === null) return null;
  for (let k = 1; k <= 2400; k++) {
    const d = addMonths(anchor, step * k);
    if (d > after && d >= today) return d;
  }
  return null;
}
