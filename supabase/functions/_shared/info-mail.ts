// supabase/functions/_shared/info-mail.ts
// =============================================================================
// The info@phc-sa.com mailbox — the pure rules the five-minute pass applies to
// each message before anything is stored. (Graph calls: graph-client.ts.
// Decisions about owners, items and replies: the SQL in 20261024100000.)
// =============================================================================

import { INTERNAL_DOMAIN } from "./mail-capture.ts";

export { INTERNAL_DOMAIN };
/** Characters of a message's own text kept for triage and for the deal page. */
export const MAX_INFO_BODY = 8000;

export type InfoMessage = {
  graphId: string;
  internetMessageId: string | null;
  conversationId: string | null;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  receivedAt: string;
  webLink: string | null;
  hasAttachments: boolean;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const OUTLOOK_LINK = /^https:\/\/outlook\.office(365)?\.com\//;

/** A delta item → what the pass stores. Removed items and drafts are not mail. */
export function toInfoMessage(raw: Record<string, unknown>): InfoMessage | null {
  if (raw["@removed"] || raw.isDraft === true) return null;
  const graphId = str(raw.id);
  const receivedAt = str(raw.receivedDateTime);
  if (!graphId || !receivedAt) return null;
  const from = (raw.from as { emailAddress?: { address?: unknown; name?: unknown } } | undefined)?.emailAddress;
  const webLink = str(raw.webLink);
  return {
    graphId,
    internetMessageId: str(raw.internetMessageId),
    conversationId: str(raw.conversationId),
    subject: str(raw.subject),
    fromEmail: str(from?.address)?.toLowerCase() ?? null,
    fromName: str(from?.name),
    receivedAt,
    webLink: webLink && OUTLOOK_LINK.test(webLink) ? webLink : null,
    hasAttachments: raw.hasAttachments === true,
  };
}

/** Our own people writing to info@ are not clients. */
export function isInternalSender(m: InfoMessage): boolean {
  const domain = (m.fromEmail ?? "").split("@")[1] ?? "";
  return domain === INTERNAL_DOMAIN || domain.endsWith(`.${INTERNAL_DOMAIN}`);
}

/** RFC 3834 Auto-Submitted (anything but "no"), or Precedence: auto_reply. */
export function isAutoReply(headers: Array<{ name?: string; value?: string }>): boolean {
  return headers.some((h) => {
    const name = (h.name ?? "").toLowerCase();
    const value = (h.value ?? "").trim().toLowerCase();
    return (name === "auto-submitted" && value !== "" && value !== "no") ||
      (name === "precedence" && value === "auto_reply");
  });
}

export function capBody(text: string | null): string | null {
  const t = (text ?? "").trim();
  return t ? t.slice(0, MAX_INFO_BODY) : null;
}
