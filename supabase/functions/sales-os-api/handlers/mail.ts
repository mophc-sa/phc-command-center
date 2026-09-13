// =============================================================================
// Email from inside the system — the one place that talks to the provider.
//
// See ../../_shared/mail.ts for the rules on senders and replies, and
// docs/implementation/outlook-integration.md for why this is Postmark rather
// than Microsoft Graph.
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

/** What the UI needs to decide whether to offer Send. Never the token. */
async function mail_status(_payload: Record<string, unknown>, _ctx: SalesOsContext) {
  const cfg = readMailConfig(env);
  return json({ ok: true, sending: cfg.sending, capture: cfg.capture });
}

async function send_email(payload: Record<string, unknown>, ctx: SalesOsContext) {
  // 1 ─ configured
  const cfg = readMailConfig(env);
  const token = (env("POSTMARK_SERVER_TOKEN") ?? "").trim();
  if (!cfg.sending || !token) return err(REFUSAL_MESSAGE.not_configured, 503);

  // 2 ─ the same test the activities INSERT policy applies, asked as the caller
  const { data: contributor, error: roleErr } = await ctx.asCaller.rpc("is_sales_contributor", {
    _user_id: ctx.caller.userId,
  });
  if (roleErr) return err("Could not verify your permissions", 500);
  if (contributor !== true) return err("Your role cannot send email from the system", 403);

  // 3 ─ the linked records, seen through the caller's own RLS
  const opportunityId = typeof payload.opportunityId === "string" ? payload.opportunityId : null;
  const companyId = typeof payload.companyId === "string" ? payload.companyId : null;
  const contactId = typeof payload.contactId === "string" ? payload.contactId : null;
  const rfqId = typeof payload.rfqId === "string" ? payload.rfqId : null;
  const tenderId = typeof payload.tenderId === "string" ? payload.tenderId : null;
  const templateId = typeof payload.templateId === "string" ? payload.templateId : null;

  if (opportunityId) {
    const { data: opp } = await ctx.asCaller.from("opportunities").select("id").eq("id", opportunityId).maybeSingle();
    if (!opp) return err("Opportunity not found", 404);
  }

  // The sender is the caller's own profile — never a field in the payload.
  const { data: profile } = await ctx.asCaller
    .from("profiles")
    .select("email, full_name")
    .eq("id", ctx.caller.userId)
    .maybeSingle();

  // 4 ─ compose and validate
  const threadToken = cfg.capture ? newThreadToken() : null;
  const composed = composeOutbound(
    {
      callerEmail: profile?.email,
      callerName: profile?.full_name,
      to: payload.to,
      cc: payload.cc,
      subject: payload.subject,
      body: payload.body,
    },
    cfg,
    threadToken,
  );
  if (!composed.ok) return err(REFUSAL_MESSAGE[composed.reason], 400, { reason: composed.reason });

  // 5 ─ SEND. The only network call to the provider anywhere in the system.
  let messageId: string | null;
  try {
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
    { to_count: composed.to.length, cc_count: composed.cc.length, provider_message_id: messageId, logged: !actErr },
    ctx.caller.roles,
  );

  // The email left even if the log write failed; say so rather than pretend.
  if (actErr) {
    return json({ ok: true, sent: true, logged: false, message_id: messageId });
  }
  return json({ ok: true, sent: true, logged: true, activity_id: activity.id, message_id: messageId });
}

export const mailModule: HandlerModule = {
  name: "mail",
  handlers: { mail_status, send_email },
};
