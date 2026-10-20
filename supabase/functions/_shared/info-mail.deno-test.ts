import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { capBody, isAutoReply, isInternalSender, MAX_INFO_BODY, toInfoMessage } from "./info-mail.ts";

const RAW = {
  id: "AAMk1",
  internetMessageId: "<m1@acme>",
  conversationId: "conv-1",
  subject: " RFQ - Diriyah ",
  from: { emailAddress: { address: "Sara@Acme.example", name: "Sara" } },
  receivedDateTime: "2026-10-20T08:00:00Z",
  isDraft: false,
  webLink: "https://outlook.office365.com/owa/?ItemID=1",
  hasAttachments: true,
};

Deno.test("a Graph message becomes the shape the pass stores", () => {
  assertEquals(toInfoMessage(RAW), {
    graphId: "AAMk1",
    internetMessageId: "<m1@acme>",
    conversationId: "conv-1",
    subject: "RFQ - Diriyah",
    fromEmail: "sara@acme.example",
    fromName: "Sara",
    receivedAt: "2026-10-20T08:00:00Z",
    webLink: "https://outlook.office365.com/owa/?ItemID=1",
    hasAttachments: true,
  });
});

Deno.test("removed items, drafts and messages without an id or date are dropped", () => {
  assertEquals(toInfoMessage({ ...RAW, "@removed": { reason: "deleted" } }), null);
  assertEquals(toInfoMessage({ ...RAW, isDraft: true }), null);
  assertEquals(toInfoMessage({ ...RAW, id: "" }), null);
  assertEquals(toInfoMessage({ ...RAW, receivedDateTime: undefined }), null);
});

Deno.test("a web link that is not Outlook's is not kept", () => {
  assertEquals(toInfoMessage({ ...RAW, webLink: "https://evil.example/x" })?.webLink, null);
});

Deno.test("mail from our own domain is internal", () => {
  assert(isInternalSender(toInfoMessage({ ...RAW, from: { emailAddress: { address: "khalid@phc-sa.com" } } })!));
  assert(isInternalSender(toInfoMessage({ ...RAW, from: { emailAddress: { address: "x@mail.phc-sa.com" } } })!));
  assertFalse(isInternalSender(toInfoMessage(RAW)!));
});

Deno.test("auto-replies are recognised by their headers", () => {
  assert(isAutoReply([{ name: "Auto-Submitted", value: "auto-replied" }]));
  assert(isAutoReply([{ name: "auto-submitted", value: "auto-generated" }]));
  assert(isAutoReply([{ name: "Precedence", value: "auto_reply" }]));
  assertFalse(isAutoReply([{ name: "Auto-Submitted", value: "no" }]));
  assertFalse(isAutoReply([]));
});

Deno.test("the stored text is capped and blank text is nothing", () => {
  assertEquals(capBody("  "), null);
  assertEquals(capBody(null), null);
  assertEquals(capBody("x".repeat(MAX_INFO_BODY + 50))?.length, MAX_INFO_BODY);
});
