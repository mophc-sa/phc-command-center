// =============================================================================
// calendar-feed — the private link Outlook subscribes to.
//
// Outlook polls this URL on its own schedule with no session, so there is no
// JWT: deployed with verify_jwt = false (supabase/config.toml), and the token in
// the query string is the credential. Rules live in ../_shared/calendar-feed.ts.
//
// Every query is filtered by the owner column of its table. The service role
// bypasses RLS, so these filters ARE the read boundary for this endpoint: a feed
// shows exactly what its owner is responsible for, and nothing a teammate owns.
// A contract test fails if any source query here lacks its owner filter.
//
// Not served: an unknown or malformed token, a revoked link, or an account that
// is no longer active. All three return the same 404, so a guess cannot tell a
// wrong token from a suspended user.
// =============================================================================

import { serviceClient } from "../_shared/supabase.ts";
import { hashThreadToken } from "../_shared/mail.ts";
import { collectFeedEvents, isFeedToken, toICS } from "../_shared/calendar-feed.ts";

const env = (k: string) => Deno.env.get(k);
const notFound = () => new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });

/** Keep the feed small: two months of overdue items, and everything ahead. */
const HISTORY_DAYS = 60;

export async function handleFeed(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }

  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!isFeedToken(token)) return notFound();

  const svc = serviceClient();
  // Same SHA-256 as reply ids; the function is generic over the string.
  const { data: link } = await svc
    .from("calendar_feed_tokens")
    .select("user_id")
    .eq("token_hash", await hashThreadToken(token))
    .maybeSingle();
  if (!link) return notFound();
  const uid = link.user_id as string;

  const { data: profile } = await svc.from("profiles").select("status").eq("id", uid).maybeSingle();
  if (profile?.status !== "active") return notFound();

  const notNull = (c: string) => `${c}.not.is.null`;
  const [followUps, opportunities, rfqs, tasks, commitments, quotations, tenders, flags, intake] = await Promise.all([
    svc.from("follow_ups").select("id, opportunity_id, due_date, status, channel")
      .eq("owner_id", uid).not("due_date", "is", null).limit(2000),
    svc.from("opportunities").select("id, project_name, next_action, next_action_due, expected_contract_date, hold_review_date, sales_stage")
      .eq("owner_id", uid)
      .or([notNull("next_action_due"), notNull("expected_contract_date"), notNull("hold_review_date")].join(",")).limit(2000),
    svc.from("rfqs").select("id, rfq_number, response_due_date, status, opportunity_id")
      .eq("sales_owner_id", uid).is("archived_at", null).not("response_due_date", "is", null).limit(2000),
    svc.from("tasks").select("id, title, due_date, completed_at, related_opportunity_id")
      .eq("owner_id", uid).not("due_date", "is", null).limit(2000),
    svc.from("commitments").select("id, description, due_date, closed_at, opportunity_id")
      .eq("owner_id", uid).not("due_date", "is", null).limit(2000),
    // Historical quotations are imported archive rows. Their old expiry dates are
    // not obligations, and there are enough of them to bury the real ones.
    svc.from("quotations").select("id, quote_number, valid_until, related_opportunity_id")
      .eq("owner_id", uid).eq("is_historical", false).not("valid_until", "is", null).limit(2000),
    svc.from("tenders").select("id, tender_name, tender_stage, expected_award_date, next_follow_up_date")
      .eq("tender_owner_id", uid).is("archived_at", null)
      .or([notNull("expected_award_date"), notNull("next_follow_up_date")].join(",")).limit(2000),
    svc.from("opportunity_flags").select("id, reason, flag_kind, due_date, status, completed_at, linked_record_type, linked_record_id")
      .eq("action_owner_id", uid).not("due_date", "is", null).limit(2000),
    svc.from("inbox_items").select("id, project_name, deadline, follow_up_date, info_due_date, status")
      .eq("assigned_owner_id", uid)
      .or([notNull("deadline"), notNull("follow_up_date"), notNull("info_due_date")].join(",")).limit(2000),
  ]);

  // A failed source must not silently drop a person's obligations while the
  // feed looks complete. Serve nothing, and let Outlook keep its last copy.
  const failed = [followUps, opportunities, rfqs, tasks, commitments, quotations, tenders, flags, intake].some((r) => r.error);
  if (failed) {
    console.error(JSON.stringify({ fn: "calendar-feed", outcome: "error", stage: "read" }));
    return new Response("temporarily unavailable", { status: 503, headers: { "Retry-After": "900" } });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const events = collectFeedEvents({
    followUps: followUps.data ?? [],
    opportunities: opportunities.data ?? [],
    rfqs: rfqs.data ?? [],
    tasks: tasks.data ?? [],
    commitments: commitments.data ?? [],
    quotations: quotations.data ?? [],
    tenders: tenders.data ?? [],
    flags: flags.data ?? [],
    intake: intake.data ?? [],
  }).filter((e) => e.date >= cutoff);

  const body = toICS(events, {
    appUrl: env("PUBLIC_APP_URL") ?? "https://agent.phc-sa.com",
    now,
    name: "PHC — My work",
  });

  // Best-effort: lets the owner see their subscription is alive.
  void svc.from("calendar_feed_tokens").update({ last_fetched_at: now.toISOString() }).eq("user_id", uid);

  return new Response(req.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="phc-my-work.ics"',
      // Private: this is one person's work, never to be cached by a shared proxy.
      "Cache-Control": "private, max-age=900",
    },
  });
}

Deno.serve(handleFeed);
