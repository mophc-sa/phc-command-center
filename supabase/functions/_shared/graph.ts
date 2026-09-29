// =============================================================================
// Outlook through Microsoft Graph — the pure rules.
//
// Delegated permissions only: each salesperson signs in themselves, and the
// system acts as that person in that person's mailbox, never in anyone else's.
// Design: docs/superpowers/specs/2026-09-29-outlook-graph-design.md
//
// WHAT THIS FILE REFUSES TO DO
//
// - Connect someone else's mailbox. The mailbox Microsoft signs in must be the
//   caller's own company address (sameMailbox), or nothing is stored.
//
// - Trust the browser with a token. The one-time state and the PKCE verifier
//   never leave the server except as the state value in Microsoft's redirect,
//   and the state is stored only as a hash.
// =============================================================================

import type { ComposeResult } from "./mail.ts";

export const GRAPH_SCOPES =
  "openid profile offline_access User.Read Mail.ReadBasic Mail.Read Mail.Send Calendars.ReadWrite";

export type GraphConfig = {
  configured: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function readGraphConfig(get: (k: string) => string | undefined): GraphConfig {
  const tenantId = (get("MS_TENANT_ID") ?? "").trim();
  const clientId = (get("MS_CLIENT_ID") ?? "").trim();
  const clientSecret = (get("MS_CLIENT_SECRET") ?? "").trim();
  const base = (get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  return {
    configured: Boolean(tenantId && clientId && clientSecret && base),
    tenantId,
    clientId,
    clientSecret,
    redirectUri: `${base}/functions/v1/outlook-connector/callback`,
  };
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function randomToken(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** PKCE (RFC 7636, S256): a 64-character verifier and its challenge. */
export async function newPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  return { verifier, challenge: b64url(await sha256(verifier)) };
}

export const newOAuthState = () => randomToken(32);

export async function hashState(state: string): Promise<string> {
  return Array.from(await sha256(state), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function authorizeUrl(cfg: GraphConfig, state: string, challenge: string, loginHint: string): string {
  const u = new URL(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize`);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: GRAPH_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    login_hint: loginHint,
  }).toString();
  return u.toString();
}

/** The signed-in mailbox must be the caller's own company address. */
export function sameMailbox(graphMail: string | null | undefined, profileEmail: string | null | undefined): boolean {
  const a = (graphMail ?? "").trim().toLowerCase();
  const b = (profileEmail ?? "").trim().toLowerCase();
  return a !== "" && a === b;
}

export type TokenResult =
  | { ok: true; access: string; refresh: string | null; scopes: string[] }
  | { ok: false; reason: "invalid_grant" | "bad_response" };

export function parseTokenResponse(json: unknown): TokenResult {
  const j = (json ?? {}) as Record<string, unknown>;
  if (j.error === "invalid_grant" || j.error === "interaction_required") return { ok: false, reason: "invalid_grant" };
  if (typeof j.access_token !== "string" || !j.access_token) return { ok: false, reason: "bad_response" };
  return {
    ok: true,
    access: j.access_token,
    refresh: typeof j.refresh_token === "string" && j.refresh_token ? j.refresh_token : null,
    scopes: typeof j.scope === "string" ? j.scope.split(" ").filter(Boolean) : [],
  };
}

export type GraphMessage = {
  subject: string;
  body: { contentType: "Text"; content: string };
  toRecipients: { emailAddress: { address: string } }[];
  ccRecipients: { emailAddress: { address: string } }[];
};

/** A message already validated by composeOutbound, in Graph's shape. */
export function toGraphMessage(composed: Extract<ComposeResult, { ok: true }>): GraphMessage {
  const rcpt = (a: string) => ({ emailAddress: { address: a } });
  return {
    subject: composed.postmark.Subject,
    body: { contentType: "Text", content: composed.postmark.TextBody },
    toRecipients: composed.to.map(rcpt),
    ccRecipients: composed.cc.map(rcpt),
  };
}
