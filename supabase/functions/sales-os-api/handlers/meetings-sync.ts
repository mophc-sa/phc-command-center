// =============================================================================
// "Fetch from Fireflies": the safety net for the webhook and the 30-minute pull.
//
// meetings-inbound receives a meeting the moment Fireflies finishes it, but a
// webhook can be missed (it was, for a day, when the signing secret differed).
// The button pulls the last two weeks of processed meetings and stores the
// ones we do not have, through the same ingest_meeting as the webhook.
// Nothing becomes a task here either: every action item still waits for a
// decision.
//
// Two sources, either or both:
//   - a reviewer (can_review_meetings, tested with the caller's own session)
//     pulls the company account (FIREFLIES_API_KEY);
//   - anyone who connected their own Fireflies account in Settings pulls it.
// ingest_meeting is service-role only, so the writes use ctx.svc — after those
// checks, never before them.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { err, json } from "../shared.ts";
import type { TeamMember } from "../../_shared/fireflies.ts";
import { pullAccount, pullSince, type PullCounts } from "../../_shared/fireflies-pull.ts";

async function meetings_sync(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const { data: allowed } = await ctx.asCaller.rpc("can_review_meetings", { _user_id: ctx.caller.userId });
  const reviewer = allowed === true;
  const companyKey = reviewer ? Deno.env.get("FIREFLIES_API_KEY") : undefined;
  const { data: ownKey } = await ctx.svc.rpc("fireflies_api_key", { _user: ctx.caller.userId });
  const own = typeof ownKey === "string" && ownKey ? ownKey : null;

  if (!reviewer && !own) return err("Connect your Fireflies account in Settings first.", 403);
  if (!companyKey && !own) return err("Fireflies is not configured.", 503);

  const { data: members, error: memErr } = await ctx.svc
    .from("profiles")
    .select("id, email, full_name")
    .eq("status", "active")
    .eq("is_display_account", false);
  if (memErr) return err("Could not load the team.", 500);

  const since = pullSince(null, Date.now());
  const total: PullCounts = { found: 0, added: 0, already: 0 };
  const sources: Array<[string, string | null]> = [];
  if (companyKey) sources.push([companyKey, null]);
  if (own) sources.push([own, ctx.caller.userId]);

  for (const [key, connectedUserId] of sources) {
    const r = await pullAccount(ctx.svc, key, since, (members ?? []) as TeamMember[], connectedUserId);
    if (!r.ok) {
      if (r.reason === "store") return err("Could not store a meeting.", 500);
      if (connectedUserId && r.reason === "unauthorized") {
        await ctx.svc.rpc("mark_fireflies_connection", { _user: connectedUserId, _status: "needs_reconnect", _error: "Fireflies refused the API key" });
        return err("Fireflies refused your API key. Reconnect it in Settings.", 400);
      }
      return err("Fireflies did not answer. Try again in a minute.", 502);
    }
    total.found += r.value.found;
    total.added += r.value.added;
    total.already += r.value.already;
    if (connectedUserId) await ctx.svc.rpc("mark_fireflies_connection", { _user: connectedUserId, _status: "active", _error: null });
  }

  await ctx.audit(ctx.svc, ctx.caller.userId, "meetings.synced", "meeting", null, { found: total.found, added: total.added }, ctx.caller.roles);
  return json({ ok: true, ...total });
}

export const meetingsSyncModule: HandlerModule = {
  name: "meetings-sync",
  handlers: { meetings_sync },
};
