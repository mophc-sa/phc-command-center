// =============================================================================
// Sending from the system: who may send as whom, and where replies go.
// =============================================================================

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  composeOutbound,
  hashThreadToken,
  headerSafe,
  isThreadToken,
  MAX_RECIPIENTS,
  newThreadToken,
  parseAddressList,
  readMailConfig,
  TOKEN_LENGTH,
  type MailConfig,
} from "./mail.ts";

const READY: MailConfig = { sending: true, capture: true, fromDomain: "phc-sa.com", captureDomain: "crm.phc-sa.com" };
// A reply id fixture — Crockford base32, not a credential.
const REPLY_ID = "0123456789ABCDEF";
const base = {
  callerEmail: "fisal@phc-sa.com",
  callerName: "Faisal Abdulkadhar",
  to: "client@example.com",
  subject: "Quotation for Westfield",
  body: "Please find the quotation attached.",
};

Deno.test("a person sends only as themselves, on the company domain", () => {
  const ok = composeOutbound(base, READY, REPLY_ID);
  assert(ok.ok);
  assertEquals(ok.from, "fisal@phc-sa.com");
  assertEquals(ok.postmark.From, '"Faisal Abdulkadhar" <fisal@phc-sa.com>');

  // An outside address cannot be a sender, whatever the payload says.
  const off = composeOutbound({ ...base, callerEmail: "someone@gmail.com" }, READY, REPLY_ID);
  assertEquals(off.ok ? null : off.reason, "sender_off_domain");

  // A look-alike domain is not the company domain.
  const lookalike = composeOutbound({ ...base, callerEmail: "x@evilphc-sa.com" }, READY, REPLY_ID);
  assertEquals(lookalike.ok ? null : lookalike.reason, "sender_off_domain");
});

Deno.test("replies reach the salesperson first, and the capture address second", () => {
  const r = composeOutbound(base, READY, REPLY_ID);
  assert(r.ok);
  assertEquals(r.postmark.ReplyTo, "fisal@phc-sa.com, reply+0123456789ABCDEF@crm.phc-sa.com");
  // And they keep a copy, since the message never left from Outlook.
  assertEquals(r.postmark.Bcc, "fisal@phc-sa.com");
});

Deno.test("without a capture domain, replies go to the person alone", () => {
  const r = composeOutbound(base, { ...READY, capture: false, captureDomain: null }, REPLY_ID);
  assert(r.ok);
  assertEquals(r.postmark.ReplyTo, "fisal@phc-sa.com");
});

Deno.test("a malformed token never reaches a header", () => {
  const r = composeOutbound(base, READY, "not-a-token\r\nBcc: attacker@x.com");
  assert(r.ok);
  assertEquals(r.postmark.ReplyTo, "fisal@phc-sa.com");
});

Deno.test("header injection through subject or name is neutralised", () => {
  const r = composeOutbound(
    { ...base, subject: "Hello\r\nBcc: attacker@x.com", callerName: 'Evil"\r\nBcc: a@x.com' },
    READY,
    REPLY_ID,
  );
  assert(r.ok);
  assertFalse(/[\r\n]/.test(r.postmark.Subject));
  assertFalse(/[\r\n]/.test(r.postmark.From));
  assertEquals(headerSafe("a\r\nb c"), "a b c");
});

Deno.test("nothing is sent when the service is not configured", () => {
  const r = composeOutbound(base, { sending: false, capture: false, fromDomain: null, captureDomain: null }, REPLY_ID);
  assertEquals(r.ok ? null : r.reason, "not_configured");
});

Deno.test("recipients are validated, de-duplicated and capped", () => {
  assertEquals(parseAddressList("a@x.com, A@x.com; b@x.com,,"), ["a@x.com", "b@x.com"]);
  const none = composeOutbound({ ...base, to: "" }, READY, REPLY_ID);
  assertEquals(none.ok ? null : none.reason, "no_recipient");
  const bad = composeOutbound({ ...base, to: "not an email" }, READY, REPLY_ID);
  assertEquals(bad.ok ? null : bad.reason, "invalid_recipient");
  const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `r${i}@x.com`);
  const capped = composeOutbound({ ...base, to: many }, READY, REPLY_ID);
  assertEquals(capped.ok ? null : capped.reason, "too_many_recipients");
});

Deno.test("an empty subject or body is refused rather than sent", () => {
  const s = composeOutbound({ ...base, subject: "   " }, READY, REPLY_ID);
  assertEquals(s.ok ? null : s.reason, "subject_missing");
  const b = composeOutbound({ ...base, body: "\n  \n" }, READY, REPLY_ID);
  assertEquals(b.ok ? null : b.reason, "body_missing");
});

Deno.test("open tracking is off", () => {
  const r = composeOutbound(base, READY, REPLY_ID);
  assert(r.ok);
  assertEquals(r.postmark.TrackOpens, false);
});

Deno.test("a capture domain alone does not turn capture on", () => {
  // Without the inbound receiver, a capture address in Reply-To would bounce
  // every client who replies.
  const noReceiver = readMailConfig((k) =>
    ({ POSTMARK_SERVER_TOKEN: "t", MAIL_FROM_DOMAIN: "phc-sa.com", MAIL_CAPTURE_DOMAIN: "crm.phc-sa.com" })[k]
  );
  assertFalse(noReceiver.capture);
  assertEquals(noReceiver.captureDomain, null);
  const r = composeOutbound(base, noReceiver, REPLY_ID);
  assert(r.ok);
  assertEquals(r.postmark.ReplyTo, "fisal@phc-sa.com");
  // A short secret is not a secret.
  assertFalse(readMailConfig((k) =>
    ({ POSTMARK_SERVER_TOKEN: "t", MAIL_FROM_DOMAIN: "phc-sa.com", MAIL_CAPTURE_DOMAIN: "crm.phc-sa.com", MAIL_INBOUND_SECRET: "short" })[k]
  ).capture);
});

Deno.test("configuration never exposes the token", () => {
  const cfg = readMailConfig((k) =>
    ({
      POSTMARK_SERVER_TOKEN: "secret-token",
      MAIL_FROM_DOMAIN: "PHC-SA.com",
      MAIL_CAPTURE_DOMAIN: "crm.phc-sa.com",
      MAIL_INBOUND_SECRET: "x".repeat(40),
    })[k]
  );
  assertEquals(cfg, { sending: true, capture: true, fromDomain: "phc-sa.com", captureDomain: "crm.phc-sa.com" });
  assertFalse(JSON.stringify(cfg).includes("secret-token"));
  assertFalse(JSON.stringify(cfg).includes("x".repeat(40)));
  // No token means no sending, even with a domain.
  assertFalse(readMailConfig((k) => ({ MAIL_FROM_DOMAIN: "phc-sa.com" })[k]).sending);
});

Deno.test("thread tokens are unambiguous, well-formed and stored only as a hash", async () => {
  const t = newThreadToken();
  assertEquals(t.length, TOKEN_LENGTH);
  assert(isThreadToken(t));
  assertFalse(/[ILOU]/.test(t));
  assertFalse(isThreadToken("0123456789abcdef"));
  const h = await hashThreadToken(t);
  assertEquals(h.length, 64);
  assertFalse(h.includes(t));
  assertEquals(h, await hashThreadToken(t));
});
