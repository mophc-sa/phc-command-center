// =============================================================================
// "If the company is registered, the reference appears automatically."
//
// Asked for on 2026-09-02. The reference worth surfacing is not the account row
// -- the autocomplete already says whether that exists -- it is PHC's own past
// work for that client. A rep pricing an RFQ from a contractor we have already
// built for should know that BEFORE they quote: it changes the price, the
// references attached to the proposal, and who they call internally.
//
// Matching goes through the same `rankKey` the suggestion list uses, so
// "ASTRA CONSTRUCTION CO." on a reference project and "Astra Construction" typed
// into the form are recognised as one company. Two different opinions about
// whether two names are the same thing is how a hint comes to contradict the
// list directly above it.
// =============================================================================

import { rankKey } from "@/lib/name-suggest";

/**
 * Whether two company names are the same client.
 *
 * Exact key equality is too strict: the reference library holds "SAUDI BINLADEN
 * GROUP SBG" and a rep types "Saudi Binladen Group". `rankKey` drops "group" as
 * noise but keeps "SBG", which distinguishes nothing here and everything
 * elsewhere -- so equality alone loses a real match.
 *
 * Containment is too loose on its own: "ASTRA" is contained in both "ASTRA
 * CONSTRUCTION" and "ASTRA HOLDING", which are not one company.
 *
 * So: equal, OR one name's words are all present in the other AND at least two
 * words are shared. Two is the threshold because one shared word is a brand
 * prefix, and this line asserts a fact rather than offering a choice -- a false
 * positive here tells someone we have history we do not have.
 */
function sameClient(a: string, b: string): boolean {
  if (a === b) return true;
  const wa = a.split(" ").filter(Boolean);
  const wb = b.split(" ").filter(Boolean);
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (short.length < 2) return false;
  const set = new Set(long);
  return short.every((w) => set.has(w));
}

/** How many past PHC reference projects were for this client. */
export function countReferences(clients: string[], typed: string): number {
  const key = rankKey(typed ?? "");
  // One or two characters match half the book; a hint that fires on "a" is
  // noise sitting under a field somebody is still typing into.
  if (key.length < 3) return 0;
  return clients.filter((c) => sameClient(rankKey(c), key)).length;
}
