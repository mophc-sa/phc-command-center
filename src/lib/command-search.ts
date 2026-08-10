// Command palette search helpers.
//
// QA 2026-08-10 (ISSUE-001/ISSUE-002): record results were rendered as
// <CommandItem value={`result-${uuid}`}>. cmdk filters items client-side by
// scoring that value against the typed query, and a UUID only contains hex
// characters — so "acc" fuzzy-matched a UUID while "MURABBA", "Janadriya" and
// "ajwad" could not. Server-side matches were fetched and then silently hidden
// by the client filter, and because `results.length > 0` suppressed the empty
// state, the dialog rendered blank with no feedback.
//
// The palette now turns cmdk's filter off entirely (records are already
// filtered by the server's ilike, pages by `filterPages` below) and gives every
// item a human-readable search value. These helpers are pure so the behaviour
// is unit-testable without a DOM.

export type RecordType = "opportunity" | "account" | "project" | "contact";

export type SearchResult = {
  id: string;
  type: RecordType;
  label: string;
  sub?: string;
  to: string;
  /** Text handed to cmdk as the item value — never a bare UUID. */
  searchValue: string;
};

export type SearchablePage = {
  to: string;
  labelEn: string;
  labelAr: string;
  group: string;
};

type CompanyRow = { id: string; name: string | null };
type OpportunityRow = { id: string; project_name: string | null };
type ProjectRow = { id: string; name: string | null };
type ContactRow = { id: string; name: string | null; title?: string | null };

export type SearchRows = {
  companies?: CompanyRow[] | null;
  opportunities?: OpportunityRow[] | null;
  projects?: ProjectRow[] | null;
  contacts?: ContactRow[] | null;
};

/** Minimum query length before the palette hits the network. */
export const MIN_QUERY_LENGTH = 2;

function searchValueFor(type: RecordType, id: string, label: string, sub?: string): string {
  // The id stays in the value so cmdk keys remain unique across types, but the
  // label leads so a human query can actually match it.
  return [label, sub, type, id].filter(Boolean).join(" ");
}

/**
 * Contacts have no detail route, so a contact hit deep-links into the contacts
 * list pre-filtered by name rather than dropping the user on an unfiltered page.
 */
export function contactDeepLink(name: string): string {
  return `/contacts?q=${encodeURIComponent(name)}`;
}

export function buildSearchResults(rows: SearchRows): SearchResult[] {
  const out: SearchResult[] = [];

  for (const r of rows.companies ?? []) {
    const label = r.name?.trim();
    if (!label) continue;
    out.push({
      id: r.id,
      type: "account",
      label,
      to: `/accounts/${r.id}`,
      searchValue: searchValueFor("account", r.id, label),
    });
  }

  for (const r of rows.opportunities ?? []) {
    const label = r.project_name?.trim();
    if (!label) continue;
    out.push({
      id: r.id,
      type: "opportunity",
      label,
      to: `/opportunities/${r.id}`,
      searchValue: searchValueFor("opportunity", r.id, label),
    });
  }

  for (const r of rows.projects ?? []) {
    const label = r.name?.trim();
    if (!label) continue;
    out.push({
      id: r.id,
      type: "project",
      label,
      to: `/projects/${r.id}`,
      searchValue: searchValueFor("project", r.id, label),
    });
  }

  for (const r of rows.contacts ?? []) {
    const label = r.name?.trim();
    if (!label) continue;
    const sub = r.title?.trim() || undefined;
    out.push({
      id: r.id,
      type: "contact",
      label,
      sub,
      to: contactDeepLink(label),
      searchValue: searchValueFor("contact", r.id, label, sub),
    });
  }

  return out;
}

export function filterPages<T extends SearchablePage>(pages: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return pages;
  return pages.filter(
    (p) =>
      p.labelEn.toLowerCase().includes(q) ||
      p.labelAr.includes(query.trim()) ||
      p.group.toLowerCase().includes(q),
  );
}

/**
 * The palette shows "no results" only once the search has actually settled and
 * nothing matched — records or pages. Previously a non-empty `results` array
 * suppressed this even when cmdk had hidden every one of those results.
 */
export function isCommandEmpty({
  searching,
  query,
  resultCount,
  pageCount,
}: {
  searching: boolean;
  query: string;
  resultCount: number;
  pageCount: number;
}): boolean {
  if (searching) return false;
  if (query.trim().length < MIN_QUERY_LENGTH) return false;
  return resultCount === 0 && pageCount === 0;
}
