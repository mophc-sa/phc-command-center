// supabase/functions/outlook-sync/info-pass.ts
// =============================================================================
// The info@phc-sa.com pass (manager feedback 2026-10-19, group 3 part B).
//
// Every five minutes (cron job info-mailbox-sync): read new inbox mail with an
// app-only token Exchange limits to info@, store each message, put a reply in a
// known conversation on its deal, and ask the orchestrator to classify the rest.
// What a classification does — an intake item, an owner, a notification — is
// decided in SQL (info_mail_apply_triage), not here.
//
// No AI and no text for: mail from before the first pass (header only, left
// for a router to route by hand) and newsletters/bulk mail (stored as spam).
// When the AI is out, sorting backs off (30 min, doubling, at most 2 h) and
// then tries one message before it carries on.
// =============================================================================

import type { serviceClient } from "../_shared/supabase.ts";
import type { readGraphConfig } from "../_shared/graph.ts";
import { appAccess, deltaPage, getMailboxMessage, mailboxDeltaUrl } from "../_shared/graph-client.ts";
import { capBody, isAutoReply, isBulkMail, isInternalSender, toInfoMessage } from "../_shared/info-mail.ts";

type Svc = ReturnType<typeof serviceClient>;
type Cfg = ReturnType<typeof readGraphConfig>;

const FIRST_READ_DAYS = 7;
const MAX_PAGES = 10;
const TRIAGE_PER_RUN = 8;
const MIN_CALL_MS = 5_000;
const CALL_MAX_MS = 25_000;
const PRIVATE = new Set(["1", "2"]); // PR_SENSITIVITY: personal, private
const BACKOFF_FIRST_MIN = 30;
const BACKOFF_MAX_MIN = 120;
const NO_MORE_ATTEMPTS = 3; // the SQL's attempt limit: past it a row waits for a router

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ fn: "outlook-sync", pass: "info", ...o }));

type PassResult = { stored: number; triaged: number; error: string | null };
type PassOpts = { mailbox: string; syncKey: string; started: number; budgetMs: number };

export async function syncInfoMailbox(svc: Svc, cfg: Cfg, opts: PassOpts): Promise<PassResult> {
  try {
    return await runPass(svc, cfg, opts);
  } catch (e) {
    // A malformed INFO_MAILBOX makes the Graph URL builders throw. Say so in
    // last_error instead of failing the whole request; anything else is a bug
    // and still surfaces.
    if (e instanceof Error && e.message === "bad mailbox") {
      await saveState(svc, null, "bad mailbox setting", true);
      log({ outcome: "bad_mailbox" });
      return { stored: 0, triaged: 0, error: "config" };
    }
    throw e;
  }
}

async function runPass(svc: Svc, cfg: Cfg, opts: PassOpts): Promise<PassResult> {
  const inBudget = () => Date.now() - opts.started < opts.budgetMs;
  const tok = await appAccess(cfg);
  if (!tok.ok) {
    await saveState(svc, null, "token refused", true);
    log({ outcome: "token_failed" });
    return { stored: 0, triaged: 0, error: "token" };
  }

  // 1. Read new mail.
  const { data: state, error: stateErr } = await svc.from("info_mailbox_state")
    .select("delta_link, started_at, triage_retry_at, triage_backoff_minutes").eq("id", true).maybeSingle();
  if (stateErr) {
    // Without the saved link and go-live time the pass cannot tell new mail
    // from old, so it stores and sorts nothing this round.
    try { await saveState(svc, null, "state unavailable", true); } catch { /* best effort */ }
    log({ outcome: "state_unavailable" });
    return { stored: 0, triaged: 0, error: "state" };
  }
  // The first pass marks go-live. Mail received before it is stored header
  // only and never sent to the AI (a router routes it by hand). Mail counts as
  // old only when a go-live time is confirmed, from the read or from the write;
  // if the write is not confirmed, this run's mail is stored as new.
  let startedAt = (state?.started_at as string | null) ?? null;
  let startNote: string | null = null;
  if (!startedAt) {
    const now = new Date().toISOString();
    const { data: written, error: writeErr } = await svc.from("info_mailbox_state")
      .update({ started_at: now }).eq("id", true).is("started_at", null).select("started_at");
    const saved = !writeErr ? (written?.[0]?.started_at as string | undefined) ?? null : null;
    if (saved) startedAt = saved;
    else startNote = "start time not saved";
  }
  const startedMs = startedAt ? Date.parse(startedAt) : null;
  const retryAt = state?.triage_retry_at ? Date.parse(state.triage_retry_at as string) : null;
  const backoffMin = Number(state?.triage_backoff_minutes ?? 0);
  const backingOff = retryAt !== null && Date.now() < retryAt;
  const since = new Date(Date.now() - FIRST_READ_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  let url = (state?.delta_link as string | null) ?? mailboxDeltaUrl(opts.mailbox, since);
  let resume: string | null = (state?.delta_link as string | null) ?? null;
  let error: string | null = startNote;
  const batch: Array<Record<string, unknown>> = [];
  for (let i = 0; i < MAX_PAGES && inBudget(); i++) {
    const r = await deltaPage(tok.access, url);
    if (!r.ok) {
      error = r.error ?? `graph ${r.status}`;
      resume = r.gone ? null : resume;
      break;
    }
    batch.push(...r.messages);
    if (r.deltaLink) { resume = r.deltaLink; break; }
    if (!r.next) break;
    url = r.next;
    resume = r.next;
  }

  // 2. Store them.
  let stored = 0;
  let backfilled = 0;
  let bulk = 0;
  let complete = true;
  for (const raw of batch) {
    if (!inBudget()) { complete = false; break; }
    const m = toInfoMessage(raw);
    if (!m || isInternalSender(m)) continue;
    const { data: seen } = await svc.from("info_mail").select("id").eq("graph_message_id", m.graphId).maybeSingle();
    if (seen) continue;
    const detail = await getMailboxMessage(tok.access, opts.mailbox, m.graphId, m.hasAttachments);
    if (!detail) { complete = false; error = "message detail unavailable"; break; } // try the whole round again next time
    if (PRIVATE.has(detail.sensitivity ?? "") || isAutoReply(detail.headers)) continue;
    // Newsletters are spam without asking the AI; old mail waits for a router.
    // Neither keeps its text.
    const isBulk = isBulkMail(detail.headers);
    const isOld = !isBulk && startedMs !== null && Date.parse(m.receivedAt) < startedMs;

    const { data: row, error: insErr } = await svc.from("info_mail").insert({
      graph_message_id: m.graphId,
      internet_message_id: m.internetMessageId,
      conversation_id: m.conversationId,
      from_email: m.fromEmail,
      from_name: m.fromName,
      subject: m.subject,
      received_at: m.receivedAt,
      body_text: isBulk || isOld ? null : capBody(detail.body),
      attachment_names: detail.attachmentNames,
      web_link: m.webLink,
      ...(isBulk ? { category: "spam" } : {}),
      ...(isOld ? { triage_attempts: NO_MORE_ATTEMPTS } : {}),
    }).select("id").single();
    if (insErr) {
      if (insErr.code === "23505") continue;
      complete = false;
      error = "store failed";
      break;
    }
    stored++;
    if (isBulk) bulk++;
    if (isOld) backfilled++;

    // A later message in a conversation that already became an item or a deal.
    // If that fails new mail stays unclassified and the triage step tries
    // again; old and bulk mail are not retried (a router sees them).
    await recordReplyIfKnown(svc, row.id as string, m.conversationId);
  }
  if (backingOff) error = error ?? "triage backing off after an AI outage";
  await saveState(svc, complete ? resume : (state?.delta_link as string | null) ?? null, error, false);
  if (backingOff) {
    log({ outcome: "backing_off", stored, backfilled, bulk, read: batch.length });
    return { stored, triaged: 0, error };
  }

  // 3. Classify what is waiting, newest first, while there is time. After a
  // backoff the first call is a probe: carry on only if it gets an answer.
  const probe = retryAt !== null;
  let triaged = 0;
  let answered = 0; // classify calls the AI answered: it is up
  let calls = 0;
  let paused: string | null = null;
  const { data: waiting } = await svc.from("info_mail").select("id, triage_attempts, conversation_id")
    .eq("category", "unclassified").lt("triage_attempts", NO_MORE_ATTEMPTS)
    .order("received_at", { ascending: false }).limit(TRIAGE_PER_RUN);
  // One row the provider rejects must not block the queue. An outage on row A
  // is held back: if the next row works (or fails on its own), A was the
  // problem and is charged; if the next row also hits an outage, it is real.
  let pendingOutage: { id: string; code: string } | null = null;
  for (const w of waiting ?? []) {
    if (!inBudget()) break;
    const id = w.id as string;
    // Its conversation may have a parent by now (a reply whose first
    // record_reply failed, or two mails in one window). A reply is never
    // classified as new mail: a failed binding costs it an attempt, so one
    // that keeps failing still leaves the queue.
    const bound = await recordReplyIfKnown(svc, id, w.conversation_id as string | null);
    if (bound !== "none") {
      if (bound === "failed") {
        await svc.rpc("info_mail_triage_failed", { _mail_id: id });
        error = error ?? "reply binding failed";
      }
      continue;
    }

    const left = opts.budgetMs - (Date.now() - opts.started);
    if (left < MIN_CALL_MS) break; // not enough time to start a call
    const timeoutMs = Math.min(CALL_MAX_MS, left - 2000);
    const r = await classify(id, Number(w.triage_attempts), opts.syncKey, timeoutMs);
    const probing = probe && ++calls === 1;
    if (r.kind === "outage") {
      // Cut short by this run's own clock: out of time, not an outage.
      if (r.code === "TIMEOUT" && timeoutMs < CALL_MAX_MS) break;
      if (!probing && !pendingOutage) { pendingOutage = { id, code: r.code }; continue; }
      paused = r.code; // the probe failed, or two rows in a row: a real outage, charge neither
      break;
    }
    if (r.kind === "ok") answered++;
    if (pendingOutage) { // this row got an answer, so the earlier failure was its own
      await svc.rpc("info_mail_triage_failed", { _mail_id: pendingOutage.id });
      pendingOutage = null;
    }
    if (r.kind === "message") {
      await svc.rpc("info_mail_triage_failed", { _mail_id: id });
      if (probing) break; // no answer from the probe: wait for the next run
      continue;
    }
    const { error: applyErr } = await svc.rpc("info_mail_apply_triage", {
      _mail_id: id,
      _category: r.verdict.category,
      _confidence: r.verdict.confidence,
      _summary: `${r.verdict.summary_en}\n${r.verdict.summary_ar}`,
      _fields: r.verdict.request,
    });
    if (applyErr) {
      await svc.rpc("info_mail_triage_failed", { _mail_id: id });
      continue;
    }
    triaged++;
  }
  // A held-back row at the end of a run in which the AI answered others failed
  // on its own: charge it, so one poison message cannot hold the queue.
  if (pendingOutage && !paused && answered > 0) {
    await svc.rpc("info_mail_triage_failed", { _mail_id: pendingOutage.id });
    pendingOutage = null;
  }
  // Still out (a real outage, or a lone row nothing else could vouch for):
  // back off. Any answer resets the backoff.
  const outage = paused ?? pendingOutage?.code ?? null;
  let backoff: number | null = null;
  if (outage) {
    backoff = backoffMin > 0 ? Math.min(backoffMin * 2, BACKOFF_MAX_MIN) : BACKOFF_FIRST_MIN;
    error = error ?? `triage paused: ${outage}`;
    await svc.from("info_mailbox_state").update({
      last_error: error.slice(0, 500),
      triage_retry_at: new Date(Date.now() + backoff * 60_000).toISOString(),
      triage_backoff_minutes: backoff,
    }).eq("id", true);
  } else if (answered > 0 && (retryAt !== null || backoffMin > 0)) {
    await svc.from("info_mailbox_state").update({ triage_retry_at: null, triage_backoff_minutes: 0 }).eq("id", true);
  }
  log({ outcome: error ? "partial" : "done", stored, backfilled, bulk, triaged, read: batch.length, backoff });
  return { stored, triaged, error };
}

type Verdict = {
  category: string;
  confidence: number;
  summary_en: string;
  summary_ar: string;
  request: Record<string, unknown> | null;
};

// "message": the AI looked at this message and failed on it, so it may cost the
// message an attempt. "outage": anything else (config, quota, network, provider,
// auth); nothing about the message is known, so no attempt is spent.
// Codes: AiErrorCode in ../_shared/ai-schemas.ts.
type Classified =
  | { kind: "ok"; verdict: Verdict }
  | { kind: "message"; code: string }
  | { kind: "outage"; code: string };

const MESSAGE_FAULT = new Set([
  "AI_GUARDRAIL_REJECTED",
  "AI_RESPONSE_PARSE_FAILED",
  "AI_OUTPUT_VALIDATION_FAILED",
  "AI_CONTEXT_TOO_LARGE",
]);

async function classify(mailId: string, attempt: number, syncKey: string, timeoutMs: number): Promise<Classified> {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  try {
    const res = await fetch(`${base}/functions/v1/ai-orchestrator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The gateway checks a JWT before the function runs; the anon key
        // passes it. The function itself trusts only the service key below.
        Authorization: `Bearer ${anon}`,
        apikey: anon,
        "x-phc-service-key": syncKey,
      },
      body: JSON.stringify({
        agent: "info_mail_triage",
        entityType: "info_mail",
        entityId: mailId,
        input: {},
        clientRequestId: `info_mail:${mailId}:${attempt}`,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await res.json().catch(() => null) as
      | { ok?: boolean; result?: Verdict; code?: unknown }
      | null;
    if (j?.ok === true && j.result) return { kind: "ok", verdict: j.result };
    const code = typeof j?.code === "string" && /^AI_[A-Z_]{1,40}$/.test(j.code) ? j.code : `HTTP_${res.status}`;
    return { kind: MESSAGE_FAULT.has(code) ? "message" : "outage", code };
  } catch (e) {
    return { kind: "outage", code: e instanceof DOMException && e.name === "TimeoutError" ? "TIMEOUT" : "NETWORK" };
  }
}

/** Puts a mail on its deal when its conversation already has a parent. */
async function recordReplyIfKnown(
  svc: Svc,
  mailId: string,
  conversationId: string | null,
): Promise<"recorded" | "none" | "failed"> {
  if (!conversationId) return "none";
  const { data: parent, error: parentErr } = await svc.from("info_mail").select("id")
    .eq("conversation_id", conversationId)
    .neq("id", mailId)
    .or("inbox_item_id.not.is.null,opportunity_id.not.is.null")
    .order("received_at", { ascending: true }).limit(1).maybeSingle();
  if (parentErr) return "failed";
  if (!parent) return "none";
  const { error } = await svc.rpc("info_mail_record_reply", { _mail_id: mailId, _parent_id: parent.id });
  return error ? "failed" : "recorded";
}

async function saveState(svc: Svc, deltaLink: string | null, error: string | null, keepLink: boolean) {
  const patch: Record<string, unknown> = { last_run_at: new Date().toISOString(), last_error: error?.slice(0, 500) ?? null };
  if (!keepLink) patch.delta_link = deltaLink;
  await svc.from("info_mailbox_state").update(patch).eq("id", true);
}
