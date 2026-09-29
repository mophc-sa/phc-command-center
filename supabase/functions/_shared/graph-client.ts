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
  | { ok: true; messageId: string; conversationId: string | null }
  | { ok: false; status: number; error: string };

const graphError = async (res: Response) => {
  const j = await res.json().catch(() => null) as { error?: { message?: string } } | null;
  return (j?.error?.message ?? `Outlook refused the message (${res.status})`).slice(0, 200);
};

/**
 * Draft, then send. Creating the draft first returns the conversation id,
 * which is how a later reply is bound back to the deal. A failed draft is
 * never followed by a send.
 */
export async function sendAsMe(access: string, message: GraphMessage, f: typeof fetch = fetch): Promise<SendResult> {
  const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };
  try {
    const draft = await f(`${GRAPH}/me/messages`, { method: "POST", headers, body: JSON.stringify(message) });
    if (!draft.ok) return { ok: false, status: draft.status, error: await graphError(draft) };
    const d = await draft.json() as { id?: string; conversationId?: string };
    if (!d.id) return { ok: false, status: 502, error: "Outlook did not return a draft" };
    const sent = await f(`${GRAPH}/me/messages/${encodeURIComponent(d.id)}/send`, { method: "POST", headers });
    if (!sent.ok) return { ok: false, status: sent.status, error: await graphError(sent) };
    return { ok: true, messageId: d.id, conversationId: d.conversationId ?? null };
  } catch {
    return { ok: false, status: 502, error: "Outlook could not be reached" };
  }
}
