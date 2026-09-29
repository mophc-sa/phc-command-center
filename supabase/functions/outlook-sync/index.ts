// =============================================================================
// outlook-sync — every five minutes, bring connected salespeople's client email
// into the system.
//
// Called by pg_cron through pg_net, never by a browser, so it is deployed with
// verify_jwt = false (see supabase/config.toml). It authenticates the call by a
// key that lives only in Vault: the cron job reads it when it runs, and this
// function compares it through outlook_sync_key_matches (service role only).
//
// For each active connection: refresh the token, then for Inbox and Sent Items
// follow the Graph delta round from where it stopped (or from 30 days before
// the connection), keep only mail about a known client, and bind it to a deal.
// Rules: ../_shared/mail-capture.ts. Graph calls: ../_shared/graph-client.ts.
//
// Logs carry counts and outcome codes only — never an address, subject or body.
// =============================================================================

import { serviceClient } from "../_shared/supabase.ts";
import { readGraphConfig } from "../_shared/graph.ts";
import { deltaPage, getMessageDetail, initialDeltaUrl, refreshAccess } from "../_shared/graph-client.ts";
import {
  domainOf,
  externalAddresses,
  extractProjectCodes,
  type Folder,
  type GraphMail,
  pickOne,
  shouldSkip,
  toActivityRow,
} from "../_shared/mail-capture.ts";

const FOLDERS: Folder[] = ["inbox", "sentitems"];
const MAX_PAGES = 10;
const BACKFILL_DAYS = 30;
const TIME_BUDGET_MS = 45_000;

type Svc = ReturnType<typeof serviceClient>;
const text = (status: number, body = "") => new Response(body, { status, headers: { "Content-Type": "text/plain" } });
const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ fn: "outlook-sync", ...o }));
const chunks = <T,>(xs: T[], n = 50): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function handleSync(req: Request): Promise<Response> {
  if (req.method !== "POST") return text(405, "method not allowed");
  const svc = serviceClient();
  const key = req.headers.get("x-phc-sync-key") ?? "";
  const { data: ok } = await svc.rpc("outlook_sync_key_matches", { _key: key });
  if (ok !== true) return text(403, "forbidden");

  const cfg = readGraphConfig((k) => Deno.env.get(k));
  if (!cfg.configured) return text(503, "not configured");

  const started = Date.now();
  const { data: conns } = await svc.from("mail_connections").select("user_id, connected_at").eq("status", "active");
  let stored = 0;
  for (const c of conns ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    stored += await syncMailbox(svc, cfg, c.user_id, c.connected_at, started);
  }
  log({ outcome: "done", mailboxes: (conns ?? []).length, stored });
  return text(200, "ok");
}

async function syncMailbox(svc: Svc, cfg: ReturnType<typeof readGraphConfig>, userId: string, connectedAt: string, started: number) {
  const { data: refresh } = await svc.rpc("mail_refresh_token", { _user: userId });
  if (typeof refresh !== "string" || !refresh) return 0;
  const tok = await refreshAccess(cfg, refresh);
  if (!tok.ok) {
    if (tok.reason === "invalid_grant") {
      await svc.rpc("mark_mail_connection", { _user: userId, _status: "needs_reconnect", _error: "refresh token rejected" });
    }
    log({ outcome: "token_failed", reason: tok.reason });
    return 0;
  }
  if (tok.refresh) await svc.rpc("rotate_mail_refresh_token", { _user: userId, _refresh_token: tok.refresh });

  const since = new Date(Date.parse(connectedAt) - BACKFILL_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  let stored = 0;
  for (const folder of FOLDERS) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const { data: state } = await svc.from("mail_sync_state").select("delta_link").eq("user_id", userId).eq("folder", folder).maybeSingle();
    let url = state?.delta_link ?? initialDeltaUrl(folder, since);
    let resume: string | null = null;
    const batch: GraphMail[] = [];
    let error: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await deltaPage(tok.access, url);
      if (!r.ok) {
        error = r.gone ? "delta expired; restarting" : `graph ${r.status}${r.error ? ` ${r.error}` : ""}`;
        resume = r.gone ? null : state?.delta_link ?? null;
        break;
      }
      batch.push(...(r.messages as GraphMail[]));
      if (r.deltaLink) { resume = r.deltaLink; break; }
      if (!r.next) break;
      url = r.next;
      resume = r.next; // a page cap mid-round resumes here next run
    }
    const result = await storeBatch(svc, tok.access, userId, folder, batch, started);
    stored += result.stored;
    // Out of time mid-batch: keep the old position. The next run repeats the
    // round, skips what is already stored, and gets further.
    if (!result.complete) resume = state?.delta_link ?? null;
    await svc.from("mail_sync_state").upsert(
      { user_id: userId, folder, delta_link: resume, last_run_at: new Date().toISOString(), last_error: error },
      { onConflict: "user_id,folder" },
    );
    if (!result.complete) break;
  }
  return stored;
}

async function storeBatch(
  svc: Svc, access: string, userId: string, folder: Folder, batch: GraphMail[], started: number,
): Promise<{ stored: number; complete: boolean }> {
  const mails = batch.filter((m) => shouldSkip(m) === null);
  if (mails.length === 0) return { stored: 0, complete: true };

  // Who is a known client — a few chunked lookups for the whole batch.
  const externals = [...new Set(mails.flatMap(externalAddresses))];
  if (externals.length === 0) return { stored: 0, complete: true };
  const domains = [...new Set(externals.map(domainOf))];
  const contacts: Array<{ id: string; email: string | null; company_id: string | null }> = [];
  const companies: Array<{ id: string; website_domain: string | null }> = [];
  for (const part of chunks(externals)) {
    const { data } = await svc.from("contacts").select("id, email, company_id").is("archived_at", null)
      .or(part.map((e) => `email.ilike.${e}`).join(","));
    contacts.push(...(data ?? []));
  }
  for (const part of chunks(domains)) {
    const { data } = await svc.from("companies").select("id, website_domain").is("archived_at", null).in("website_domain", part);
    companies.push(...(data ?? []));
  }
  const contactByEmail = new Map<string, { id: string; company_id: string | null }>();
  for (const c of contacts) {
    const e = String(c.email ?? "").trim().toLowerCase();
    if (externals.includes(e) && !contactByEmail.has(e)) contactByEmail.set(e, { id: c.id, company_id: c.company_id });
  }
  const companiesByDomain = new Map<string, string[]>();
  for (const co of companies) {
    const d = String(co.website_domain ?? "").toLowerCase();
    companiesByDomain.set(d, [...(companiesByDomain.get(d) ?? []), co.id]);
  }

  // Already stored (another mailbox, or the system's own send) — skip.
  const seen = new Set<string>();
  for (const part of chunks(mails.flatMap((m) => [`imid:${m.internetMessageId}`, m.id]))) {
    const { data } = await svc.from("activities").select("provider_message_id").in("provider_message_id", part);
    for (const a of data ?? []) seen.add(a.provider_message_id);
  }

  let stored = 0;
  for (const m of mails) {
    if (Date.now() - started > TIME_BUDGET_MS) return { stored, complete: false };
    if (seen.has(`imid:${m.internetMessageId}`) || seen.has(m.id)) continue;
    const ext = externalAddresses(m);
    const contactHit = ext.map((e) => contactByEmail.get(e)).find(Boolean) ?? null;
    const companyId = contactHit?.company_id ??
      pickOne(ext.flatMap((e) => companiesByDomain.get(domainOf(e)) ?? []));
    if (!contactHit && !companyId) continue; // not about a known client: never stored

    const detail = await getMessageDetail(access, m.id);
    // Could not read it (throttled, transient): stop here without moving the
    // position, so the next run retries it — never store without the privacy check.
    if (!detail) return { stored, complete: false };
    if (detail.sensitivity === "1" || detail.sensitivity === "2") continue; // personal / private: never stored
    const body = detail.body;
    const binding = await bindDeal(svc, userId, m, companyId, body);
    const row = toActivityRow(m, folder, userId, { contactId: contactHit?.id ?? null, companyId }, binding, body);
    const { error } = await svc.from("activities").insert(row);
    if (error) {
      if ((error as { code?: string }).code !== "23505") log({ outcome: "insert_failed" });
      continue;
    }
    stored++;
    seen.add(row.provider_message_id);
    if (binding.opportunityId && binding.rule !== "thread" && m.conversationId) {
      const { data: t } = await svc.from("email_threads").select("id")
        .eq("graph_conversation_id", m.conversationId).eq("owner_id", userId).maybeSingle();
      if (!t) {
        await svc.from("email_threads").insert({
          graph_conversation_id: m.conversationId, opportunity_id: binding.opportunityId,
          company_id: companyId, contact_id: contactHit?.id ?? null, owner_id: userId,
        });
      }
    }
  }
  return { stored, complete: true };
}

async function bindDeal(svc: Svc, userId: string, m: GraphMail, companyId: string | null, body: string | null) {
  // 1 — the conversation is already bound
  if (m.conversationId) {
    const { data: threads } = await svc.from("email_threads").select("opportunity_id, owner_id")
      .eq("graph_conversation_id", m.conversationId);
    const mine = (threads ?? []).filter((t) => t.owner_id === userId);
    const opp = pickOne((mine.length ? mine : threads ?? []).map((t) => t.opportunity_id));
    if (opp) return { opportunityId: opp, rule: "thread" as const };
  }
  // 2 — a project code that names exactly one deal
  const codes = extractProjectCodes(`${m.subject ?? ""}\n${body ?? ""}`);
  if (codes.length) {
    const { data: rfqs } = await svc.from("rfqs").select("opportunity_id").in("rfq_number", codes).is("archived_at", null);
    const opp = pickOne((rfqs ?? []).map((r) => r.opportunity_id));
    if (opp) return { opportunityId: opp, rule: "code" as const };
  }
  // 3 — the company's only open deal
  if (companyId) {
    const { data: opps } = await svc.from("opportunities").select("id, sales_stage, stage")
      .eq("company_id", companyId).limit(20);
    const open = (opps ?? []).filter((o) => !["won", "lost"].includes(String(o.sales_stage ?? "")) && o.stage !== "archived");
    if (open.length === 1) return { opportunityId: open[0].id as string, rule: "single_open_deal" as const };
  }
  return { opportunityId: null, rule: null };
}

Deno.serve(handleSync);
