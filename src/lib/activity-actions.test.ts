// markActivitySent itself is a Supabase side-effecting function (fetch,
// update, audit insert) — this repo's test suite has no precedent for
// mocking the Supabase client (confirmed: no other *.test.ts file does),
// so it stays untested directly, consistent with every other action-module
// function in the codebase. What IS practical and non-fragile to test is
// the pure guard it delegates to, assertSendableDraft — it takes a plain
// object and either returns or throws, no I/O involved.
import { test, expect } from "bun:test";
import { assertSendableDraft, type Activity } from "./activity-actions";

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: "a1",
    activity_type: "email_draft",
    status: "draft",
    company_id: null,
    contact_id: null,
    related_opportunity_id: null,
    related_rfq_id: null,
    related_tender_id: null,
    template_id: null,
    owner_id: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    occurred_at: "2026-01-01T00:00:00Z",
    summary: null,
    draft_content: null,
    sent_at: null,
    sent_by: null,
    ...overrides,
  } as Activity;
}

test("assertSendableDraft accepts a draft email_draft activity", () => {
  expect(() => assertSendableDraft(activity({ activity_type: "email_draft", status: "draft" }), "a1")).not.toThrow();
});

test("assertSendableDraft accepts a draft whatsapp_draft activity", () => {
  expect(() => assertSendableDraft(activity({ activity_type: "whatsapp_draft", status: "draft" }), "a1")).not.toThrow();
});

test("assertSendableDraft throws when the activity does not exist", () => {
  expect(() => assertSendableDraft(null, "missing-id")).toThrow(/not found/i);
  expect(() => assertSendableDraft(undefined, "missing-id")).toThrow(/not found/i);
});

test("assertSendableDraft throws for non-communication activity types (call/visit/meeting/note)", () => {
  expect(() => assertSendableDraft(activity({ activity_type: "call", status: "draft" }), "a1")).toThrow(/only email_draft\/whatsapp_draft/i);
  expect(() => assertSendableDraft(activity({ activity_type: "meeting", status: "logged" }), "a1")).toThrow(/only email_draft\/whatsapp_draft/i);
  expect(() => assertSendableDraft(activity({ activity_type: "note", status: "logged" }), "a1")).toThrow(/only email_draft\/whatsapp_draft/i);
});

test("assertSendableDraft throws when status is not draft (already sent, or logged)", () => {
  expect(() => assertSendableDraft(activity({ activity_type: "email_draft", status: "sent" }), "a1")).toThrow(/only draft activities/i);
  expect(() => assertSendableDraft(activity({ activity_type: "whatsapp_draft", status: "logged" }), "a1")).toThrow(/only draft activities/i);
});
