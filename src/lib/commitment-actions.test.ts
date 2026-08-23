// =============================================================================
// The commitment rules that decide what a person sees, tested without a browser.
//
// The database owns the invariants — immutable terms, stamped closes, no
// deletes — and the behavioural suite proves those. What is left here is the
// presentation logic, and it is worth testing because getting urgency or
// direction wrong makes the panel quietly useless rather than visibly broken.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  commitmentUrgency, daysUntil, sortCommitments, summariseCommitments,
  type Commitment,
} from "@/lib/commitment-actions";

const TODAY = new Date("2026-08-23T09:00:00Z");

function c(over: Partial<Commitment>): Commitment {
  return {
    id: crypto.randomUUID(),
    opportunity_id: "o1",
    company_id: null,
    contact_id: null,
    direction: "we_owe_client",
    description: "Revised drawing",
    due_date: "2026-08-23",
    owner_id: null,
    status: "open",
    source_activity_id: null,
    closed_at: null,
    closed_by: null,
    outcome_note: null,
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("days are counted in whole days, not hours", () => {
  it("today is zero regardless of the time of day", () => {
    // A promise due today is due today at 09:00 and at 23:00. Counting by
    // elapsed hours would flip it to overdue over lunch.
    expect(daysUntil("2026-08-23", TODAY)).toBe(0);
    expect(daysUntil("2026-08-23", new Date("2026-08-23T23:59:00Z"))).toBe(0);
  });

  it("counts forward and backward", () => {
    expect(daysUntil("2026-08-26", TODAY)).toBe(3);
    expect(daysUntil("2026-08-20", TODAY)).toBe(-3);
  });

  it("crosses a month boundary", () => {
    expect(daysUntil("2026-09-01", TODAY)).toBe(9);
  });
});

describe("urgency", () => {
  it("a past date on an open commitment is overdue", () => {
    expect(commitmentUrgency(c({ due_date: "2026-08-20" }), TODAY)).toBe("overdue");
  });

  it("today is its own state, louder than soon", () => {
    expect(commitmentUrgency(c({ due_date: "2026-08-23" }), TODAY)).toBe("today");
  });

  it("soon is three days, not a week", () => {
    // Signage lead times run in weeks; a promise due in six days is not yet
    // actionable, one due in two is.
    expect(commitmentUrgency(c({ due_date: "2026-08-26" }), TODAY)).toBe("soon");
    expect(commitmentUrgency(c({ due_date: "2026-08-27" }), TODAY)).toBe("later");
  });

  it("a closed commitment is never overdue, whatever its date", () => {
    // Otherwise last quarter's met promises would shout on every deal forever.
    for (const status of ["met", "missed", "waived", "cancelled"] as const) {
      expect(commitmentUrgency(c({ due_date: "2020-01-01", status }), TODAY)).toBe("closed");
    }
  });
});

describe("ordering", () => {
  it("open first by soonest date, closed last by most recently closed", () => {
    const rows = [
      c({ description: "closed-old", status: "met", due_date: "2026-01-01", closed_at: "2026-01-02T00:00:00Z" }),
      c({ description: "open-later", due_date: "2026-09-30" }),
      c({ description: "closed-new", status: "missed", due_date: "2026-02-01", closed_at: "2026-08-01T00:00:00Z" }),
      c({ description: "open-soon", due_date: "2026-08-24" }),
    ];
    expect(sortCommitments(rows).map((r) => r.description))
      .toEqual(["open-soon", "open-later", "closed-new", "closed-old"]);
  });

  it("does not mutate its input", () => {
    const rows = [c({ due_date: "2026-09-01" }), c({ due_date: "2026-08-01" })];
    const before = rows.map((r) => r.due_date);
    sortCommitments(rows);
    expect(rows.map((r) => r.due_date)).toEqual(before);
  });
});

describe("the summary keeps the two directions apart", () => {
  const rows = [
    c({ direction: "we_owe_client", due_date: "2026-08-20" }),               // ours, late
    c({ direction: "we_owe_client", due_date: "2026-09-10" }),               // ours, fine
    c({ direction: "client_owes_us", due_date: "2026-08-01" }),              // theirs, late
    c({ direction: "client_owes_us", due_date: "2026-08-05", status: "met" }),
    c({ direction: "we_owe_client", due_date: "2026-07-01", status: "missed" }),
  ];

  it("counts open promises by who owes them", () => {
    const s = summariseCommitments(rows, TODAY);
    expect(s.open).toBe(3);
    expect(s.weOwe).toBe(2);
    expect(s.theyOwe).toBe(1);
  });

  it("splits overdue by direction too", () => {
    // A promise we broke and a client gone quiet are different management
    // problems; a single "2 overdue" would hide which one this deal has.
    const s = summariseCommitments(rows, TODAY);
    expect(s.overdue).toBe(2);
    expect(s.weOweOverdue).toBe(1);
    expect(s.theyOweOverdue).toBe(1);
  });

  it("closed commitments count as history, never as open or overdue", () => {
    const s = summariseCommitments(rows, TODAY);
    expect(s.met).toBe(1);
    expect(s.missed).toBe(1);
    expect(s.open).toBe(3);
  });

  it("an empty deal summarises to zeroes rather than NaN", () => {
    const s = summariseCommitments([], TODAY);
    expect(s).toEqual({
      open: 0, weOwe: 0, theyOwe: 0, overdue: 0,
      weOweOverdue: 0, theyOweOverdue: 0, met: 0, missed: 0,
    });
  });
});
