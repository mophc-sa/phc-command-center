// =============================================================================
// Managing a person's private Outlook calendar link.
//
// The feed itself is served by ../../calendar-feed. These actions let a signed-in
// person create, inspect and revoke THEIR OWN link — every query here is keyed
// to ctx.caller.userId, never to an id in the payload. The table is service-role
// only, so these handlers are the only way to reach it.
//
// The plaintext link is returned exactly once, from calendar_feed_create. It is
// never stored and cannot be read back: losing it means generating a new one,
// which also revokes the old.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err } from "../shared.ts";
import { hashThreadToken } from "../../_shared/mail.ts";
import { newFeedToken } from "../../_shared/calendar-feed.ts";

async function calendar_feed_status(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const { data } = await ctx.svc
    .from("calendar_feed_tokens")
    .select("created_at, last_fetched_at")
    .eq("user_id", ctx.caller.userId)
    .maybeSingle();
  return json({
    ok: true,
    active: Boolean(data),
    created_at: data?.created_at ?? null,
    last_fetched_at: data?.last_fetched_at ?? null,
  });
}

async function calendar_feed_create(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!base) return err("Calendar links are not available", 503);

  const token = newFeedToken();
  // One row per person: creating a link replaces any previous one, which is what
  // revokes a link that may have leaked.
  const { error } = await ctx.svc.from("calendar_feed_tokens").upsert(
    {
      user_id: ctx.caller.userId,
      token_hash: await hashThreadToken(token),
      created_at: new Date().toISOString(),
      last_fetched_at: null,
    },
    { onConflict: "user_id" },
  );
  if (error) return err("Could not create the calendar link", 500);

  await ctx.audit(ctx.svc, ctx.caller.userId, "calendar_feed.created", "user", ctx.caller.userId, {}, ctx.caller.roles);
  return json({ ok: true, url: `${base}/functions/v1/calendar-feed?t=${token}` });
}

async function calendar_feed_revoke(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const { error } = await ctx.svc.from("calendar_feed_tokens").delete().eq("user_id", ctx.caller.userId);
  if (error) return err("Could not revoke the calendar link", 500);
  await ctx.audit(ctx.svc, ctx.caller.userId, "calendar_feed.revoked", "user", ctx.caller.userId, {}, ctx.caller.roles);
  return json({ ok: true, active: false });
}

export const calendarFeedModule: HandlerModule = {
  name: "calendar-feed",
  handlers: { calendar_feed_status, calendar_feed_create, calendar_feed_revoke },
};
