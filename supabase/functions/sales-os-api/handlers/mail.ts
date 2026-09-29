// =============================================================================
// Email from inside the system — the one place that talks to the provider.
//
// See ../../_shared/mail.ts for the rules on senders and replies, and
// docs/implementation/outlook-integration.md for why this is Postmark rather
// than Microsoft Graph.
//
// TWO PROVIDERS, ONE PATH
//
// A salesperson who connected their Outlook (see ./outlook.ts) sends through
// Microsoft Graph from their own mailbox, so the email sits in their Sent
// folder. Anyone else sends through Postmark. Both go through every step below;
// only step 5 differs. A connection that has expired is refused with 409 and
// never silently rerouted: the sender must know which mailbox the email left.
//
// ORDER IS THE WHOLE DESIGN OF send_email
//
// Sending cannot be undone. Everything that can refuse therefore runs BEFORE the
// provider call, and everything after it only records a fact:
//
//   1. configured?              503 — no provider, nothing to send through
//   2. a sales contributor?     403 — asked of the database, not a copied list
//   3. may they see the deal?   404 — through RLS, as themselves
//   4. a valid message?         400 — sender, recipients, subject, body
//   5. SEND                     502 on provider failure; nothing recorded
//   6. record it                as the service role, because the email has
//                               left: failing to log a real send would be a lie
//
// Step 2 exists because of a hazard found while building this: the activities
// INSERT policy only admits sales contributors. Sending first and logging second
// would have delivered a non-contributor's email and then refused to record it.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err } from "../shared.ts";
import {
  composeOutbound,
  hashThreadToken,
  newThreadToken,
  readMailConfig,
  type ComposeRefusal,
} from "../../_shared/mail.ts";
import { readGraphConfig, toGraphMessage } from "../../_shared/graph.ts";
import { refreshAccess, sendAsMe } from "../../_shared/graph-client.ts";

const POSTMARK_URL = "https://api.postmarkapp.com/email";

const REFUSAL_MESSAGE: Record<ComposeRefusal, string> = {
  not_configured: "Email sending is not configured",
  sender_missing: "Your profile has no email address to send from",
  sender_off_domain: "You can only send from your company email address",
  no_recipient: "Add at least one recipient",
  invalid_recipient: "One of the recipient addresses is not valid",
  too_many_recipients: "Too many recipients",
  subject_missing: "Add a subject",
  subject_too_long: "The subject is too long",
  body_missing: "The message is empty",
  body_too_long: "The message is too long",
};

const env = (k: string) => Deno.env.get(k);

const RECONNECT = "Your Outlook connection has expired. Reconnect it in Settings, then send again.";

type Connection = { email: string; status: "active" | "needs_reconnect" };

async function readConnection(ctx: SalesOsContext): Promise<Connection | null> {
  if (!readGraphConfig(env).configured) return null;
  const { data } = await ctx.svc
    .from("mail_connections")
    .select("email, status")
    .eq("user_id", ctx.caller.userId)
    .maybeSingle();
  return (data as Connection | null) ?? null;
}

/** What the UI needs to decide whether to offer Send. Never a token. */
async function mail_status(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const cfg = readMailConfig(env);
  const graphReady = readGraphConfig(env).configured;
  let contributor = false;
  if (graphReady) {
    const { data } = await ctx.asCaller.rpc("is_sales_contributor", { _user_id: ctx.caller.userId });
    contributor = data === true;
  }
  const conn = graphReady ? await readConnection(ctx) : null;
  return json({
    ok: true,
    sending: cfg.sending,
    capture: cfg.capture,
    outlook: {
      available: graphReady && contributor,
      connected: conn?.status === "active",
      status: conn?.status ?? null,
      email: conn?.email ?? null,
    },
  });
}

async function send_email(payload: Record<string, unknown>, ctx: SalesOsContext) {
  // 1 ─ configured: the caller's Outlook, or Postmark
  const cfg = readMailConfig(env);
  const token = (env("POSTMARK_SERVER_TOKEN") ?? "").trim();
  const conn = await readConnection(ctx);
  const viaOutlook = conn !== null;
  if (!viaOutlook && (!cfg.sending || !token)) return err(REFUSAL_MESSAGE.not_configured, 503);

  // 2 ─ the same test the activities INSERT policy applies, asked as the caller
  const { data: contributor, error: roleErr } = await ctx.asCaller.rpc("is_sales_contributor", {
    _user_id: ctx.caller.userId,
  });
  if (roleErr) return err("Could not verify your permissions", 500);
  if (contributor !== true) return err("Your role cannot send email from the system", 403);

  // 3 ─ the linked records, seen through the caller's own RLS
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const opportunityId = str(payload.opportunityId);

  if (opportunityId) {
    const { data: opp } = await ctx.asCaller.from("opportunities").select("id").eq("id", opportunityId).maybeSingle();
    if (!opp) return err("Opportunity not found", 404);
  }

  // The other links are hints from the page, and each is a foreign key on the
  // activity row. One that does not resolve — an opportunity page once passed a
  // stakeholder id as the contact — made the insert fail AFTER the email had
  // left, losing its record. So an id the caller cannot see in its own table is
  // dropped here, before sending, and the email is still logged on the deal.
  const resolve = async (table: string, id: string | null) => {
    if (!id) return null;
    const { data } = await ctx.asCaller.from(table).select("id").eq("id", id).maybeSingle();
    return data ? id : null;
  };
  const [companyId, contactId, rfqId, tenderId, templateId] = await Promise.all([
    resolve("companies", str(payload.companyId)),
    resolve("contacts", str(payload.contactId)),
    resolve("rfqs", str(payload.rfqId)),
    resolve("tenders", str(payload.tenderId)),
    resolve("communication_templates", str(payload.templateId)),
  ]);

  // The sender is the caller's own profile — never a field in the payload.
  const { data: profile } = await ctx.asCaller
    .from("profiles")
    .select("email, full_name")
    .eq("id", ctx.caller.userId)
    .maybeSingle();

  // 4 ─ compose and validate. Through Outlook the mailbox is the sender, so
  // no Reply-To token: a reply binds by Graph conversation id instead.
  const profileEmail = String(profile?.email ?? "").trim().toLowerCase();
  if (viaOutlook && (conn.status !== "active" || conn.email !== profileEmail)) return err(RECONNECT, 409);
  const threadToken = !viaOutlook && cfg.capture ? newThreadToken() : null;
  const composed = composeOutbound(
    {
      callerEmail: profile?.email,
      callerName: profile?.full_name,
      to: payload.to,
      cc: payload.cc,
      subject: payload.subject,
      body: payload.body,
    },
    viaOutlook
      ? { sending: true, capture: false, fromDomain: profileEmail.split("@")[1] ?? null, captureDomain: null }
      : cfg,
    threadToken,
  );
  if (!composed.ok) return err(REFUSAL_MESSAGE[composed.reason], 400, { reason: composed.reason });

  // 5 ─ SEND. The only network call to a provider anywhere in the system.
  let messageId: string | null;
  let conversationId: string | null = null;
  if (viaOutlook) {
    const graph = readGraphConfig(env);
    const { data: refresh } = await ctx.svc.rpc("mail_refresh_token", { _user: ctx.caller.userId });
    if (typeof refresh !== "string" || !refresh) return err(RECONNECT, 409);
    const tok = await refreshAccess(graph, refresh);
    if (!tok.ok) {
      if (tok.reason === "invalid_grant") {
        await ctx.svc.rpc("mark_mail_connection", { _user: ctx.caller.userId, _status: "needs_reconnect", _error: "refresh token rejected" });
        return err(RECONNECT, 409);
      }
      return err("Outlook could not be reached", 502);
    }
    if (tok.refresh) await ctx.svc.rpc("rotate_mail_refresh_token", { _user: ctx.caller.userId, _refresh_token: tok.refresh });
    else await ctx.svc.rpc("mark_mail_connection", { _user: ctx.caller.userId, _status: "active", _error: null });
    const sent = await sendAsMe(tok.access, toGraphMessage(composed));
    if (!sent.ok) return err(`The email could not be sent: ${sent.error}`, 502);
    messageId = sent.messageId;
    conversationId = sent.conversationId;
  } else try {
    const res = await fetch(POSTMARK_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify(composed.postmark),
    });
    const body = await res.json().catch(() => ({})) as { MessageID?: string; ErrorCode?: number; Message?: string };
    if (!res.ok || (body.ErrorCode ?? 0) !== 0) {
      // Postmark's own message, without echoing anything we sent.
      return err(`The email could not be sent: ${String(body.Message ?? res.statusText).slice(0, 200)}`, 502);
    }
    messageId = body.MessageID ?? null;
  } catch {
    return err("The email service could not be reached", 502);
  }

  // 6 ─ record the fact
  const now = new Date().toISOString();
  const { data: activity, error: actErr } = await ctx.svc
    .from("activities")
    .insert({
      activity_type: "email_draft",
      status: "sent",
      summary: composed.postmark.Subject,
      draft_content: composed.postmark.TextBody,
      related_opportunity_id: opportunityId,
      company_id: companyId,
      contact_id: contactId,
      related_rfq_id: rfqId,
      related_tender_id: tenderId,
      template_id: templateId,
      occurred_at: now,
      sent_at: now,
      sent_by: ctx.caller.userId,
      owner_id: ctx.caller.userId,
      created_by: ctx.caller.userId,
      provider_message_id: messageId,
      email_from: composed.from,
      email_to: composed.to.join(", "),
      email_cc: composed.cc.length ? composed.cc.join(", ") : null,
    })
    .select("id")
    .single();

  if (viaOutlook && conversationId && activity?.id) {
    await ctx.svc.from("email_threads").insert({
      graph_conversation_id: conversationId,
      opportunity_id: opportunityId,
      company_id: companyId,
      contact_id: contactId,
      activity_id: activity.id,
      owner_id: ctx.caller.userId,
    });
  }

  if (threadToken && activity?.id) {
    await ctx.svc.from("email_threads").insert({
      token_hash: await hashThreadToken(threadToken),
      opportunity_id: opportunityId,
      company_id: companyId,
      contact_id: contactId,
      activity_id: activity.id,
      owner_id: ctx.caller.userId,
    });
  }

  await ctx.audit(
    ctx.svc,
    ctx.caller.userId,
    "email.sent",
    opportunityId ? "opportunity" : "activity",
    opportunityId ?? activity?.id ?? null,
    // Who and where, never what: the body stays on the activity row.
    { to_count: composed.to.length, cc_count: composed.cc.length, provider_message_id: messageId, logged: !actErr, via: viaOutlook ? "outlook" : "postmark" },
    ctx.caller.roles,
  );

  // The email left even if the log write failed; say so rather than pretend.
  if (actErr) {
    return json({ ok: true, sent: true, logged: false, message_id: messageId, via: viaOutlook ? "outlook" : "postmark" });
  }
  return json({ ok: true, sent: true, logged: true, activity_id: activity.id, message_id: messageId, via: viaOutlook ? "outlook" : "postmark" });
}

export const mailModule: HandlerModule = {
  name: "mail",
  handlers: { mail_status, send_email },
};
