// =============================================================================
// Outlook through Graph: sign-in, the mailbox check, and what is sent where.
// =============================================================================

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authorizeUrl,
  GRAPH_SCOPES,
  hashState,
  newOAuthState,
  newPkce,
  parseTokenResponse,
  readGraphConfig,
  sameMailbox,
  toGraphMessage,
} from "./graph.ts";
import { deltaPage, exchangeCode, getMe, getUniqueBody, initialDeltaUrl, refreshAccess, sendAsMe } from "./graph-client.ts";
import { composeOutbound } from "./mail.ts";

const ENV: Record<string, string> = {
  MS_TENANT_ID: "tenant-1",
  MS_CLIENT_ID: "client-1",
  MS_CLIENT_SECRET: "secret-1",
  SUPABASE_URL: "https://proj.supabase.co/",
};
const CFG = readGraphConfig((k) => ENV[k]);

Deno.test("configuration needs all three Microsoft values", () => {
  assert(CFG.configured);
  assertEquals(CFG.redirectUri, "https://proj.supabase.co/functions/v1/outlook-connector/callback");
  assertFalse(readGraphConfig((k) => (k === "MS_CLIENT_SECRET" ? "" : ENV[k])).configured);
});

Deno.test("PKCE challenge is the S256 of the verifier", async () => {
  const { verifier, challenge } = await newPkce();
  assertEquals(verifier.length, 64);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const expected = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals(challenge, expected);
});

Deno.test("state is random and stored only as a hash", async () => {
  const a = newOAuthState(), b = newOAuthState();
  assert(a !== b && a.length >= 43);
  const h = await hashState(a);
  assert(/^[0-9a-f]{64}$/.test(h));
  assertEquals(h, await hashState(a));
});

Deno.test("the sign-in URL asks for exactly the delegated scopes, with PKCE", () => {
  const u = new URL(authorizeUrl(CFG, "st", "ch", "rep@phc-sa.com"));
  assertEquals(u.pathname, "/tenant-1/oauth2/v2.0/authorize");
  const p = u.searchParams;
  assertEquals(p.get("client_id"), "client-1");
  assertEquals(p.get("response_type"), "code");
  assertEquals(p.get("code_challenge_method"), "S256");
  assertEquals(p.get("code_challenge"), "ch");
  assertEquals(p.get("state"), "st");
  assertEquals(p.get("login_hint"), "rep@phc-sa.com");
  assertEquals(p.get("scope"), GRAPH_SCOPES);
  assertFalse(GRAPH_SCOPES.includes(".All"), "no tenant-wide permission is requested");
});

Deno.test("only the caller's own mailbox may be connected", () => {
  assert(sameMailbox("Rep@PHC-sa.com", "rep@phc-sa.com"));
  assertFalse(sameMailbox("other@phc-sa.com", "rep@phc-sa.com"));
  assertFalse(sameMailbox("", ""));
  assertFalse(sameMailbox(null, "rep@phc-sa.com"));
});

Deno.test("token responses", () => {
  assertEquals(parseTokenResponse({ access_token: "a", refresh_token: "r", scope: "Mail.Send User.Read" }),
    { ok: true, access: "a", refresh: "r", scopes: ["Mail.Send", "User.Read"] });
  assertEquals(parseTokenResponse({ error: "invalid_grant" }), { ok: false, reason: "invalid_grant" });
  assertEquals(parseTokenResponse(null), { ok: false, reason: "bad_response" });
});

const COMPOSED = composeOutbound(
  { callerEmail: "rep@phc-sa.com", callerName: "Rep", to: "client@example.com, b@example.com", cc: "c@example.com", subject: "Quote", body: "Hello" },
  { sending: true, capture: false, fromDomain: "phc-sa.com", captureDomain: null },
  null,
);

Deno.test("a validated message maps to Graph's shape", () => {
  assert(COMPOSED.ok);
  if (!COMPOSED.ok) return;
  assertEquals(toGraphMessage(COMPOSED), {
    subject: "Quote",
    body: { contentType: "Text", content: "Hello" },
    toRecipients: [{ emailAddress: { address: "client@example.com" } }, { emailAddress: { address: "b@example.com" } }],
    ccRecipients: [{ emailAddress: { address: "c@example.com" } }],
  });
});

type Call = { url: string; init?: RequestInit };
function fakeFetch(responses: Array<[number, unknown]>, calls: Call[]): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const [status, body] = responses.shift() ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
}

Deno.test("code exchange posts the verifier and secret as a form", async () => {
  const calls: Call[] = [];
  const r = await exchangeCode(CFG, "code-1", "ver-1", fakeFetch([[200, { access_token: "a", refresh_token: "r" }]], calls));
  assert(r.ok);
  assertEquals(calls[0].url, "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
  const form = new URLSearchParams(String(calls[0].init?.body));
  assertEquals(form.get("grant_type"), "authorization_code");
  assertEquals(form.get("code_verifier"), "ver-1");
  assertEquals(form.get("client_secret"), "secret-1");
  assertEquals(form.get("redirect_uri"), CFG.redirectUri);
});

Deno.test("an expired refresh token is reported, not retried", async () => {
  const r = await refreshAccess(CFG, "old", fakeFetch([[400, { error: "invalid_grant" }]], []));
  assertEquals(r, { ok: false, reason: "invalid_grant" });
});

Deno.test("the signed-in mailbox is read from /me", async () => {
  assertEquals(await getMe("a", fakeFetch([[200, { id: "u1", mail: "rep@phc-sa.com" }]], [])), { id: "u1", mail: "rep@phc-sa.com" });
  assertEquals(await getMe("a", fakeFetch([[401, {}]], [])), null);
});

const noWait = () => Promise.resolve();
const SENT_ITEM = (subject: string, to: string) => ({
  value: [{ id: "s1", conversationId: "c1", subject, sentDateTime: new Date().toISOString(), toRecipients: [{ emailAddress: { address: to } }] }],
});

Deno.test("send uses sendMail (Mail.Send only), then finds the sent copy for its conversation id", async () => {
  if (!COMPOSED.ok) return;
  const calls: Call[] = [];
  const r = await sendAsMe("tok", toGraphMessage(COMPOSED), fakeFetch([[202, {}], [200, SENT_ITEM("Quote", "client@example.com")]], calls), noWait);
  assertEquals(r, { ok: true, messageId: "s1", conversationId: "c1" });
  assertEquals(calls[0].url, "https://graph.microsoft.com/v1.0/me/sendMail");
  assertEquals(JSON.parse(String(calls[0].init?.body)).saveToSentItems, true);
  assert(calls[1].url.startsWith("https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages"));
  assertFalse(calls.some((c) => c.url.endsWith("/me/messages")), "never creates a draft (that needs Mail.ReadWrite)");
});

Deno.test("a sent email whose copy cannot be found is still reported as sent", async () => {
  if (!COMPOSED.ok) return;
  const r = await sendAsMe("tok", toGraphMessage(COMPOSED),
    fakeFetch([[202, {}], [200, SENT_ITEM("Other", "x@y.com")], [200, { value: [] }], [200, { value: [] }]], []), noWait);
  assertEquals(r, { ok: true, messageId: null, conversationId: null });
});

Deno.test("a refused send is reported and nothing is looked up", async () => {
  if (!COMPOSED.ok) return;
  const calls: Call[] = [];
  const r = await sendAsMe("tok", toGraphMessage(COMPOSED), fakeFetch([[403, { error: { message: "Access is denied." } }]], calls), noWait);
  assertEquals(r, { ok: false, status: 403, error: "Access is denied." });
  assertEquals(calls.length, 1);
});

Deno.test("capture starts from a date and asks only for new messages' headers", () => {
  const u = new URL(initialDeltaUrl("inbox", "2026-08-30T00:00:00Z"));
  assertEquals(u.pathname, "/v1.0/me/mailFolders/inbox/messages/delta");
  assertEquals(u.searchParams.get("changeType"), "created");
  assertEquals(u.searchParams.get("$filter"), "receivedDateTime ge 2026-08-30T00:00:00Z");
  assertFalse((u.searchParams.get("$select") ?? "").includes("body"), "bodies are fetched only for matched mail");
});

Deno.test("delta pages follow Graph's links only, and report an expired token", async () => {
  assertEquals(await deltaPage("t", "https://evil.example/next", fakeFetch([], [])), { ok: false, status: 400, gone: false });
  const page = await deltaPage("t", "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?x=1",
    fakeFetch([[200, { value: [{ id: "m1" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/d" }]], []));
  assertEquals(page, { ok: true, messages: [{ id: "m1" }], next: null, deltaLink: "https://graph.microsoft.com/v1.0/d" });
  const gone = await deltaPage("t", "https://graph.microsoft.com/v1.0/x", fakeFetch([[410, {}]], []));
  assertEquals(gone, { ok: false, status: 410, gone: true });
});

Deno.test("the message text is the new part only", async () => {
  const calls: Call[] = [];
  const body = await getUniqueBody("t", "m1", fakeFetch([[200, { uniqueBody: { content: "  Approved.  " } }]], calls));
  assertEquals(body, "Approved.");
  assertEquals((calls[0].init?.headers as Record<string, string>).Prefer, 'outlook.body-content-type="text"');
});
