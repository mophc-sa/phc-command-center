// =============================================================================
// outlook-connector — where Microsoft sends the browser after sign-in.
//
// Reached by a browser redirect, never with a user JWT, so this function is
// deployed with verify_jwt = false (see supabase/config.toml). It authenticates
// the request by the one-time state that sales-os-api's outlook_connect_start
// stored (as a hash, with the PKCE verifier, for ten minutes). A state that is
// unknown, used, or expired ends here.
//
// Every exit is a redirect back to the app's Settings page with a short result
// code; tokens and mailbox details are never logged or put in the URL.
// Rules live in ../_shared/graph.ts and ../_shared/graph-client.ts.
// =============================================================================

import { audit, serviceClient } from "../_shared/supabase.ts";
import { hashState, readGraphConfig, sameMailbox } from "../_shared/graph.ts";
import { exchangeCode, getMe } from "../_shared/graph-client.ts";

const APP_URL = (Deno.env.get("APP_URL") ?? "https://agent.phc-sa.com").replace(/\/+$/, "");
const back = (result: string) =>
  new Response(null, { status: 302, headers: { Location: `${APP_URL}/settings?outlook=${result}` } });
const log = (outcome: string) => console.log(JSON.stringify({ fn: "outlook-connector", outcome }));

export async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET" || !url.pathname.endsWith("/callback")) return new Response("not found", { status: 404 });

  const cfg = readGraphConfig((k) => Deno.env.get(k));
  if (!cfg.configured) return back("unavailable");

  const state = url.searchParams.get("state") ?? "";
  if (!state || state.length > 200) return back("expired");

  // Consume the pending sign-in first: a state works once, whatever follows.
  const svc = serviceClient();
  const { data: pending } = await svc
    .from("mail_oauth_pending")
    .delete()
    .eq("state_hash", await hashState(state))
    .select("user_id, code_verifier, expires_at")
    .maybeSingle();
  if (!pending || Date.parse(pending.expires_at) < Date.now()) {
    log("expired");
    return back("expired");
  }

  if (url.searchParams.get("error")) {
    log("denied");
    return back("denied");
  }
  const code = url.searchParams.get("code") ?? "";
  if (!code) return back("denied");

  const tok = await exchangeCode(cfg, code, pending.code_verifier);
  if (!tok.ok || !tok.refresh) {
    log("exchange_failed");
    return back("failed");
  }

  const me = await getMe(tok.access);
  const { data: profile } = await svc.from("profiles").select("email, status").eq("id", pending.user_id).maybeSingle();
  if (!me || profile?.status !== "active" || !sameMailbox(me.mail, profile?.email)) {
    log("wrong_mailbox");
    return back("wrong_mailbox");
  }

  const { error } = await svc.rpc("save_mail_connection", {
    _user: pending.user_id,
    _ms_user_id: me.id,
    _email: me.mail,
    _scopes: tok.scopes,
    _refresh_token: tok.refresh,
  });
  if (error) {
    log("save_failed");
    return back("failed");
  }

  await audit(svc, pending.user_id, "outlook.connected", "user", pending.user_id, { scopes: tok.scopes });
  log("connected");
  return back("connected");
}

Deno.serve(handleCallback);
