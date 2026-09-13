// =============================================================================
// The Outlook calendar feed: what goes in, and whether Outlook can read it.
// =============================================================================

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  collectFeedEvents,
  FEED_TOKEN_LENGTH,
  foldLine,
  icsText,
  isFeedToken,
  newFeedToken,
  toICS,
} from "./calendar-feed.ts";

const NOW = new Date("2026-09-13T10:00:00Z");
const APP = "https://agent.phc-sa.com";

Deno.test("open obligations become all-day events; closed work does not", () => {
  const events = collectFeedEvents({
    followUps: [
      { id: "f1", opportunity_id: "o1", due_date: "2026-09-15", status: "scheduled", channel: "call" },
      { id: "f2", opportunity_id: "o1", due_date: "2026-09-16", status: "completed" },
    ],
    opportunities: [
      { id: "o1", project_name: "Westfield", next_action: "Send BOQ", next_action_due: "2026-09-14", sales_stage: "negotiation" },
      { id: "o2", project_name: "Won deal", next_action_due: "2026-09-14", sales_stage: "won", hold_review_date: "2026-09-20" },
    ],
    rfqs: [
      { id: "r1", rfq_number: "RFQ-7", response_due_date: "2026-09-17", status: "open" },
      { id: "r2", response_due_date: "2026-09-17", status: "quoted" },
    ],
    tasks: [
      { id: "t1", title: "Price it", due_date: "2026-09-18" },
      { id: "t2", title: "Done", due_date: "2026-09-18", completed_at: "2026-09-01" },
    ],
  });
  assertEquals(events.map((e) => e.uid), [
    "next_action-o1",
    "follow_up-f1",
    "rfq-r1",
    "task-t1",
    // A closed deal still owes its hold review, as in the app.
    "hold_review-o2",
  ]);
  assertEquals(events[0].summary, "Send BOQ — Westfield");
  assertEquals(events[0].path, "/opportunities/o1");
});

Deno.test("an undated or malformed date never becomes an event", () => {
  const events = collectFeedEvents({
    tasks: [
      { id: "a", title: "no date", due_date: null },
      { id: "b", title: "junk", due_date: "soon" },
    ],
  });
  assertEquals(events, []);
});

Deno.test("a flag links to its deal only when it is attached to one", () => {
  const events = collectFeedEvents({
    flags: [
      { id: "g1", reason: "No contact", due_date: "2026-09-15", status: "open", linked_record_type: "opportunity", linked_record_id: "o9" },
      { id: "g2", reason: "Tender risk", due_date: "2026-09-15", status: "open", linked_record_type: "tender", linked_record_id: "t9" },
    ],
  });
  assertEquals(events.find((e) => e.uid === "flag-g1")?.path, "/opportunities/o9");
  assertEquals(events.find((e) => e.uid === "flag-g2")?.path, null);
});

Deno.test("text is escaped for iCalendar", () => {
  assertEquals(icsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
});

Deno.test("lines fold at 75 octets without splitting an Arabic letter", () => {
  const arabic = "SUMMARY:" + "مشروع لوحات الدرعية ".repeat(6);
  const folded = foldLine(arabic);
  const enc = new TextEncoder();
  for (const [i, part] of folded.split("\r\n").entries()) {
    const content = i === 0 ? part : part.slice(1); // drop the continuation space
    assert(enc.encode(part).length <= 75, `line ${i} is ${enc.encode(part).length} octets`);
    if (i > 0) assertEquals(part[0], " ");
    // Every part decodes cleanly: no half of a multi-byte character.
    assertEquals(new TextDecoder("utf-8", { fatal: true }).decode(enc.encode(content)), content);
  }
  // Unfolding restores the original exactly.
  assertEquals(folded.replace(/\r\n /g, ""), arabic);
});

Deno.test("the feed is a calendar Outlook can parse", () => {
  const ics = toICS(
    [{ uid: "task-t1", date: "2026-09-18", summary: "Price it, today; urgent", path: "/opportunities/o1" }],
    { appUrl: APP + "/", now: NOW, name: "PHC — My work" },
  );
  assert(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert(ics.endsWith("END:VCALENDAR\r\n"));
  assertFalse(/[^\r]\n/.test(ics), "every line ends in CRLF");
  assert(ics.includes("UID:task-t1@phc-command-center\r\n"));
  assert(ics.includes("DTSTAMP:20260913T100000Z\r\n"));
  assert(ics.includes("DTSTART;VALUE=DATE:20260918\r\n"));
  // All-day events end on the following day (exclusive).
  assert(ics.includes("DTEND;VALUE=DATE:20260919\r\n"));
  assert(ics.includes("SUMMARY:Price it\\, today\\; urgent\r\n"));
  assert(ics.includes("URL:https://agent.phc-sa.com/opportunities/o1\r\n"), "no double slash from a trailing /");
});

Deno.test("an event with no record has no link rather than a broken one", () => {
  const ics = toICS([{ uid: "x", date: "2026-09-18", summary: "Tender follow-up", path: null }], {
    appUrl: APP,
    now: NOW,
    name: "PHC",
  });
  assertFalse(ics.includes("URL:"));
  assertFalse(ics.includes("DESCRIPTION:"));
});

Deno.test("a month-end all-day event ends on the first of the next month", () => {
  const ics = toICS([{ uid: "m", date: "2026-02-28", summary: "x", path: null }], { appUrl: APP, now: NOW, name: "PHC" });
  assert(ics.includes("DTEND;VALUE=DATE:20260301\r\n"));
});

Deno.test("feed tokens are long, unambiguous and well-formed", () => {
  const t = newFeedToken();
  assertEquals(t.length, FEED_TOKEN_LENGTH);
  assert(isFeedToken(t));
  assertFalse(/[ILOU]/.test(t));
  assertFalse(isFeedToken(t.slice(1)));
  assertFalse(isFeedToken(t.toLowerCase()));
});
