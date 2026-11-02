// =============================================================================
// Short links: /p/<project code>.
//
// Manager feedback 2026-10-19: links to a deal should be short and open
// directly. A deal's address is /opportunities/<uuid> -- thirty-six characters
// nobody can read aloud, check by eye, or type from a WhatsApp message. The
// project code (FA-26-0001: rep, year, sequence -- 20260806160000) is already
// the name people use for a deal, and it is unique (rfqs_rfq_number_key).
//
// The link resolves as the person who opens it, through RLS. A reader who
// cannot see the deal gets the same "not found" as a code that does not exist,
// so a short link never confirms that a deal is there.
// =============================================================================

// Letters, digits and hyphens: every code the numbering triggers have issued
// (FA-26-0001, older RFQ-2026-0014 and PRJ-2026-0003). Anything else is not a
// code and is not sent to the database at all.
const CODE = /^[A-Z0-9](?:[A-Z0-9-]{0,38}[A-Z0-9])?$/;

/** A code as typed or pasted, made canonical; null if it cannot be one. */
export function normaliseProjectCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let v = raw;
  try {
    v = decodeURIComponent(v);
  } catch {
    // A stray % is not a code either; fall through with what was given.
  }
  v = v.trim().toUpperCase();
  return CODE.test(v) ? v : null;
}

/** The path a short link opens: /p/FA-26-0001. */
export function shortLinkPath(code: string): string {
  return `/p/${encodeURIComponent(code)}`;
}

/**
 * The link to copy for a deal. A deal with no code yet gets its full address
 * rather than nothing -- a long link that works beats a short one that does not
 * exist.
 */
export function dealLink(origin: string, opportunityId: string, code: string | null | undefined): string {
  const base = origin.replace(/\/+$/, "");
  const c = normaliseProjectCode(code);
  return c ? `${base}${shortLinkPath(c)}` : `${base}/opportunities/${opportunityId}`;
}
