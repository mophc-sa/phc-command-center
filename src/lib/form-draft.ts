// =============================================================================
// Keeping a half-filled form.
//
// Reported 2026-09-02: "if something hangs or comes up and you leave without
// finishing, the data is deleted and you have to start from the beginning."
//
// The intake form carries about twenty fields. Losing it to a closed tab, a
// phone call, or a stray Escape is not a small annoyance — it is the reason
// people stop entering things at all, which costs the system its data long
// before it costs anyone their afternoon.
//
// Three decisions worth stating:
//
//   1. **A draft is per person, not per browser.** The key carries the user id,
//      so two salespeople on one laptop never see each other's half-typed client
//      names. A draft with no user id is not written at all.
//
//   2. **A restored draft is never silent.** It is announced, with its age, and
//      it can be discarded in one click. Silently repopulating a form with
//      last week's answers is a way to file last week's answers.
//
//   3. **It expires.** Seven days: long enough to survive a weekend, short
//      enough that a draft is still about work you remember starting.
// =============================================================================

export type Draft = {
  values: Record<string, string>;
  /** Epoch milliseconds. */
  savedAt: number;
};

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** `phc-draft:<user>:<form>` — no user, no key, no draft. */
export function draftKey(userId: string | null | undefined, formId: string): string | null {
  if (!userId) return null;
  return `phc-draft:${userId}:${formId}`;
}

/** Whether anything in here is worth restoring. Blank fields are not. */
export function hasContent(values: Record<string, string>): boolean {
  return Object.values(values).some((v) => typeof v === "string" && v.trim() !== "");
}

/**
 * What is worth saving: the fields the user actually filled in.
 *
 * Defaults are excluded deliberately. A form seeded with today's date would
 * otherwise "have content" the moment it opened, and every abandoned glance at
 * the form would leave a draft behind to be offered back later.
 */
export function draftPayload(
  values: Record<string, string>,
  defaults: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== "string" || v.trim() === "") continue;
    if (defaults[k] !== undefined && defaults[k] === v) continue;
    out[k] = v;
  }
  return out;
}

/** Parse a stored draft, refusing anything stale, malformed, or empty. */
export function readDraft(raw: string | null, now: number): Draft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const d = parsed as Partial<Draft>;
  if (typeof d.savedAt !== "number" || !Number.isFinite(d.savedAt)) return null;
  if (now - d.savedAt > DRAFT_TTL_MS) return null;
  // A clock that moved backwards should not resurrect a draft from "the
  // future" either -- it is more likely corruption than time travel.
  if (d.savedAt > now + 60_000) return null;
  if (typeof d.values !== "object" || d.values === null) return null;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.values)) {
    if (typeof v === "string") values[k] = v;
  }
  if (!hasContent(values)) return null;
  return { values, savedAt: d.savedAt };
}

/** How old a draft is, in whole minutes, for telling the user. */
export function draftAgeMinutes(savedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - savedAt) / 60_000));
}
