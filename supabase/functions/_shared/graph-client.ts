// =============================================================================
// Outlook through Microsoft Graph — the only file that talks to Microsoft.
//
// Every call takes a fetch implementation so the tests can see exactly what
// would be sent without reaching the network. Nothing here logs: tokens and
// message content never reach a log line.
// =============================================================================

import { type GraphConfig, type GraphMessage, parseTokenResponse, type TokenResult, GRAPH_SCOPES } from "./graph.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const tokenUrl = (cfg: GraphConfig) =>
  `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;

async function postToken(cfg: GraphConfig, params: Record<string, string>, f: typeof fetch): Promise<TokenResult> {
  try {
    const res = await f(tokenUrl(cfg), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: GRAPH_SCOPES, ...params }),
    });
    return parseTokenResponse(await res.json().catch(() => null));
  } catch {
    return { ok: false, reason: "bad_response" };
  }
}

export function exchangeCode(cfg: GraphConfig, code: string, verifier: string, f: typeof fetch = fetch) {
  return postToken(cfg, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: cfg.redirectUri }, f);
}

export function refreshAccess(cfg: GraphConfig, refreshToken: string, f: typeof fetch = fetch) {
  return postToken(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, f);
}

export async function getMe(access: string, f: typeof fetch = fetch): Promise<{ id: string; mail: string } | null> {
  try {
    const res = await f(`${GRAPH}/me?$select=id,mail,userPrincipalName`, { headers: { Authorization: `Bearer ${access}` } });
    if (!res.ok) return null;
    const j = await res.json() as { id?: string; mail?: string | null; userPrincipalName?: string };
    const mail = j.mail || j.userPrincipalName || "";
    return j.id && mail ? { id: j.id, mail } : null;
  } catch {
    return null;
  }
}

export type SendResult =
  | { ok: true; messageId: string | null; conversationId: string | null }
  | { ok: false; status: number; error: string };

const graphError = async (res: Response) => {
  const j = await res.json().catch(() => null) as { error?: { message?: string } } | null;
  return (j?.error?.message ?? `Outlook refused the message (${res.status})`).slice(0, 200);
};

/**
 * Send with /me/sendMail, which needs only Mail.Send, and keep a copy in Sent
 * Items. Creating a draft first would need Mail.ReadWrite — permission to change
 * and delete mail — which this app deliberately does not hold.
 *
 * sendMail returns no id, so the sent copy is then looked up in Sent Items
 * (Mail.Read) by subject, first recipient and time, to learn the conversation id
 * a later reply binds by. If it cannot be found the email has still been sent;
 * only the binding is lost, and ids come back null.
 */
export async function sendAsMe(
  access: string,
  message: GraphMessage,
  f: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<SendResult> {
  const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };
  const startedAt = Date.now() - 60_000;
  try {
    const sent = await f(`${GRAPH}/me/sendMail`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, saveToSentItems: true }),
    });
    if (!sent.ok) return { ok: false, status: sent.status, error: await graphError(sent) };
  } catch {
    return { ok: false, status: 502, error: "Outlook could not be reached" };
  }

  const firstTo = message.toRecipients[0]?.emailAddress.address.toLowerCase() ?? "";
  const query = `${GRAPH}/me/mailFolders/sentitems/messages?$top=10&$orderby=sentDateTime desc` +
    `&$select=id,conversationId,subject,sentDateTime,toRecipients`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await wait(1500);
    try {
      const res = await f(query, { headers: { Authorization: `Bearer ${access}` } });
      if (!res.ok) break;
      const { value = [] } = await res.json() as {
        value?: Array<{ id: string; conversationId?: string; subject?: string; sentDateTime?: string; toRecipients?: Array<{ emailAddress?: { address?: string } }> }>;
      };
      const hit = value.find((m) =>
        m.subject === message.subject &&
        Date.parse(m.sentDateTime ?? "") >= startedAt &&
        (m.toRecipients ?? []).some((r) => (r.emailAddress?.address ?? "").toLowerCase() === firstTo)
      );
      if (hit) return { ok: true, messageId: hit.id, conversationId: hit.conversationId ?? null };
    } catch {
      break;
    }
  }
  return { ok: true, messageId: null, conversationId: null };
}
