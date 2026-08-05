// PHC Sales OS — Date input bounds validation.
//
// Why this exists: on 2026-08-05 a live production audit found
// rfqs.response_due_date = '275760-07-29' on RFQ-2026-0001 — the JavaScript
// maximum date, produced by over-typing the year segment of an <input
// type="date">. Nothing rejected it: the browser accepted it, the client
// passed it through, and Postgres DATE happily stores years up to 5874897.
//
// The damage is silent rather than loud. The urgency queries filter with
// `.lte(response_due_date, todayPlus7)`, so a record with an absurd deadline is
// excluded forever — it never shows as urgent, never shows as overdue, and
// never appears in any submission-deadline list. The only real RFQ in the
// system was invisible to the deadline machinery for a week before anyone
// noticed.
//
// No Supabase, no React — pure functions so they can be unit-tested and reused
// by both the dialog layer and any server-side validation added later.

/**
 * A date string is only well-formed for our purposes when it is exactly
 * `YYYY-MM-DD` with a four-digit year. `<input type="date">` emits a six-digit
 * year (`275760-07-29`) when the year segment overflows, which this rejects
 * outright — it is the exact shape of the live defect.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Absolute floor. Earlier than any PHC commercial record could legitimately be. */
export const MIN_DATE = "1990-01-01";

/** How far ahead a date may legitimately sit. Construction timelines are long,
 *  but not decades — 20 years is generous while still catching year typos. */
export const MAX_YEARS_AHEAD = 20;

export type DateBoundsResult =
  | { ok: true }
  | { ok: false; reason: "malformed" | "too_early" | "too_late" | "invalid" };

/** The latest date currently accepted, as `YYYY-MM-DD`. */
export function maxAllowedDate(today: Date = new Date()): string {
  const d = new Date(today.getTime());
  d.setFullYear(d.getFullYear() + MAX_YEARS_AHEAD);
  return d.toISOString().slice(0, 10);
}

/**
 * Validates a date string from a form input.
 *
 * An empty value is treated as valid — "is this field required?" is a separate
 * question, already answered by the `required` flag on the field itself.
 * Mixing the two here would make an optional date field impossible to leave blank.
 */
export function validateDateBounds(
  value: string | null | undefined,
  opts: { min?: string; max?: string; today?: Date } = {},
): DateBoundsResult {
  if (value == null || value === "") return { ok: true };

  if (!ISO_DATE_RE.test(value)) return { ok: false, reason: "malformed" };

  // Reject calendar-invalid dates that still match the shape (e.g. 2026-02-31).
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { ok: false, reason: "invalid" };
  if (parsed.toISOString().slice(0, 10) !== value) return { ok: false, reason: "invalid" };

  const min = opts.min ?? MIN_DATE;
  const max = opts.max ?? maxAllowedDate(opts.today);

  if (value < min) return { ok: false, reason: "too_early" };
  if (value > max) return { ok: false, reason: "too_late" };

  return { ok: true };
}

/** The i18n keys this module can produce. Kept as a literal union so `t()`
 *  accepts the result directly — `t` is typed against the key dictionary. */
export type DateBoundsErrorKey =
  | "dialog_date_invalid"
  | "dialog_date_too_early"
  | "dialog_date_too_late";

/** i18n key for the message to show for a given failure reason. */
export function dateBoundsErrorKey(
  reason: Exclude<DateBoundsResult, { ok: true }>["reason"],
): DateBoundsErrorKey {
  switch (reason) {
    case "malformed":
    case "invalid":
      return "dialog_date_invalid";
    case "too_early":
      return "dialog_date_too_early";
    case "too_late":
      return "dialog_date_too_late";
  }
}
