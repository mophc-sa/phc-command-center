// =============================================================================
// meetings-inbound — Fireflies.ai posts here when a meeting has been processed.
//
// Called by Fireflies, never by a browser, so there is no user JWT: this
// function is deployed with verify_jwt = false (see supabase/config.toml) and
// authenticates the request itself by the x-hub-signature HMAC over the raw
// body. It then fetches the transcript from the Fireflies API and stores one
// meeting with its action items for human review — nothing becomes a task here.
//
// Rules live in ../_shared/fireflies.ts. This file only sequences them.
//
// STATUS CODES ARE INSTRUCTIONS TO FIREFLIES:
//
//   403  bad signature               -> a caller without the secret gets no retries.
//   503  not configured              -> retry while an admin sets the secrets.
//   200  ignored / duplicate / saved -> nothing to retry.
//   502  Fireflies API failed        -> retry; the transcript may not be ready yet.
//   500  database failure            -> retry; the meeting was ours and was not saved.
//
// Nothing about a meeting — title, names, content — is ever written to the logs.
// =============================================================================

import { serviceClient } from "../_shared/supabase.ts";
import {
  FIREFLIES_GRAPHQL_URL,
  type FirefliesTranscript,
  readWebhook,
  type TeamMember,
  toIngestPayload,
  TRANSCRIPT_QUERY,
  verifySignature,
} from "../_shared/fireflies.ts";

const env = (k: string) => Deno.env.get(k);
const text = (status: number, body = "") => new Response(body, { status, headers: { "Content-Type": "text/plain" } });
const log = (outcome: string, extra: Record<string, string> = {}) =>
  console.log(JSON.stringify({ fn: "meetings-inbound", outcome, ...extra }));

const MAX_BODY = 16_384;

export async function handleMeetingWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") return text(405, "method not allowed");

  const secret = env("FIREFLIES_WEBHOOK_SECRET");
  const apiKey = env("FIREFLIES_API_KEY");
  if (!secret || !apiKey) return text(503, "not configured");

  const raw = await req.text();
  if (raw.length > MAX_BODY) return text(403, "forbidden");
  if (!(await verifySignature(raw, req.headers.get("x-hub-signature"), secret))) {
    log("rejected", { reason: "signature" });
    return text(403, "forbidden");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return text(200, "ignored");
  }
  const hook = readWebhook(payload);
  if (!hook.ok) {
    log("dropped", { reason: hook.reason });
    return text(200, "ignored");
  }

  let transcript: FirefliesTranscript | null;
  try {
    const res = await fetch(FIREFLIES_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: TRANSCRIPT_QUERY, variables: { id: hook.meetingId } }),
    });
    if (!res.ok) {
      log("error", { stage: "fireflies_api", status: String(res.status) });
      return text(502, "upstream error");
    }
    const body = await res.json() as { data?: { transcript?: FirefliesTranscript | null } };
    transcript = body?.data?.transcript ?? null;
  } catch {
    log("error", { stage: "fireflies_api" });
    return text(502, "upstream error");
  }
  if (!transcript?.id) {
    // Deleted, private to someone else, or not ready: retrying helps only the last.
    log("error", { stage: "transcript_missing" });
    return text(502, "transcript unavailable");
  }

  const svc = serviceClient();
  const { data: members, error: memErr } = await svc
    .from("profiles")
    .select("id, email, full_name")
    .eq("status", "active")
    .eq("is_display_account", false);
  if (memErr) {
    log("error", { stage: "members" });
    return text(500, "error");
  }

  const { meeting, items } = toIngestPayload(transcript, (members ?? []) as TeamMember[]);
  const { data, error } = await svc.rpc("ingest_meeting", { _meeting: meeting, _items: items });
  if (error) {
    log("error", { stage: "ingest" });
    return text(500, "error");
  }

  const duplicate = Boolean((data as { duplicate?: boolean } | null)?.duplicate);
  log(duplicate ? "duplicate" : "recorded", { items: String(items.length) });
  return text(200, duplicate ? "duplicate" : "ok");
}

Deno.serve(handleMeetingWebhook);
