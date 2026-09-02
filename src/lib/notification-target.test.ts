import { describe, expect, it } from "bun:test";
import { lookupFor, targetFor } from "@/lib/notification-target";

const n = (entity_type: string | null, entity_id: string | null) => ({ entity_type, entity_id });

describe("a notification about a deal opens the deal", () => {
  it("goes to the opportunity page when the record names one", () => {
    // The reported complaint: an approval notification landed on /approvals,
    // a page of approvals, and the reader had to find the one they were told
    // about — which is the work the notification existed to save.
    expect(targetFor(n("approval", "a1"), "opp-9")).toBe("/opportunities/opp-9");
    expect(targetFor(n("quotation", "q1"), "opp-9")).toBe("/opportunities/opp-9");
    expect(targetFor(n("rfq", "r1"), "opp-9")).toBe("/opportunities/opp-9");
  });

  it("says which tables have to be read first", () => {
    expect(lookupFor(n("approval", "a1"))).toEqual({ table: "approvals", column: "related_opportunity_id" });
    expect(lookupFor(n("rfq", "r1"))).toEqual({ table: "rfqs", column: "opportunity_id" });
    expect(lookupFor(n("quotation", "q1"))).toEqual({ table: "quotations", column: "related_opportunity_id" });
  });

  it("reads nothing for a type that already knows where it goes", () => {
    // An extra query per click, for an answer already in hand.
    expect(lookupFor(n("opportunity", "opp-1"))).toBeNull();
    expect(lookupFor(n("tender", "t1"))).toBeNull();
    expect(lookupFor(n("approval", null))).toBeNull();
  });
});

describe("when the record names no deal", () => {
  it("still says which row was meant", () => {
    // 5 of 11 RFQs carry no opportunity. Dropping the id would send the reader
    // to a list with nothing to distinguish the row they were told about.
    expect(targetFor(n("approval", "a1"), null)).toBe("/approvals?focus=a1");
    expect(targetFor(n("tender", "t1"), null)).toBe("/tenders?focus=t1");
    expect(targetFor(n("inbox_item", "i1"), null)).toBe("/lead-tender-inbox?focus=i1");
    expect(targetFor(n("rfq", "r1"), null)).toBe("/quotations?focus=r1");
  });

  it("escapes the id rather than pasting it into a URL", () => {
    expect(targetFor(n("tender", "a b&c"), null)).toBe("/tenders?focus=a%20b%26c");
  });

  it("falls back to the work queue when there is nothing to point at", () => {
    expect(targetFor(n("approval", null), null)).toBe("/action-center");
    expect(targetFor(n(null, null), null)).toBe("/action-center");
    expect(targetFor(n("something_new", "x"), null)).toBe("/action-center");
  });
});

describe("an opportunity notification", () => {
  it("goes straight there, with or without a lookup", () => {
    expect(targetFor(n("opportunity", "opp-1"), null)).toBe("/opportunities/opp-1");
    expect(targetFor(n("opportunity", "opp-1"), "opp-1")).toBe("/opportunities/opp-1");
  });
});
