// =============================================================================
// Fireflies meetings: who may post, how action items are read, who owns them.
// Samples are the real action-item blocks of two 2026-09-28 meetings.
// =============================================================================

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ingestableTranscripts, matchSpeaker, parseActionItems, readWebhook, toIngestPayload, verifySignature } from "./fireflies.ts";

const SECRET = "f".repeat(24);

async function sign(body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("only a body signed with the shared secret is accepted", async () => {
  const body = JSON.stringify({ meetingId: "01M3KVXM1BAF7PHJP57P3B2KNW", eventType: "Transcription completed" });
  const sig = await sign(body);
  assert(await verifySignature(body, sig, SECRET));
  assert(await verifySignature(body, `sha256=${sig.toUpperCase()}`, SECRET));
  assertFalse(await verifySignature(body + " ", sig, SECRET), "a changed byte fails");
  assertFalse(await verifySignature(body, await sign(body, "g".repeat(24)), SECRET), "another secret fails");
  assertFalse(await verifySignature(body, null, SECRET), "no header fails");
  assertFalse(await verifySignature(body, await sign(body, "short"), "short"), "a short secret is refused");
  assertFalse(await verifySignature(body, sig, undefined), "no configured secret fails");
});

Deno.test("the webhook body carries a meeting id of sane shape", () => {
  assertEquals(readWebhook({ meetingId: "ASxwZxCstx", eventType: "Transcription completed" }), { ok: true, meetingId: "ASxwZxCstx" });
  assertEquals(readWebhook({ meetingId: "ASxwZxCstx" }), { ok: true, meetingId: "ASxwZxCstx" });
  assertFalse(readWebhook({ meetingId: "../../etc" }).ok);
  assertFalse(readWebhook({ meetingId: "" }).ok);
  assertFalse(readWebhook({ meetingId: "abc", eventType: "Meeting deleted" }).ok);
  assertFalse(readWebhook(null).ok);
});

const COORDINATION = `**Moalagab**
Share received design update (01:45)
Let team know once design update received (01:47)

**Speaker 3**
Push vendor for full package update (01:47)
Prioritize Mint project pricing with Abd Rahman and Ahmed Zayed (03:35)

**All Team Members**
Use new system integration with email (07:22)`;

Deno.test("action items keep their speaker and timestamp", () => {
  const items = parseActionItems(COORDINATION);
  assertEquals(items.length, 5);
  assertEquals(items[0], { speaker_label: "Moalagab", title: "Share received design update", at_seconds: 105 });
  assertEquals(items[3], { speaker_label: "Speaker 3", title: "Prioritize Mint project pricing with Abd Rahman and Ahmed Zayed", at_seconds: 215 });
  assertEquals(items[4].speaker_label, "All Team Members");
});

Deno.test("hour timestamps, bullets, unassigned and missing stamps", () => {
  const items = parseActionItems("**Unassigned**\n- Download Fireflies Desktop App (00:00)\n**Faisal**\n* Refresh contact for Avenue Tower (1:02:03)\nNo stamp here");
  assertEquals(items, [
    { speaker_label: null, title: "Download Fireflies Desktop App", at_seconds: 0 },
    { speaker_label: "Faisal", title: "Refresh contact for Avenue Tower", at_seconds: 3723 },
    { speaker_label: "Faisal", title: "No stamp here", at_seconds: null },
  ]);
  assertEquals(parseActionItems(null), []);
  assertEquals(parseActionItems(""), []);
});

const TEAM = [
  { id: "mo", email: "moalagab@phc-sa.com", full_name: "Mohammed Alagab" },
  { id: "faisal", email: "fisal@phc-sa.com", full_name: "Faisal Abdulkadhar" },
  { id: "omar", email: "omar@phc-sa.com", full_name: "Omar Kallas" },
  { id: "marie", email: "marie@phc-sa.com", full_name: "Marie Falome" },
  { id: "ahmed1", email: "ahmed.z@phc-sa.com", full_name: "Ahmed Zayed" },
  { id: "ahmed2", email: "ahmed.k@phc-sa.com", full_name: "Ahmed Khalil" },
];

Deno.test("a speaker becomes an owner only when certain", () => {
  assertEquals(matchSpeaker("Moalagab", TEAM), "mo", "email local part");
  assertEquals(matchSpeaker("Faisal", TEAM), "faisal", "unique first name");
  assertEquals(matchSpeaker("omar kallas", TEAM), "omar", "full name, any case");
  assertEquals(matchSpeaker("Ahmed", TEAM), null, "two Ahmeds is not a match");
  assertEquals(matchSpeaker("Mary", TEAM), null, "near miss is not a match");
  assertEquals(matchSpeaker("Speaker 3", TEAM), null);
  assertEquals(matchSpeaker("All Team Members", TEAM), null);
  assertEquals(matchSpeaker(null, TEAM), null);
});

Deno.test("a transcript becomes one meeting and its items", () => {
  const { meeting, items } = toIngestPayload({
    id: "01M3KVXM1BAF7PHJP57P3B2KNW",
    title: "Project Updates and Coordination Priorities",
    dateString: "2026-09-28T11:20:36.607Z",
    duration: 7.860000133514404,
    organizer_email: "moalagab@phc-sa.com",
    participants: ["moalagab@phc-sa.com"],
    summary: { action_items: COORDINATION, short_summary: "Short.", keywords: ["Mint project"] },
  }, TEAM);
  assertEquals(meeting.provider_meeting_id, "01M3KVXM1BAF7PHJP57P3B2KNW");
  assertEquals(meeting.duration_minutes, 7.86);
  assertEquals(meeting.occurred_at, "2026-09-28T11:20:36.607Z");
  assertEquals(items.length, 5);
  assertEquals(items[0].suggested_owner_id, "mo");
  assertEquals(items[2].suggested_owner_id, null);
});

Deno.test("only summarised meetings with a sane id are fetched in", () => {
  const kept = ingestableTranscripts([
    { id: "A1", title: "Real", summary: { short_summary: "We met." } },
    { id: "B2", title: "Only items", summary: { action_items: "**Mo**\nCall (00:10)" } },
    { id: "C3", title: "WhatsApp", summary: null },
    { id: "D4", title: "Blank", summary: { short_summary: "  ", overview: "", action_items: "" } },
    { id: "bad id!", title: "x", summary: { short_summary: "y" } },
    null,
    "junk",
  ]);
  assertEquals(kept.map((t) => t.id), ["A1", "B2"]);
  assertEquals(ingestableTranscripts(undefined), []);
});
