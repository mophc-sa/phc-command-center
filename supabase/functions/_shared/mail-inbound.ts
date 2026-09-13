// =============================================================================
// Capturing a client's reply onto the deal — the pure core.
//
// When an email is sent from the system, its Reply-To carries the salesperson's
// own address and reply+ID@<capture domain>. The client's reply reaches Outlook
// as normal, and Postmark posts the copy sent to the capture address here as JSON.
// See ./mail.ts and docs/implementation/outlook-integration.md §9.
//
// WHAT THIS FILE REFUSES TO DO
//
// - Guess. A reply is bound to a deal by the id in the address it was sent to,
//   and by nothing else — not the sender, not the subject, not the body. No id,
//   or an id that matches no thread, and the message is dropped.
//
// - Keep what it cannot place. A dropped message leaves no trace: no subject, no
//   sender, no count. Mail that reaches the capture address by mistake — a
//   newsletter, a typo, a person writing to it directly — never enters the system.
//
// - Trust the caller. The webhook authenticates with HTTP Basic credentials in
//   its URL, compared in constant time. Anything else is refused with 403, which
//   also tells Postmark to stop retrying rather than hammer a closed door.
// =============================================================================

import { headerSafe, isThreadToken, MAX_BODY, MAX_SUBJECT } from "./mail.ts";

/** Constant-time string comparison, so the response time does not leak the secret. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  // Compare against the longer length so a short guess costs the same time.
  const n = Math.max(ea.length, eb.length);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/**
 * Check the Basic credentials Postmark sends.
 *
 * The username is fixed ("postmark") so a secret alone is not accepted under any
 * name, and the secret must be long: a short one is refused even if it matches,
 * because it is not a secret worth trusting.
 */
export function authorizeInbound(authorization: string | null, secret: string | undefined): boolean {
  const expected = (secret ?? "").trim();
  if (expected.length < 32) return false;
  if (!authorization || !authorization.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(authorization.slice("Basic ".length).trim());
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  // Both compared, both always evaluated: no early exit on the username.
  const userOk = safeEqual(user, "postmark");
  const passOk = safeEqual(pass, expected);
  return userOk && passOk;
}

export type InboundRecord = {
  replyId: string;
  providerMessageId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  occurredAt: string;
};

export type InboundDecision =
  | { ok: true; record: InboundRecord }
  | { ok: false; reason: "malformed" | "no_reply_id" | "no_message_id" };

type Addr = { Email?: unknown; MailboxHash?: unknown };

/**
 * Turn a Postmark inbound payload into something storable, or a reason not to.
 *
 * The id is taken from the recipient that was actually addressed to the capture
 * domain, not from the top-level MailboxHash alone: a reply sent to several
 * people carries one MailboxHash per recipient, and only the capture address's
 * one is ours.
 */
export function readInbound(
  payload: unknown,
  captureDomain: string | null,
  now: Date = new Date(),
): InboundDecision {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "malformed" };
  const p = payload as Record<string, unknown>;

  const domain = (captureDomain ?? "").toLowerCase();
  const recipients: Addr[] = [
    ...(Array.isArray(p.ToFull) ? p.ToFull : []),
    ...(Array.isArray(p.CcFull) ? p.CcFull : []),
    ...(Array.isArray(p.BccFull) ? p.BccFull : []),
  ] as Addr[];

  let replyId: string | null = null;
  for (const r of recipients) {
    const email = String(r.Email ?? "").toLowerCase();
    const hash = String(r.MailboxHash ?? "");
    if (domain && email.endsWith(`@${domain}`) && isThreadToken(hash)) {
      replyId = hash;
      break;
    }
  }
  // Fall back to the top-level hash only when no recipient list was supplied.
  if (!replyId && recipients.length === 0 && isThreadToken(String(p.MailboxHash ?? ""))) {
    replyId = String(p.MailboxHash);
  }
  if (!replyId) return { ok: false, reason: "no_reply_id" };

  const providerMessageId = String(p.MessageID ?? "").trim();
  if (!providerMessageId) return { ok: false, reason: "no_message_id" };

  const fromFull = (p.FromFull ?? {}) as { Email?: unknown };
  const from = String(fromFull.Email ?? p.From ?? "").trim().toLowerCase().slice(0, 320);
  const to = recipients.map((r) => String(r.Email ?? "").trim()).filter(Boolean).join(", ").slice(0, 2000);

  const subject = headerSafe(String(p.Subject ?? "")).slice(0, MAX_SUBJECT) || "(no subject)";

  // The reply without the quoted history when Postmark could strip it, so the
  // deal's timeline shows what the client wrote, not our own email again.
  const stripped = String(p.StrippedTextReply ?? "").trim();
  const body = (stripped || String(p.TextBody ?? "")).slice(0, MAX_BODY);

  // The Date header is written by the client's mail app, not by us. A clock set
  // wrong — or a date someone chose — in the future would make this reply the
  // deal's "last contact" for as long as that date lies ahead, and a stale deal
  // would read as freshly touched. The system already holds an RFQ due in the
  // year 275760; a date nobody validated is how that happens. Anything unreadable
  // or more than a day ahead of now is recorded as now.
  const date = new Date(String(p.Date ?? ""));
  const DAY = 24 * 60 * 60 * 1000;
  const occurredAt =
    Number.isNaN(date.getTime()) || date.getTime() > now.getTime() + DAY ? now.toISOString() : date.toISOString();

  return { ok: true, record: { replyId, providerMessageId, from, to, subject, body, occurredAt } };
}
