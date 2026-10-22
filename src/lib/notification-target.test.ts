import { describe, expect, it } from "bun:test";
import { lookupFor, resolveTarget, targetFor } from "@/lib/notification-target";

const n = (entity_type: string | null, entity_id: string | null) => ({ entity_type, entity_id });

describe("a notification about a deal opens the deal", () => {
  it("goes to the opportunity page when the record names one", () => {
    // The reported complaint: an approval notification landed on /approvals,
    // a page of approvals, and the reader had to find the one they were told
    // about — which is the work the notification existed to save.
    expect(targetFor(n("approval", "a1"), "opp-9")).toEqual({ to: "/opportunities/opp-9" });
    expect(targetFor(n("quotation", "q1"), "opp-9")).toEqual({ to: "/opportunities/opp-9" });
    expect(targetFor(n("rfq", "r1"), "opp-9")).toEqual({ to: "/opportunities/opp-9" });
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
    expect(targetFor(n("approval", "a1"), null)).toEqual({ to: "/approvals", search: { focus: "a1" } });
    expect(targetFor(n("tender", "t1"), null)).toEqual({ to: "/tenders", search: { focus: "t1" } });
    expect(targetFor(n("inbox_item", "i1"), null)).toEqual({ to: "/lead-tender-inbox", search: { focus: "i1" } });
    expect(targetFor(n("rfq", "r1"), null)).toEqual({ to: "/quotations", search: { focus: "r1" } });
  });

  it("passes the id as a search param, not pasted into the path", () => {
    expect(targetFor(n("tender", "a b&c"), null)).toEqual({ to: "/tenders", search: { focus: "a b&c" } });
  });

  it("falls back to the work queue when there is nothing to point at", () => {
    expect(targetFor(n("approval", null), null)).toEqual({ to: "/action-center" });
    expect(targetFor(n(null, null), null)).toEqual({ to: "/action-center" });
    expect(targetFor(n("something_new", "x"), null)).toEqual({ to: "/action-center" });
  });
});

describe("an opportunity notification", () => {
  it("goes straight there, with or without a lookup", () => {
    expect(targetFor(n("opportunity", "opp-1"), null)).toEqual({ to: "/opportunities/opp-1" });
    expect(targetFor(n("opportunity", "opp-1"), "opp-1")).toEqual({ to: "/opportunities/opp-1" });
  });
});

describe("what the trigger already said (reported 2026-10-19)", () => {
  const m = (entity_type: string, entity_id: string, metadata: unknown) => ({ entity_type, entity_id, metadata });

  it("opens the deal named in metadata without a lookup", () => {
    expect(targetFor(m("approval", "a1", { opportunity_id: "opp-3" }), null)).toEqual({ to: "/opportunities/opp-3" });
  });

  it("opens the deal a task belongs to, not the workspace", () => {
    expect(targetFor(m("task", "t1", { opportunity_id: "opp-4" }), null)).toEqual({ to: "/opportunities/opp-4" });
  });

  it("opens the meeting a deal-less meeting task came from", () => {
    expect(targetFor(m("task", "t1", { meeting_id: "mt-1" }), null)).toEqual({ to: "/meetings/mt-1" });
    expect(targetFor(m("task", "t1", {}), null)).toEqual({ to: "/my-workspace" });
  });

  it("opens the meeting waiting for review, or the list for the daily digest (2026-10-22)", () => {
    expect(targetFor(m("meeting", "mt-2", { meeting_id: "mt-2" }), null)).toEqual({ to: "/meetings/mt-2" });
    expect(targetFor(m("meeting", "mt-oldest", { digest: true, pending: 4 }), null)).toEqual({ to: "/meetings" });
  });

  it("ignores metadata that is not a usable id", () => {
    expect(targetFor(m("approval", "a1", { opportunity_id: 7 }), null)).toEqual({ to: "/approvals", search: { focus: "a1" } });
    expect(targetFor(m("approval", "a1", "junk"), null)).toEqual({ to: "/approvals", search: { focus: "a1" } });
  });
});

describe("resolveTarget", () => {
  const reads: string[] = [];
  const db: Record<string, Record<string, unknown>> = {
    "inbox_items:i-conv": { converted_record_type: "rfq", converted_record_id: "r-1" },
    "inbox_items:i-open": { converted_record_type: null, converted_record_id: null },
    "rfqs:r-1": { opportunity_id: "opp-7" },
    "approvals:a-hidden": {},
  };
  const read = async (table: string, _cols: string, id: string) => {
    reads.push(`${table}:${id}`);
    return db[`${table}:${id}`] ?? null;
  };

  it("follows a converted intake item to the deal it became", async () => {
    expect(await resolveTarget({ entity_type: "inbox_item", entity_id: "i-conv" }, read)).toEqual({ to: "/opportunities/opp-7" });
  });

  it("keeps an unconverted intake item on the inbox, focused", async () => {
    expect(await resolveTarget({ entity_type: "inbox_item", entity_id: "i-open" }, read)).toEqual({
      to: "/lead-tender-inbox",
      search: { focus: "i-open" },
    });
  });

  it("reads nothing when metadata already names the deal", async () => {
    reads.length = 0;
    expect(
      await resolveTarget({ entity_type: "approval", entity_id: "a-hidden", metadata: { opportunity_id: "opp-1" } }, read),
    ).toEqual({ to: "/opportunities/opp-1" });
    expect(reads).toEqual([]);
  });

  it("falls back to the focused list when the row is hidden", async () => {
    expect(await resolveTarget({ entity_type: "approval", entity_id: "a-hidden" }, read)).toEqual({
      to: "/approvals",
      search: { focus: "a-hidden" },
    });
  });
});
