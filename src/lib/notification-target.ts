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
};

/** Which table, if any, has to be read before the destination is known. */
export type Lookup =
  | { table: "approvals"; column: "related_opportunity_id" }
  | { table: "rfqs"; column: "opportunity_id" }
  | { table: "quotations"; column: "related_opportunity_id" };

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
 * The fallback carries `?focus=<id>` rather than dropping the id on the floor.
 * A list that knows which row was meant can at least mark it; one that ignores
 * the parameter is no worse off than before.
 */
export function targetFor(n: NotificationLike, opportunityId: string | null): string {
  if (opportunityId) return `/opportunities/${opportunityId}`;
  if (!n.entity_id) return "/action-center";
  const focus = `?focus=${encodeURIComponent(n.entity_id)}`;
  switch (n.entity_type) {
    case "opportunity": return `/opportunities/${n.entity_id}`;
    case "inbox_item": return `/lead-tender-inbox${focus}`;
    case "approval": return `/approvals${focus}`;
    case "tender": return `/tenders${focus}`;
    case "rfq":
    case "quotation": return `/quotations${focus}`;
    default: return "/action-center";
  }
}
