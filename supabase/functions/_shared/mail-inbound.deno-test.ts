// =============================================================================
// Capturing a client's reply: who may post, what is kept, what is dropped.
// =============================================================================

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeInbound, readInbound, safeEqual } from "./mail-inbound.ts";

const DOMAIN = "crm.phc-sa.com";
const SECRET = "s".repeat(40);
const REPLY_ID = "0123456789ABCDEF";
const basic = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`;

const reply = (over: Record<string, unknown> = {}) => ({
  MessageID: "pm-inbound-1",
  From: "client@example.com",
  FromFull: { Email: "Client@Example.com", Name: "A Client" },
  ToFull: [
    { Email: "fisal@phc-sa.com", MailboxHash: "" },
    { Email: `reply+${REPLY_ID}@${DOMAIN}`, MailboxHash: REPLY_ID },
  ],
  Subject: "RE: Quotation for Westfield",
  TextBody: "Thanks, approved.\n\n> On Monday you wrote: the quotation…",
  StrippedTextReply: "Thanks, approved.",
  Date: "Sat, 12 Sep 2026 09:00:00 +0300",
  ...over,
});

Deno.test("only the right credentials may post", () => {
  assert(authorizeInbound(basic("postmark", SECRET), SECRET));
  assertFalse(authorizeInbound(basic("postmark", "wrong".repeat(10)), SECRET));
  assertFalse(authorizeInbound(basic("admin", SECRET), SECRET), "the secret under any other name");
  assertFalse(authorizeInbound(null, SECRET));
  assertFalse(authorizeInbound(`Bearer ${SECRET}`, SECRET));
  assertFalse(authorizeInbound("Basic !!!not-base64", SECRET));
});

Deno.test("a short or missing secret authorizes nothing, even when it matches", () => {
  assertFalse(authorizeInbound(basic("postmark", "short"), "short"));
  assertFalse(authorizeInbound(basic("postmark", ""), undefined));
});

Deno.test("comparison is length-safe", () => {
  assert(safeEqual("abc", "abc"));
  assertFalse(safeEqual("abc", "abcd"));
  assertFalse(safeEqual("", "a"));
});

Deno.test("a reply is bound by the id in the capture address, and nothing else", () => {
  const d = readInbound(reply(), DOMAIN);
  assert(d.ok);
  assertEquals(d.record.replyId, REPLY_ID);
  assertEquals(d.record.from, "client@example.com");
  assertEquals(d.record.providerMessageId, "pm-inbound-1");
});

Deno.test("the timeline gets what the client wrote, not our email quoted back", () => {
  const d = readInbound(reply(), DOMAIN);
  assert(d.ok);
  assertEquals(d.record.body, "Thanks, approved.");
  // Without a stripped reply, the full text is kept rather than nothing.
  const full = readInbound(reply({ StrippedTextReply: "" }), DOMAIN);
  assert(full.ok);
  assert(full.record.body.startsWith("Thanks, approved."));
});

Deno.test("mail that reaches the capture address without a valid id is dropped", () => {
  const noId = readInbound(reply({ ToFull: [{ Email: `hello@${DOMAIN}`, MailboxHash: "" }] }), DOMAIN);
  assertEquals(noId.ok ? null : noId.reason, "no_reply_id");
  const badId = readInbound(reply({ ToFull: [{ Email: `reply+abc@${DOMAIN}`, MailboxHash: "abc" }] }), DOMAIN);
  assertEquals(badId.ok ? null : badId.reason, "no_reply_id");
});

Deno.test("an id on some other domain is not ours", () => {
  // A MailboxHash on the salesperson's own address, or any other domain, must
  // not be read as a thread id.
  const d = readInbound(
    reply({ ToFull: [{ Email: `fisal+${REPLY_ID}@phc-sa.com`, MailboxHash: REPLY_ID }] }),
    DOMAIN,
  );
  assertEquals(d.ok ? null : d.reason, "no_reply_id");
});

Deno.test("the capture address is found in Cc as well as To", () => {
  const d = readInbound(
    reply({
      ToFull: [{ Email: "fisal@phc-sa.com", MailboxHash: "" }],
      CcFull: [{ Email: `reply+${REPLY_ID}@${DOMAIN}`, MailboxHash: REPLY_ID }],
    }),
    DOMAIN,
  );
  assert(d.ok);
  assertEquals(d.record.replyId, REPLY_ID);
});

Deno.test("a message without an id cannot be de-duplicated, so it is refused", () => {
  const d = readInbound(reply({ MessageID: "" }), DOMAIN);
  assertEquals(d.ok ? null : d.reason, "no_message_id");
});

Deno.test("anything that is not a payload is malformed", () => {
  for (const bad of [null, "text", 42, undefined]) {
    const d = readInbound(bad, DOMAIN);
    assertEquals(d.ok ? null : d.reason, "malformed");
  }
});

Deno.test("a date in the future cannot make a stale deal look freshly contacted", () => {
  const now = new Date("2026-09-13T10:00:00Z");
  const future = readInbound(reply({ Date: "Thu, 01 Jan 2099 00:00:00 +0000" }), DOMAIN, now);
  assert(future.ok);
  assertEquals(future.record.occurredAt, now.toISOString());
  const garbage = readInbound(reply({ Date: "not a date" }), DOMAIN, now);
  assert(garbage.ok);
  assertEquals(garbage.record.occurredAt, now.toISOString());
  // A genuine past date is kept.
  const past = readInbound(reply(), DOMAIN, now);
  assert(past.ok);
  assertEquals(past.record.occurredAt, "2026-09-12T06:00:00.000Z");
});

Deno.test("header injection in the subject is neutralised", () => {
  const d = readInbound(reply({ Subject: "RE: hi\r\nBcc: attacker@x.com" }), DOMAIN);
  assert(d.ok);
  assertFalse(/[\r\n]/.test(d.record.subject));
});
