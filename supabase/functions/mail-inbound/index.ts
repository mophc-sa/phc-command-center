// =============================================================================
// mail-inbound — Postmark posts client replies here.
//
// Called by Postmark, never by a browser, so there is no user JWT: this function
// is deployed with verify_jwt = false (see supabase/config.toml) and
// authenticates the request itself with the HTTP Basic credentials embedded in
// the webhook URL. Without that setting the Supabase gateway would reject every
// reply for lacking a JWT before this code ever ran.
//
// Rules live in ../_shared/mail-inbound.ts. This file only sequences them.
//
// STATUS CODES ARE INSTRUCTIONS TO POSTMARK, so each one is chosen for what it
// makes Postmark do next:
//
//   403  bad credentials            -> Postmark stops retrying. A caller without
//                                      the secret should not get ten more tries.
//   503  capture not configured     -> Postmark retries for hours, which is the
//                                      window an admin has to fix a missing domain
//                                      before a real reply is lost.
//   200  dropped or already stored  -> nothing to retry. A message we will not
//                                      keep is not an error to be repeated.
//   500  database failure           -> retry; the reply was ours and was not saved.
//
// Nothing about a message — sender, subject, body — is ever written to the logs.
// =============================================================================

import { serviceClient } from "../_shared/supabase.ts";
import { readMailConfig, hashThreadToken } from "../_shared/mail.ts";
import { authorizeInbound, readInbound } from "../_shared/mail-inbound.ts";

const env = (k: string) => Deno.env.get(k);
const text = (status: number, body = "") => new Response(body, { status, headers: { "Content-Type": "text/plain" } });

export async function handleInbound(req: Request): Promise<Response> {
  if (req.method !== "POST") return text(405, "method not allowed");

  if (!authorizeInbound(req.headers.get("authorization"), env("MAIL_INBOUND_SECRET"))) {
    return text(403, "forbidden");
  }

  const cfg = readMailConfig(env);
  if (!cfg.capture || !cfg.captureDomain) return text(503, "capture not configured");

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return text(200, "ignored");
  }

  const decision = readInbound(payload, cfg.captureDomain);
  if (!decision.ok) {
    console.log(JSON.stringify({ fn: "mail-inbound", outcome: "dropped", reason: decision.reason }));
    return text(200, "ignored");
  }
  const r = decision.record;

  const svc = serviceClient();
  const { data: thread, error: threadErr } = await svc
    .from("email_threads")
    .select("opportunity_id, company_id, contact_id, owner_id")
    .eq("token_hash", await hashThreadToken(r.replyId))
    .maybeSingle();
  if (threadErr) {
    console.error(JSON.stringify({ fn: "mail-inbound", outcome: "error", stage: "thread_lookup" }));
    return text(500, "error");
  }
  if (!thread) {
    // An id of the right shape that matches no send. Stored nowhere.
    console.log(JSON.stringify({ fn: "mail-inbound", outcome: "dropped", reason: "unknown_thread" }));
    return text(200, "ignored");
  }

  const { error: insErr } = await svc.from("activities").insert({
    activity_type: "email_received",
    status: "logged",
    related_opportunity_id: thread.opportunity_id,
    company_id: thread.company_id,
    contact_id: thread.contact_id,
    owner_id: thread.owner_id,
    occurred_at: r.occurredAt,
    summary: r.subject,
    draft_content: r.body,
    email_from: r.from,
    email_to: r.to,
    provider_message_id: r.providerMessageId,
  });

  if (insErr) {
    // Postmark retries up to ten times. The unique index on provider_message_id
    // turns a retry of something already saved into a no-op rather than a copy.
    if ((insErr as { code?: string }).code === "23505") return text(200, "duplicate");
    console.error(JSON.stringify({ fn: "mail-inbound", outcome: "error", stage: "insert" }));
    return text(500, "error");
  }

  console.log(JSON.stringify({ fn: "mail-inbound", outcome: "recorded" }));
  return text(200, "ok");
}

Deno.serve(handleInbound);
