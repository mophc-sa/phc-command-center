// =============================================================================
// Connecting a salesperson's own Outlook mailbox.
//
// outlook_connect_start begins Microsoft's sign-in for THE CALLER: it keeps the
// PKCE verifier server-side, keyed by the hash of a one-time state, and returns
// the URL to open. Microsoft then redirects the browser to the outlook-connector
// function, which finishes the sign-in (see ../../outlook-connector/index.ts).
//
// outlook_disconnect deletes the connection and its token from Vault. Every
// query is keyed to ctx.caller.userId, never to an id in the payload.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err } from "../shared.ts";
import { authorizeUrl, hashState, newOAuthState, newPkce, readGraphConfig } from "../../_shared/graph.ts";

const env = (k: string) => Deno.env.get(k);
const PENDING_MINUTES = 10;

async function outlook_connect_start(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const cfg = readGraphConfig(env);
  if (!cfg.configured) return err("Outlook connection is not set up yet", 503);

  // The same test send_email applies: only people who may send may connect.
  const { data: contributor, error: roleErr } = await ctx.asCaller.rpc("is_sales_contributor", {
    _user_id: ctx.caller.userId,
  });
  if (roleErr) return err("Could not verify your permissions", 500);
  if (contributor !== true) return err("Your role cannot connect a mailbox", 403);

  const { data: profile } = await ctx.asCaller
    .from("profiles")
    .select("email")
    .eq("id", ctx.caller.userId)
    .maybeSingle();
  const email = String(profile?.email ?? "").trim().toLowerCase();
  if (!email) return err("Your profile has no email address to connect", 400);

  const state = newOAuthState();
  const { verifier, challenge } = await newPkce();
  // One sign-in in flight per person: an older, abandoned one is replaced.
  await ctx.svc.from("mail_oauth_pending").delete().eq("user_id", ctx.caller.userId);
  const { error } = await ctx.svc.from("mail_oauth_pending").insert({
    state_hash: await hashState(state),
    user_id: ctx.caller.userId,
    code_verifier: verifier,
    expires_at: new Date(Date.now() + PENDING_MINUTES * 60_000).toISOString(),
  });
  if (error) return err("Could not start the Outlook sign-in", 500);

  return json({ ok: true, url: authorizeUrl(cfg, state, challenge, email) });
}

async function outlook_disconnect(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const { data, error } = await ctx.svc.rpc("delete_mail_connection", { _user: ctx.caller.userId });
  if (error) return err("Could not disconnect Outlook", 500);
  await ctx.audit(ctx.svc, ctx.caller.userId, "outlook.disconnected", "user", ctx.caller.userId, {}, ctx.caller.roles);
  return json({ ok: true, disconnected: data === true });
}

export const outlookModule: HandlerModule = {
  name: "outlook",
  handlers: { outlook_connect_start, outlook_disconnect },
};
