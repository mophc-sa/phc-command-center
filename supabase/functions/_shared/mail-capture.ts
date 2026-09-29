// =============================================================================
// Capturing client email from Outlook — the pure rules.
//
// WHAT THIS FILE REFUSES TO DO
//
// - Keep mail that is not about a client. A message is stored only when one of
//   its outside addresses is a known contact or belongs to a known company's
//   website domain. Colleagues, free-mail senders, newsletters: never stored.
//
// - Keep what the person marked private. Private/personal sensitivity, the
//   Outlook category "Private", and drafts are skipped before anything is read.
//
// - Guess a deal. First rule that holds: the conversation is already bound →
//   a project code naming exactly one deal → the company's only open deal →
//   none. Two candidates is no answer.
// =============================================================================

import { MAX_BODY, MAX_SUBJECT } from "./mail.ts";

export const INTERNAL_DOMAIN = "phc-sa.com";

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.sa", "live.com",
  "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "gmx.com", "zoho.com", "mail.com", "yandex.com",
]);

export type Folder = "inbox" | "sentitems";

type Address = { emailAddress?: { address?: string | null; name?: string | null } | null };

export type GraphMail = {
  id: string;
  internetMessageId?: string | null;
  conversationId?: string | null;
  subject?: string | null;
  from?: Address | null;
  toRecipients?: Address[] | null;
  ccRecipients?: Address[] | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  isDraft?: boolean | null;
  /** PR_SENSITIVITY (0x0036): 0 normal, 1 personal, 2 private, 3 confidential. */
  singleValueExtendedProperties?: Array<{ id?: string; value?: string }> | null;
  categories?: string[] | null;
  bodyPreview?: string | null;
  "@removed"?: unknown;
};

const addr = (a: Address | null | undefined) => (a?.emailAddress?.address ?? "").trim().toLowerCase();
export const domainOf = (email: string) => email.split("@")[1] ?? "";

export function shouldSkip(m: GraphMail): string | null {
  if (m["@removed"]) return "removed";
  if (m.isDraft) return "draft";
  const sensitivity = (m.singleValueExtendedProperties ?? [])
    .find((p) => /0x0*36$/i.test(p.id ?? ""))?.value;
  if (sensitivity === "1" || sensitivity === "2") return "private";
  if ((m.categories ?? []).some((c) => c.trim().toLowerCase() === "private")) return "private";
  if (!m.internetMessageId) return "no_message_id";
  return null;
}

/** Every participant outside the company and outside free-mail providers. */
export function externalAddresses(m: GraphMail): string[] {
  const all = [m.from, ...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map(addr).filter((a) => a.includes("@"));
  return [...new Set(all)].filter((a) => {
    const d = domainOf(a);
    return d !== INTERNAL_DOMAIN && !d.endsWith(`.${INTERNAL_DOMAIN}`) && !FREE_MAIL_DOMAINS.has(d);
  });
}

const CODE = /\b(?:[A-Z]{2,3}-\d{2}-\d{4,}|(?:[A-Z]{2,3}-)?RFQ-\d{4}-\d{4})\b/g;

/** Project codes in a subject or body, e.g. FA-26-0015 or RFQ-2026-0001. */
export function extractProjectCodes(text: string | null | undefined): string[] {
  return [...new Set((text ?? "").toUpperCase().match(CODE) ?? [])];
}

/** A deal only when exactly one distinct candidate exists. */
export function pickOne(ids: Array<string | null | undefined>): string | null {
  const set = new Set(ids.filter((x): x is string => Boolean(x)));
  return set.size === 1 ? [...set][0] : null;
}

export type Match = { contactId: string | null; companyId: string | null };
export type Binding = { opportunityId: string | null; rule: "thread" | "code" | "single_open_deal" | null };

export type ActivityRow = {
  activity_type: "email_received" | "email_draft";
  status: "logged" | "sent";
  summary: string;
  draft_content: string | null;
  occurred_at: string;
  sent_at: string | null;
  sent_by: string | null;
  owner_id: string;
  created_by: string;
  contact_id: string | null;
  company_id: string | null;
  related_opportunity_id: string | null;
  provider_message_id: string;
  email_conversation_id: string | null;
  email_from: string | null;
  email_to: string | null;
  email_cc: string | null;
};

export function toActivityRow(
  m: GraphMail,
  folder: Folder,
  userId: string,
  match: Match,
  binding: Binding,
  body: string | null,
): ActivityRow {
  const outbound = folder === "sentitems";
  const when = (outbound ? m.sentDateTime : m.receivedDateTime) ?? m.receivedDateTime ?? new Date().toISOString();
  const list = (xs: Address[] | null | undefined) => (xs ?? []).map(addr).filter(Boolean).join(", ") || null;
  return {
    activity_type: outbound ? "email_draft" : "email_received",
    status: outbound ? "sent" : "logged",
    summary: (m.subject ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").trim().slice(0, MAX_SUBJECT) || "(no subject)",
    draft_content: body ? body.slice(0, MAX_BODY) : null,
    occurred_at: when,
    sent_at: outbound ? when : null,
    sent_by: outbound ? userId : null,
    owner_id: userId,
    created_by: userId,
    contact_id: match.contactId,
    company_id: match.companyId,
    related_opportunity_id: binding.opportunityId,
    provider_message_id: `imid:${m.internetMessageId}`,
    email_conversation_id: m.conversationId ?? null,
    email_from: addr(m.from) || null,
    email_to: list(m.toRecipients),
    email_cc: list(m.ccRecipients),
  };
}
