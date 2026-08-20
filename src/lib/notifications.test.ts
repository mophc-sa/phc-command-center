import { describe, expect, it } from "bun:test";
import {
  badgeLabel,
  isUnread,
  notificationHref,
  notificationTypeKey,
  severityTone,
  unreadCount,
  type NotificationRow,
} from "@/lib/notifications";

function n(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n1",
    notification_type: "stage_changed",
    entity_type: "opportunity",
    entity_id: "opp-1",
    title: "Riyadh Tower",
    body: "Stage moved to jih.",
    severity: "info",
    source_event: "stage_changed",
    metadata: null,
    created_at: "2026-08-19T00:00:00Z",
    read_at: null,
    dismissed_at: null,
    ...over,
  };
}

describe("read state", () => {
  it("unread means neither read nor dismissed", () => {
    expect(isUnread(n())).toBe(true);
    expect(isUnread(n({ read_at: "2026-08-19T01:00:00Z" }))).toBe(false);
    // Dismissing implies acknowledgement, so a dismissed row is never unread.
    expect(isUnread(n({ dismissed_at: "2026-08-19T01:00:00Z" }))).toBe(false);
  });

  it("counts only unread rows", () => {
    expect(
      unreadCount([n(), n({ id: "n2", read_at: "x" }), n({ id: "n3" }), n({ id: "n4", dismissed_at: "x" })]),
    ).toBe(2);
  });

  it("caps the badge at 9+ and hides it at zero", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(-1)).toBeNull();
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(500)).toBe("9+");
  });
});

describe("navigation", () => {
  // Intake notifications point at inbox_items; sending them to /opportunities
  // would 404 because the opportunity does not exist until after approval.
  it("routes an intake notification to the inbox", () => {
    expect(notificationHref(n({ entity_type: "inbox_item", entity_id: "i1" }))).toBe("/lead-tender-inbox");
  });

  it("routes an opportunity notification to its detail page", () => {
    expect(notificationHref(n())).toBe("/opportunities/opp-1");
  });

  it("routes approvals, tenders and quotations to their pages", () => {
    expect(notificationHref(n({ entity_type: "approval", entity_id: "a1" }))).toBe("/approvals");
    expect(notificationHref(n({ entity_type: "tender", entity_id: "t1" }))).toBe("/tenders");
    expect(notificationHref(n({ entity_type: "quotation", entity_id: "q1" }))).toBe("/quotations");
    expect(notificationHref(n({ entity_type: "rfq", entity_id: "r1" }))).toBe("/quotations");
  });

  it("falls back safely when there is no entity", () => {
    expect(notificationHref(n({ entity_id: null }))).toBe("/action-center");
    expect(notificationHref(n({ entity_type: "system", entity_id: "x" }))).toBe("/action-center");
  });
});

describe("presentation", () => {
  it("maps severity to a tone", () => {
    expect(severityTone("critical")).toBe("danger");
    expect(severityTone("attention")).toBe("attention");
    expect(severityTone("info")).toBe("neutral");
    expect(severityTone("nonsense")).toBe("neutral");
  });

  it("derives the i18n key from the type", () => {
    expect(notificationTypeKey("intake_approved")).toBe("notif_type_intake_approved");
  });
});

// The DB is the authority on dedupe; these pin the *contract* the UI relies on
// so a schema change that breaks it is caught here too. The behavioural proof
// runs against Postgres — see the Phase 4 migration test.
describe("event/type coverage", () => {
  const EMITTED_TYPES = [
    "intake_review_requested",
    "intake_need_information",
    "intake_resubmitted",
    "intake_approved",
    "intake_rejected",
    "intake_assigned",
    "approval_requested",
    "approval_approved",
    "approval_rejected",
    "stage_changed",
    "handoff_changed",
    "assigned",
    "item_overdue",
  ];

  it("every emitted type has a distinct i18n key", () => {
    const keys = EMITTED_TYPES.map(notificationTypeKey);
    expect(new Set(keys).size).toBe(EMITTED_TYPES.length);
  });

  it("every emitted type resolves to a real route", () => {
    for (const type of EMITTED_TYPES) {
      const entity = type.startsWith("intake") ? "inbox_item" : type.startsWith("approval") ? "approval" : "opportunity";
      const href = notificationHref({ entity_type: entity, entity_id: "x" });
      expect(href.startsWith("/")).toBe(true);
      expect(href).not.toBe("/action-center");
    }
  });
});
