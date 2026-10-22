// =============================================================================
// Where a notification should take you.
//
// Reported 2026-09-02: "when clicking the notification it should move him to
// the project page itself, or to the action in the notification's place
// directly."
//
// `notificationHref` sent five of its seven entity types to a LIST: an approval
// landed you on /approvals, an RFQ on /quotations, an intake item on the inbox.
// The notification named one record and the click produced a page of them, so
// the reader had to find it again — which is the work the notification existed
// to save.
//
// Four of those five are ABOUT an opportunity. An approval is an approval OF a
// deal, a quotation is a quotation FOR one, an RFQ belongs to one. Measured on
// production: 45 of 45 quotations and 6 of 11 RFQs carry the link. So the
// destination is the opportunity page — "the project page itself", literally
// what was asked for.
//
// The routing DECISION is separated from the lookup on purpose. Deciding where
// to go given what was found is the part with rules worth testing; fetching the
// row is a query.
// =============================================================================

export type NotificationLike = {
  entity_type: string | null;
  entity_id: string | null;
  /** What the emitting trigger already knows, e.g. `opportunity_id`, `meeting_id`. */
  metadata?: unknown;
};

/** A router destination. Search params travel separately, never inside `to`. */
export type Target = { to: string; search?: Record<string, string> };

/** Which table, if any, has to be read before the destination is known. */
export type Lookup =
  | { table: "approvals"; column: "related_opportunity_id" }
  | { table: "rfqs"; column: "opportunity_id" }
  | { table: "quotations"; column: "related_opportunity_id" };

function metaString(n: NotificationLike, key: string): string | null {
  const m = n.metadata;
  if (!m || typeof m !== "object") return null;
  const v = (m as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : null;
}

/**
 * The deal the emitting trigger already named. Reported 2026-10-19: "clicking
 * the notification does not open the project page." Approval, task and meeting
 * notifications carry `metadata.opportunity_id`, but the click ignored it and
 * read the row instead — and a row the reader cannot see (RLS) or one with no
 * link sent them to a list, or to their own workspace.
 */
export function metadataOpportunityId(n: NotificationLike): string | null {
  return metaString(n, "opportunity_id");
}

export function lookupFor(n: NotificationLike): Lookup | null {
  if (!n.entity_id) return null;
  switch (n.entity_type) {
    case "approval": return { table: "approvals", column: "related_opportunity_id" };
    case "rfq": return { table: "rfqs", column: "opportunity_id" };
    case "quotation": return { table: "quotations", column: "related_opportunity_id" };
    default: return null;
  }
}

/**
 * The destination, given the notification and whatever the lookup found.
 *
 * `opportunityId` is what the lookup returned: a string when the record names a
 * deal, null when it does not or when there was nothing to look up.
 *
 * The fallback carries `focus=<id>` rather than dropping the id on the floor.
 * A list that knows which row was meant can at least mark it; one that ignores
 * the parameter is no worse off than before.
 */
export function targetFor(n: NotificationLike, opportunityId: string | null): Target {
  const opp = opportunityId ?? metadataOpportunityId(n);
  if (opp) return { to: `/opportunities/${opp}` };
  if (!n.entity_id) return { to: "/action-center" };
  const focus = { focus: n.entity_id };
  switch (n.entity_type) {
    case "opportunity": return { to: `/opportunities/${n.entity_id}` };
    case "inbox_item": return { to: "/lead-tender-inbox", search: focus };
    // A reminder about a client rather than a deal (group 5) opens the client.
    case "company": return { to: `/accounts/${n.entity_id}` };
    case "approval": return { to: "/approvals", search: focus };
    case "tender": return { to: "/tenders", search: focus };
    case "rfq":
    case "quotation": return { to: "/quotations", search: focus };
    case "task": {
      // A task from a meeting opens the meeting it came out of; any other
      // task without a deal lands on the owner's day.
      const meeting = metaString(n, "meeting_id");
      return meeting ? { to: `/meetings/${meeting}` } : { to: "/my-workspace" };
    }
    default: return { to: "/action-center" };
  }
}

/** Reads one row by id; null when it is missing or hidden. */
export type ReadRow = (table: string, columns: string, id: string) => Promise<Record<string, unknown> | null>;

/**
 * Everything a click needs, reads included. An intake item that has since been
 * converted is followed to what it became — the manager was told about a
 * request, and by the time they click it is a deal.
 */
export async function resolveTarget(n: NotificationLike, read: ReadRow): Promise<Target> {
  if (metadataOpportunityId(n) || !n.entity_id) return targetFor(n, null);

  if (n.entity_type === "inbox_item") {
    const row = await read("inbox_items", "converted_record_type, converted_record_id", n.entity_id);
    const type = typeof row?.converted_record_type === "string" ? row.converted_record_type : null;
    const id = typeof row?.converted_record_id === "string" ? row.converted_record_id : null;
    if (type && id && type !== "inbox_item") return resolveTarget({ entity_type: type, entity_id: id }, read);
    return targetFor(n, null);
  }

  const lookup = lookupFor(n);
  if (!lookup) return targetFor(n, null);
  const row = await read(lookup.table, lookup.column, n.entity_id);
  const opp = row?.[lookup.column];
  return targetFor(n, typeof opp === "string" ? opp : null);
}
