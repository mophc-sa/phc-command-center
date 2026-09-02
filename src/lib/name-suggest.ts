// =============================================================================
// Finding the company or project that is already in the system.
//
// Asked for on 2026-09-02: "if the project or company name is already added it
// should show to the person entering, be highlighted, and be selectable
// directly", and "when entering, the reference should be active — if the
// company name is registered it appears automatically".
//
// This is not a convenience feature. It is the only place a duplicate company
// can be prevented: once two rows exist for SAUDI BINLADEN GROUP, every report
// that groups by client is wrong, and no amount of care downstream fixes it.
// The list has 249 companies and 741 opportunities — small enough to match in
// memory, so there is no excuse for making someone guess.
//
// TWO NORMALISATIONS, ON PURPOSE
//
// Ranking wants to be aggressive: drop punctuation, drop the corporate noise
// ("CO.", "LTD", "شركة") that appears in half the names and distinguishes none
// of them, collapse whitespace. That changes the string's length.
//
// Highlighting cannot use it. To mark the matched characters IN THE ORIGINAL
// name, the fold must map each character to exactly one character, or every
// offset after the first removal points at the wrong letter. So there is a
// second, length-preserving fold used only to locate the match.
//
// Keeping them apart is what lets the ranking be generous and the highlight be
// exact. Collapsing them into one would force a choice between the two.
// =============================================================================

export type Suggestion<T> = {
  item: T;
  label: string;
  /** Character ranges in `label` to mark, as [start, end) pairs. */
  ranges: Array<[number, number]>;
};

/** Words that appear in half the company names and separate none of them. */
const NOISE = new Set([
  "co", "co.", "company", "corp", "corporation", "ltd", "limited", "llc",
  "est", "establishment", "group", "holding", "trading", "contracting",
  "شركة", "مؤسسة", "مجموعة", "المحدودة", "محدودة", "للمقاولات", "التجارية",
]);

/**
 * A 1:1 character fold — same length in, same length out.
 *
 * Only the substitutions that are genuinely one character for one: case, the
 * alef family, ya/alef maqsura, ta marbuta, and Arabic-Indic digits. Anything
 * that would delete or add a character belongs in `rankKey`, not here.
 */
export function foldForHighlight(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) {
    const code = ch.codePointAt(0)!;
    if (ch === "أ" || ch === "إ" || ch === "آ" || ch === "ٱ") out += "ا";
    else if (ch === "ى") out += "ي";
    else if (ch === "ة") out += "ه";
    else if (ch === "ـ") out += " ";
    // Arabic-Indic digits ٠-٩ to 0-9, so "١٢" finds "12".
    else if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else out += ch;
  }
  return out;
}

/** The aggressive form, for deciding whether two names are the same thing. */
export function rankKey(s: string): string {
  const folded = foldForHighlight(s)
    // Diacritics carry no distinction between two company names.
    .replace(/[ً-ْٰ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = folded.split(" ").filter((w) => w && !NOISE.has(w));
  // If a name is NOTHING but noise ("Trading Co."), keep it rather than
  // reducing it to an empty key that matches everything.
  return (words.length > 0 ? words : folded.split(" ")).join(" ");
}

/** Where the query appears in the label, using the length-preserving fold. */
function rangesOf(label: string, query: string): Array<[number, number]> {
  const hay = foldForHighlight(label);
  const needle = foldForHighlight(query).trim();
  if (!needle) return [];
  const at = hay.indexOf(needle);
  return at === -1 ? [] : [[at, at + needle.length]];
}

/**
 * Rank, lower is better:
 *   0  the same name
 *   1  starts with what was typed
 *   2  a word inside it starts with what was typed
 *   3  appears anywhere
 * Anything else is not a match at all.
 */
function score(labelKey: string, queryKey: string): number | null {
  if (labelKey === queryKey) return 0;
  if (labelKey.startsWith(queryKey)) return 1;
  if (labelKey.split(" ").some((w) => w.startsWith(queryKey))) return 2;
  if (labelKey.includes(queryKey)) return 3;
  return null;
}

export function suggest<T>(
  items: T[],
  labelOf: (t: T) => string,
  query: string,
  limit = 6,
): Array<Suggestion<T>> {
  const q = rankKey(query);
  // One character matches almost everything, and a list that long is not a
  // suggestion — it is a second problem.
  if (q.length < 2) return [];

  const scored: Array<{ s: number; i: number; sug: Suggestion<T> }> = [];
  items.forEach((item, i) => {
    const label = labelOf(item);
    if (!label) return;
    const s = score(rankKey(label), q);
    if (s === null) return;
    scored.push({ s, i, sug: { item, label, ranges: rangesOf(label, query) } });
  });

  // Ties break by original order, so the list does not reshuffle between
  // keystrokes for reasons the reader cannot see.
  scored.sort((a, b) => a.s - b.s || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.sug);
}

/** Whether what was typed is already, exactly, one of the known names. */
export function exactMatch<T>(items: T[], labelOf: (t: T) => string, query: string): T | null {
  const q = rankKey(query);
  if (!q) return null;
  return items.find((it) => rankKey(labelOf(it)) === q) ?? null;
}
