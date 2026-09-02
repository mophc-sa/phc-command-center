// =============================================================================
// A search box whose value lives in the URL.
//
// Reported 2026-09-02: on the opportunities page, typing in the search field
// and pressing Enter "does not work".
//
// The field was bound straight to the route: `value={routeSearch.q}` with an
// `onChange` that called `navigate()`. Navigation is asynchronous, so between
// a keystroke and the URL catching up React re-renders the input with the OLD
// value and the DOM node is reset — type quickly and characters disappear.
// Enter did nothing at all, because there was no form and no key handler.
//
// Every other list in the app (accounts, contacts) keeps its search in local
// state. Opportunities was the only page bound to the URL, and the only page
// anyone reported.
//
// The URL binding is worth keeping — it is what makes a filtered list
// shareable, bookmarkable, and reachable from a dashboard drilldown. So the two
// values are separated instead: the DRAFT is what the user is typing and what
// the input shows, and the COMMITTED value is what the URL holds and what the
// list filters by.
//
// The subtle part is telling our own committed value coming back through the
// router apart from a genuinely external change — a drilldown link, "Clear
// filters", the back button. Adopting the echo would be harmless; adopting it
// LATE would not, because a commit still in flight would overwrite letters the
// user typed after it. That is the whole reason `committed` is tracked.
// =============================================================================

export type SearchBoxState = {
  /** What the input shows. */
  draft: string;
  /** What we last put in the URL, so we can recognise it coming back. */
  committed: string;
};

export function initialSearchBox(url: string): SearchBoxState {
  return { draft: url, committed: url };
}

/** A keystroke. Changes what is shown, and nothing else. */
export function onType(s: SearchBoxState, value: string): SearchBoxState {
  return { ...s, draft: value };
}

/**
 * Enter, or the debounce firing. The draft becomes the value we own in the URL.
 *
 * Returns the state unchanged when there is nothing new to commit, so a caller
 * can skip the navigation entirely rather than pushing a duplicate history
 * entry on every Enter.
 */
export function onCommit(s: SearchBoxState): SearchBoxState {
  if (s.draft === s.committed) return s;
  return { draft: s.draft, committed: s.draft };
}

/**
 * The route's value changed.
 *
 * If it matches what we committed, this is our own write echoing back and the
 * draft must not be touched — the user may have typed more since. Anything else
 * came from outside this box and wins outright.
 */
export function onUrlChange(s: SearchBoxState, url: string): SearchBoxState {
  if (url === s.committed) return s;
  return { draft: url, committed: url };
}

/** Whether a commit would actually change anything. */
export function needsCommit(s: SearchBoxState): boolean {
  return s.draft !== s.committed;
}
