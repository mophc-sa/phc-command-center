// =============================================================================
// Settings → Fireflies: a salesperson connects their own Fireflies account.
//
// The person pastes their API key; it goes to this function and from here to
// Vault (save_fireflies_connection, service role only). The browser never
// reads it back: Settings shows my_fireflies_connection(), which has no key.
//
// The key is saved only if Fireflies says it opens an account with the
// caller's own sign-in email. Then the last two weeks are pulled at once, and
// pg_cron keeps pulling every 30 minutes (meetings-inbound).
//
// Every query is keyed to ctx.caller.userId, never to an id in the payload.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { err, json } from "../shared.ts";
import type { TeamMember } from "../../_shared/fireflies.ts";
import { firefliesAccount, pullAccount, pullSince, readApiKey, sameAccount } from "../../_shared/fireflies-pull.ts";

async function fireflies_connect(payload: Record<string, unknown>, ctx: SalesOsContext) {
  // The same test as connecting Outlook: the sales side, managers included.
  const { data: contributor, error: roleErr } = await ctx.asCaller.rpc("is_sales_contributor", {
    _user_id: ctx.caller.userId,
  });
  if (roleErr) return err("Could not verify your permissions", 500);
  if (contributor !== true) return err("Your role cannot connect a Fireflies account", 403);

  const apiKey = readApiKey(payload.apiKey);
  if (!apiKey) return err("Paste the API key from Fireflies → Settings → Developer settings.", 400);

  const { data: profile } = await ctx.svc.from("profiles").select("email").eq("id", ctx.caller.userId).maybeSingle();
  const email = String(profile?.email ?? "").trim().toLowerCase();
  if (!email) return err("Your profile has no email address to match", 400);

  const account = await firefliesAccount(apiKey);
  if (!account.ok) {
    return account.reason === "unauthorized"
      ? err("Fireflies did not accept this key. Copy it again from Fireflies.", 400)
      : err("Fireflies did not answer. Try again in a minute.", 502);
  }
  if (!sameAccount(account.value.email, email)) {
    return err(`This key opens another Fireflies account. Use the key of your own account (${email}).`, 400);
  }

  const { error: saveErr } = await ctx.svc.rpc("save_fireflies_connection", {
    _user: ctx.caller.userId,
    _email: account.value.email,
    _api_key: apiKey,
  });
  if (saveErr) return err("Could not save the connection", 500);
  await ctx.audit(ctx.svc, ctx.caller.userId, "fireflies.connected", "user", ctx.caller.userId, {}, ctx.caller.roles);

  // The first pull now, so the person sees their meetings straight away. A
  // failure here is not a failed connection: the scheduled pull retries.
  const { data: members } = await ctx.svc
    .from("profiles").select("id, email, full_name").eq("status", "active").eq("is_display_account", false);
  const first = await pullAccount(ctx.svc, apiKey, pullSince(null, Date.now()), (members ?? []) as TeamMember[], ctx.caller.userId);
  await ctx.svc.rpc("mark_fireflies_connection", {
    _user: ctx.caller.userId,
    _status: "active",
    _error: first.ok ? null : "First fetch did not complete; it will be retried",
  });
  return json({ ok: true, email: account.value.email, pulled: first.ok, ...(first.ok ? first.value : {}) });
}

async function fireflies_disconnect(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const { data, error } = await ctx.svc.rpc("delete_fireflies_connection", { _user: ctx.caller.userId });
  if (error) return err("Could not disconnect Fireflies", 500);
  await ctx.audit(ctx.svc, ctx.caller.userId, "fireflies.disconnected", "user", ctx.caller.userId, {}, ctx.caller.roles);
  return json({ ok: true, disconnected: data === true });
}

export const firefliesModule: HandlerModule = {
  name: "fireflies",
  handlers: { fireflies_connect, fireflies_disconnect },
};
