// =============================================================================
// Sending email from inside the system — the pure core.
//
// Requested 2026-09-13: send from the system, capture client replies, sync the
// calendar. The company's mailboxes are Microsoft 365 administered by GoDaddy,
// so the Graph route is blocked on a tenant admin nobody at PHC holds. This path
// needs no Microsoft admin at all: mail is sent through Postmark on the phc-sa.com
// domain, and replies still land in the salesperson's own Outlook.
// See docs/implementation/outlook-integration.md.
//
// THREE RULES THIS FILE EXISTS TO HOLD
//
// 1. A person can only send as themselves. The From address is the caller's own
//    profile email and must be on the company domain. A payload cannot choose a
//    sender — otherwise any salesperson could email a client as the CEO.
//
// 2. Replies go to a human first. Reply-To carries the salesperson's own address
//    AND a per-send capture address, so a client's reply reaches Outlook exactly
//    as it would have, and the system gets a copy it can attach to the deal. The
//    capture token is what binds the reply to the deal; nothing is inferred from
//    the sender, the subject or the body.
//
// 3. Nothing here sends. This module builds and validates a payload; the only
//    network call lives in the handler, behind an explicit user click. The
//    activities table was designed with "drafts are NEVER auto-sent", and that
//    survives: there is no scheduled, automated or bulk path to Postmark.
// =============================================================================

export const MAX_RECIPIENTS = 20;
export const MAX_SUBJECT = 255;
export const MAX_BODY = 100_000;

/** Deliberately conservative: an address a person typed, not every RFC 5322 form. */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

/** Split a comma/semicolon list, trim, drop empties, de-duplicate case-insensitively. */
export function parseAddressList(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[,;]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const a = p.trim();
    if (!a) continue;
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

/**
 * Remove anything that could end a header line.
 *
 * Subject and display name go into mail headers. A CR or LF inside them is how
 * an attacker appends their own Bcc: header and turns one send into a spam run.
 * Postmark escapes its JSON fields, but this refuses to depend on that.
 */
export function headerSafe(v: string): string {
  return v.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
}

export type MailConfig = {
  /** Postmark is configured, so the Send button may appear. */
  sending: boolean;
  /** A capture domain is configured, so replies can be threaded back. */
  capture: boolean;
  fromDomain: string | null;
  captureDomain: string | null;
};

/** Read configuration WITHOUT ever returning the token itself. */
export function readMailConfig(get: (k: string) => string | undefined): MailConfig {
  const token = (get("POSTMARK_SERVER_TOKEN") ?? "").trim();
  const fromDomain = (get("MAIL_FROM_DOMAIN") ?? "").trim().toLowerCase() || null;
  const captureDomain = (get("MAIL_CAPTURE_DOMAIN") ?? "").trim().toLowerCase() || null;
  // Capture needs BOTH the domain and the inbound webhook's secret. A capture
  // address in Reply-To with nothing receiving it would bounce every client who
  // replies — so the domain alone is not enough; the receiver must exist too, and
  // its secret is only set once it does.
  const inboundReady = (get("MAIL_INBOUND_SECRET") ?? "").trim().length >= 32;
  const capture = captureDomain !== null && inboundReady;
  return {
    sending: token.length > 0 && fromDomain !== null,
    capture,
    fromDomain,
    captureDomain: capture ? captureDomain : null,
  };
}

// ---- Thread tokens ----------------------------------------------------------

/** Crockford base32: no I, L, O, U — unambiguous if a person ever reads one aloud. */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TOKEN_LENGTH = 16; // 80 bits

/**
 * An unguessable per-send token for the capture address.
 *
 * It travels in the Reply-To header, so the client can see it; it is not a
 * secret in the credential sense. What it must be is unguessable, because
 * anyone who can produce a valid token can attach an email to that deal. Eighty
 * bits makes guessing one hopeless.
 */
export function newThreadToken(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = rand(TOKEN_LENGTH);
  let s = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) s += B32[bytes[i] % 32];
  return s;
}

export function isThreadToken(v: string): boolean {
  return new RegExp(`^[${B32}]{${TOKEN_LENGTH}}$`).test(v);
}

/** Stored as a hash: a leaked table does not let anyone inject mail onto deals. */
export async function hashThreadToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Composition ------------------------------------------------------------

export type SendInput = {
  callerEmail: string | null | undefined;
  callerName: string | null | undefined;
  to: unknown;
  cc?: unknown;
  subject: unknown;
  body: unknown;
};

export type ComposeResult =
  | {
      ok: true;
      postmark: {
        From: string;
        To: string;
        Cc?: string;
        Bcc: string;
        ReplyTo: string;
        Subject: string;
        TextBody: string;
        MessageStream: "outbound";
        TrackOpens: false;
      };
      to: string[];
      cc: string[];
      from: string;
    }
  | { ok: false; reason: ComposeRefusal };

export type ComposeRefusal =
  | "not_configured"
  | "sender_missing"
  | "sender_off_domain"
  | "no_recipient"
  | "invalid_recipient"
  | "too_many_recipients"
  | "subject_missing"
  | "subject_too_long"
  | "body_missing"
  | "body_too_long";

export function composeOutbound(
  input: SendInput,
  config: MailConfig,
  threadToken: string | null,
): ComposeResult {
  if (!config.sending || !config.fromDomain) return { ok: false, reason: "not_configured" };

  const from = (input.callerEmail ?? "").trim().toLowerCase();
  if (!from || !isEmail(from)) return { ok: false, reason: "sender_missing" };
  // Rule 1: only the caller's own address, and only on the company domain.
  if (!from.endsWith(`@${config.fromDomain}`)) return { ok: false, reason: "sender_off_domain" };

  const to = parseAddressList(input.to);
  const cc = parseAddressList(input.cc);
  if (to.length === 0) return { ok: false, reason: "no_recipient" };
  if (to.length + cc.length > MAX_RECIPIENTS) return { ok: false, reason: "too_many_recipients" };
  if ([...to, ...cc].some((a) => !isEmail(a))) return { ok: false, reason: "invalid_recipient" };

  const subject = headerSafe(String(input.subject ?? ""));
  if (!subject) return { ok: false, reason: "subject_missing" };
  if (subject.length > MAX_SUBJECT) return { ok: false, reason: "subject_too_long" };

  const body = String(input.body ?? "");
  if (!body.trim()) return { ok: false, reason: "body_missing" };
  if (body.length > MAX_BODY) return { ok: false, reason: "body_too_long" };

  const name = headerSafe(String(input.callerName ?? "")).replace(/["\\]/g, "");
  const fromHeader = name ? `"${name}" <${from}>` : from;

  // Rule 2: the person first, the capture address second.
  const replyTo = [from];
  if (config.capture && config.captureDomain && threadToken && isThreadToken(threadToken)) {
    replyTo.push(`reply+${threadToken}@${config.captureDomain}`);
  }

  return {
    ok: true,
    postmark: {
      From: fromHeader,
      To: to.join(", "),
      ...(cc.length ? { Cc: cc.join(", ") } : {}),
      // A copy in the sender's own mailbox, since the message did not leave
      // from Outlook and will not appear in their Sent folder.
      Bcc: from,
      ReplyTo: replyTo.join(", "),
      Subject: subject,
      TextBody: body,
      MessageStream: "outbound",
      // Open tracking is off: a pixel in a client's mail reports when they read
      // it, and that is not something this system has been asked to know.
      TrackOpens: false,
    },
    to,
    cc,
    from,
  };
}
