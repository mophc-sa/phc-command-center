// =============================================================================
// Turning a pasted URL into something you can click.
//
// Reported 2026-09-02: "when a link is added it must be active — clicking it
// goes straight to the page". Fields render their value as plain text, so a URL
// a rep pasted into a note or a detail field sat there as characters. The
// workaround is select, copy, switch to the address bar — every time.
//
// Two rules make this safe rather than merely convenient:
//
//   1. **http and https only.** A field is user-supplied text and a link is the
//      one thing on the page that executes on click. `javascript:` and `data:`
//      URLs are how a pasted string becomes script, so nothing else is ever
//      turned into an anchor — it stays as text, visible and inert.
//
//   2. **Trailing punctuation belongs to the sentence, not the link.** A URL at
//      the end of a note is nearly always followed by a full stop, a comma, or
//      closing bracket. Swallowing it produces a 404 and looks like the system
//      mangled the address.
// =============================================================================

export type LinkifySegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

/** Characters that end a sentence rather than a URL. */
const TRAILING = /[.,;:!?)\]}'"»…]+$/;

/**
 * Deliberately narrow: a scheme we allow, then non-space characters. It does
 * not try to find bare `www.` or `example.com` — guessing at what is a domain
 * turns "see section 3.2" into a link, and a wrong link is worse than none.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

export function linkify(input: string): LinkifySegment[] {
  const out: LinkifySegment[] = [];
  let last = 0;
  for (const m of input.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let url = m[0];

    // Give back any punctuation that closes the sentence rather than the URL,
    // and any bracket that has no opener inside the match.
    const trimmed = url.replace(TRAILING, "");
    const dropped = url.slice(trimmed.length);
    url = trimmed;

    if (start > last) out.push({ kind: "text", text: input.slice(last, start) });
    if (url) out.push({ kind: "link", text: url, href: url });
    if (dropped) out.push({ kind: "text", text: dropped });
    last = start + m[0].length;
  }
  if (last < input.length) out.push({ kind: "text", text: input.slice(last) });
  return out;
}

/** Whether a string is worth passing through `linkify` at all. */
export function hasLink(input: string): boolean {
  URL_RE.lastIndex = 0;
  return URL_RE.test(input);
}
