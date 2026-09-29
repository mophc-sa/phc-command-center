// =============================================================================
// Capturing client email: what is kept, what is skipped, how a deal is chosen.
// =============================================================================

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { externalAddresses, extractProjectCodes, pickOne, shouldSkip, toActivityRow, type GraphMail } from "./mail-capture.ts";

const who = (a: string) => ({ emailAddress: { address: a } });
const MAIL: GraphMail = {
  id: "g1",
  internetMessageId: "<abc@client.com>",
  conversationId: "conv-1",
  subject: "RE: Quotation FA-26-0015 revised",
  from: who("Buyer@Client.com"),
  toRecipients: [who("fisal@phc-sa.com"), who("someone@gmail.com")],
  ccRecipients: [who("pm@consultant.sa")],
  receivedDateTime: "2026-09-29T08:00:00Z",
  sentDateTime: "2026-09-29T07:59:00Z",
};

Deno.test("only outside, non-free-mail participants count", () => {
  assertEquals(externalAddresses(MAIL), ["buyer@client.com", "pm@consultant.sa"]);
  assertEquals(externalAddresses({ id: "x", from: who("a@phc-sa.com"), toRecipients: [who("b@hotmail.com")] }), []);
});

Deno.test("private, drafts and removals are skipped before anything is read", () => {
  assertEquals(shouldSkip(MAIL), null);
  const sens = (v: string) => ({ ...MAIL, singleValueExtendedProperties: [{ id: "Integer 0x36", value: v }] });
  assertEquals(shouldSkip(sens("2")), "private");
  assertEquals(shouldSkip(sens("1")), "private");
  assertEquals(shouldSkip(sens("0")), null);
  assertEquals(shouldSkip(sens("3")), null, "confidential is business mail, not personal");
  assertEquals(shouldSkip({ ...MAIL, categories: ["Private"] }), "private");
  assertEquals(shouldSkip({ ...MAIL, isDraft: true }), "draft");
  assertEquals(shouldSkip({ ...MAIL, "@removed": { reason: "deleted" } }), "removed");
  assertEquals(shouldSkip({ ...MAIL, internetMessageId: null }), "no_message_id");
});

Deno.test("project codes, new and legacy, are found once each", () => {
  assertEquals(extractProjectCodes("RE: fa-26-0015 and FA-26-0015, also RFQ-2026-0003 and FA-RFQ-2026-0009"),
    ["FA-26-0015", "RFQ-2026-0003", "FA-RFQ-2026-0009"]);
  assertEquals(extractProjectCodes("Meeting on 2026-09-29"), []);
  assertEquals(extractProjectCodes(null), []);
});

Deno.test("a deal is chosen only when there is exactly one candidate", () => {
  assertEquals(pickOne(["o1", "o1", null]), "o1");
  assertEquals(pickOne(["o1", "o2"]), null);
  assertEquals(pickOne([]), null);
});

Deno.test("inbound mail becomes a received email; the key is the internet message id", () => {
  const r = toActivityRow(MAIL, "inbox", "u1", { contactId: "c1", companyId: "co1" }, { opportunityId: "o1", rule: "code" }, "Please see attached.");
  assertEquals(r.activity_type, "email_received");
  assertEquals(r.status, "logged");
  assertEquals(r.provider_message_id, "imid:<abc@client.com>");
  assertEquals(r.email_conversation_id, "conv-1");
  assertEquals(r.related_opportunity_id, "o1");
  assertEquals(r.occurred_at, "2026-09-29T08:00:00Z");
  assertEquals(r.email_from, "buyer@client.com");
  assertEquals(r.sent_at, null);
});

Deno.test("mail sent from Outlook becomes a sent email, so it counts as client contact", () => {
  const r = toActivityRow(MAIL, "sentitems", "u1", { contactId: null, companyId: "co1" }, { opportunityId: null, rule: null }, null);
  assertEquals([r.activity_type, r.status, r.sent_by, r.occurred_at], ["email_draft", "sent", "u1", "2026-09-29T07:59:00Z"]);
  assertEquals(r.draft_content, null);
});
