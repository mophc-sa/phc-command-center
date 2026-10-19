// Autofill from data already on file, shown in blue until someone confirms it
// (manager feedback group 4, 2026-10-19).
//
// A suggestion is never silently accepted: it fills only an empty field the
// user has not touched, it stays marked until confirmed (✓) or edited, and the
// form will not submit while a visible field is still only a suggestion.

export function applySuggestions(
  values: Record<string, string>,
  suggested: Set<string>,
  touched: Set<string>,
  proposal: Record<string, string>,
): { values: Record<string, string>; suggested: Set<string> } {
  let nextValues = values;
  let nextSuggested = suggested;
  for (const [key, raw] of Object.entries(proposal)) {
    const v = raw?.trim() ?? "";
    if (!v || touched.has(key) || (values[key] ?? "") !== "") continue;
    if (nextValues === values) nextValues = { ...values };
    if (nextSuggested === suggested) nextSuggested = new Set(suggested);
    nextValues[key] = v;
    nextSuggested.add(key);
  }
  return { values: nextValues, suggested: nextSuggested };
}

/** Suggested fields still awaiting confirmation, among those on screen. */
export function pendingSuggestions(suggested: Set<string>, visibleKeys: string[]): string[] {
  return visibleKeys.filter((k) => suggested.has(k));
}
