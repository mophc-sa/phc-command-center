// =============================================================================
// "Fetch from Fireflies": the safety net for the webhook.
//
// meetings-inbound receives a meeting the moment Fireflies finishes it, but a
// webhook can be missed (it was, for a day, when the signing secret differed).
// A reviewer presses a button and this pulls the last two weeks of processed
// meetings from the Fireflies API and stores the ones we do not have, through
// the same ingest_meeting as the webhook. Nothing becomes a task here either:
// every action item still waits for a reviewer.
//
// Reviewer-only (can_review_meetings, tested with the caller's own session).
// ingest_meeting is service-role only, so the write uses ctx.svc — after that
// check, never before it.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { err, json } from "../shared.ts";
import {
  FIREFLIES_GRAPHQL_URL,
  type FirefliesTranscript,
  ingestableTranscripts,
  RECENT_TRANSCRIPTS_QUERY,
  type TeamMember,
  toIngestPayload,
} from "../../_shared/fireflies.ts";

const WINDOW_DAYS = 14;
const LIMIT = 25;

async function meetings_sync(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const { data: allowed } = await ctx.asCaller.rpc("can_review_meetings", { _user_id: ctx.caller.userId });
  if (allowed !== true) return err("Only meeting reviewers can fetch from Fireflies.", 403);

  const apiKey = Deno.env.get("FIREFLIES_API_KEY");
  if (!apiKey) return err("Fireflies is not configured.", 503);

  let listed: FirefliesTranscript[];
  try {
    const res = await fetch(FIREFLIES_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: RECENT_TRANSCRIPTS_QUERY,
        variables: { from: new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString(), limit: LIMIT },
      }),
    });
    if (!res.ok) return err("Fireflies did not answer. Try again in a minute.", 502);
    const body = await res.json() as { data?: { transcripts?: unknown } };
    listed = ingestableTranscripts(body?.data?.transcripts);
  } catch {
    return err("Fireflies did not answer. Try again in a minute.", 502);
  }

  const { data: members, error: memErr } = await ctx.svc
    .from("profiles")
    .select("id, email, full_name")
    .eq("status", "active")
    .eq("is_display_account", false);
  if (memErr) return err("Could not load the team.", 500);

  let added = 0;
  let already = 0;
  for (const t of listed) {
    const { meeting, items } = toIngestPayload(t, (members ?? []) as TeamMember[]);
    const { data, error } = await ctx.svc.rpc("ingest_meeting", { _meeting: meeting, _items: items });
    if (error) return err("Could not store a meeting.", 500);
    if ((data as { duplicate?: boolean } | null)?.duplicate) already++;
    else added++;
  }

  await ctx.audit(ctx.svc, ctx.caller.userId, "meetings.synced", "meeting", null, { found: listed.length, added }, ctx.caller.roles);
  return json({ ok: true, found: listed.length, added, already });
}

export const meetingsSyncModule: HandlerModule = {
  name: "meetings-sync",
  handlers: { meetings_sync },
};
