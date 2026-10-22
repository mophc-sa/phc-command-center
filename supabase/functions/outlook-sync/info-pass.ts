// supabase/functions/outlook-sync/info-pass.ts
// =============================================================================
// The info@phc-sa.com pass (manager feedback 2026-10-19, group 3 part B).
//
// Every five minutes (cron job info-mailbox-sync): read new inbox mail with an
// app-only token Exchange limits to info@, store each message, put a reply in a
// known conversation on its deal, and ask the orchestrator to classify the rest.
// What a classification does — an intake item, an owner, a notification — is
// decided in SQL (info_mail_apply_triage), not here.
// =============================================================================

import type { serviceClient } from "../_shared/supabase.ts";
import type { readGraphConfig } from "../_shared/graph.ts";
import { appAccess, deltaPage, getMailboxMessage, mailboxDeltaUrl } from "../_shared/graph-client.ts";
import { capBody, isAutoReply, isInternalSender, toInfoMessage } from "../_shared/info-mail.ts";

type Svc = ReturnType<typeof serviceClient>;
type Cfg = ReturnType<typeof readGraphConfig>;

const FIRST_READ_DAYS = 7;
const MAX_PAGES = 10;
const TRIAGE_PER_RUN = 8;
const PRIVATE = new Set(["1", "2"]); // PR_SENSITIVITY: personal, private

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ fn: "outlook-sync", pass: "info", ...o }));

export async function syncInfoMailbox(
  svc: Svc,
  cfg: Cfg,
  opts: { mailbox: string; syncKey: string; started: number; budgetMs: number },
): Promise<{ stored: number; triaged: number; error: string | null }> {
  const inBudget = () => Date.now() - opts.started < opts.budgetMs;
  const tok = await appAccess(cfg);
  if (!tok.ok) {
    await saveState(svc, null, "token refused", true);
    log({ outcome: "token_failed" });
    return { stored: 0, triaged: 0, error: "token" };
  }

  // 1. Read new mail.
  const { data: state } = await svc.from("info_mailbox_state").select("delta_link").eq("id", true).maybeSingle();
  const since = new Date(Date.now() - FIRST_READ_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  let url = (state?.delta_link as string | null) ?? mailboxDeltaUrl(opts.mailbox, since);
  let resume: string | null = (state?.delta_link as string | null) ?? null;
  let error: string | null = null;
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
  let complete = true;
  for (const raw of batch) {
    if (!inBudget()) { complete = false; break; }
    const m = toInfoMessage(raw);
    if (!m || isInternalSender(m)) continue;
    const { data: seen } = await svc.from("info_mail").select("id").eq("graph_message_id", m.graphId).maybeSingle();
    if (seen) continue;
    const detail = await getMailboxMessage(tok.access, opts.mailbox, m.graphId, m.hasAttachments);
    if (!detail) { complete = false; break; } // try the whole round again next time
    if (PRIVATE.has(detail.sensitivity ?? "") || isAutoReply(detail.headers)) continue;

    const { data: row, error: insErr } = await svc.from("info_mail").insert({
      graph_message_id: m.graphId,
      internet_message_id: m.internetMessageId,
      conversation_id: m.conversationId,
      from_email: m.fromEmail,
      from_name: m.fromName,
      subject: m.subject,
      received_at: m.receivedAt,
      body_text: capBody(detail.body),
      attachment_names: detail.attachmentNames,
      web_link: m.webLink,
    }).select("id").single();
    if (insErr) {
      if (insErr.code === "23505") continue;
      complete = false;
      error = "store failed";
      break;
    }
    stored++;

    // A later message in a conversation that already became an item or a deal.
    if (m.conversationId) {
      const { data: parent } = await svc.from("info_mail").select("id")
        .eq("conversation_id", m.conversationId)
        .neq("id", row.id)
        .or("inbox_item_id.not.is.null,opportunity_id.not.is.null")
        .order("received_at", { ascending: true }).limit(1).maybeSingle();
      if (parent) await svc.rpc("info_mail_record_reply", { _mail_id: row.id, _parent_id: parent.id });
    }
  }
  await saveState(svc, complete ? resume : (state?.delta_link as string | null) ?? null, error, false);

  // 3. Classify what is waiting, oldest first, while there is time.
  let triaged = 0;
  const { data: waiting } = await svc.from("info_mail").select("id, triage_attempts")
    .eq("category", "unclassified").lt("triage_attempts", 3)
    .order("received_at", { ascending: true }).limit(TRIAGE_PER_RUN);
  for (const w of waiting ?? []) {
    if (!inBudget()) break;
    const verdict = await classify(w.id as string, Number(w.triage_attempts), opts.syncKey);
    if (!verdict) {
      await svc.rpc("info_mail_triage_failed", { _mail_id: w.id });
      continue;
    }
    await svc.rpc("info_mail_apply_triage", {
      _mail_id: w.id,
      _category: verdict.category,
      _confidence: verdict.confidence,
      _summary: `${verdict.summary_en}\n${verdict.summary_ar}`,
      _fields: verdict.request,
    });
    triaged++;
  }
  log({ outcome: error ? "partial" : "done", stored, triaged, read: batch.length });
  return { stored, triaged, error };
}

type Verdict = {
  category: string;
  confidence: number;
  summary_en: string;
  summary_ar: string;
  request: Record<string, unknown> | null;
};

async function classify(mailId: string, attempt: number, syncKey: string): Promise<Verdict | null> {
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
    });
    const j = await res.json().catch(() => null) as { ok?: boolean; result?: Verdict } | null;
    return j?.ok && j.result ? j.result : null;
  } catch {
    return null;
  }
}

async function saveState(svc: Svc, deltaLink: string | null, error: string | null, keepLink: boolean) {
  const patch: Record<string, unknown> = { last_run_at: new Date().toISOString(), last_error: error?.slice(0, 500) ?? null };
  if (!keepLink) patch.delta_link = deltaLink;
  await svc.from("info_mailbox_state").update(patch).eq("id", true);
}
