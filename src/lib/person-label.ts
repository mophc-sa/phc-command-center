// =============================================================================
// How a person is named on a record.
//
// Asked for on 2026-09-06: the sales code should appear on the records, and the
// name should sit beside the project number.
//
// One function, because the alternative is what the codebase already had --
// `m.full_name || m.email || m.id.slice(0, 8)` written out at each call site,
// which is how the same person ends up labelled three ways on three screens.
// A truncated UUID is not a name; it is what a screen shows when nobody decided
// what it should show.
//
// The code is an identifier, not a decoration, so it is never invented: a
// person without one is shown by name alone rather than by a placeholder that
// looks like a code.
// =============================================================================

export type Person = {
  full_name?: string | null;
  email?: string | null;
  sales_code?: string | null;
};

/** The name alone, falling back to the part of the email before the @. */
export function personName(p: Person | null | undefined): string {
  const full = p?.full_name?.trim();
  if (full) return full;
  const email = p?.email?.trim();
  if (email) return email.split("@")[0] ?? email;
  return "";
}

/**
 * Name and code, for anywhere a person is credited on a record.
 *
 * `Marie Falome · MA`. The separator is a middle dot rather than brackets
 * because the code is not an aside -- it is how the person is referred to on
 * paper, and it should read as part of the name.
 */
export function personLabel(p: Person | null | undefined): string {
  const name = personName(p);
  const code = p?.sales_code?.trim();
  if (!name) return code ?? "";
  return code ? `${name} · ${code}` : name;
}

/**
 * A record's number with the person who entered it beside it.
 *
 * `PRJ-0007 · Marie Falome · MA`. When there is no number there is nothing to
 * put a name beside, so this returns the empty string rather than a lone name
 * pretending to be a reference.
 */
export function numberWithEnterer(num: string | null | undefined, p: Person | null | undefined): string {
  const n = num?.trim();
  if (!n) return "";
  const who = personLabel(p);
  return who ? `${n} · ${who}` : n;
}
