// =============================================================================
// Routing info@ mail (group 3 part B). A router — is_pipeline_operator, checked
// as the caller — forwards a message to one colleague, or marks it as an RFQ.
// Both reach info@ with the app-only token Exchange limits to that mailbox.
// Nothing here runs without a person's click.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err } from "../shared.ts";
import { readGraphConfig } from "../../_shared/graph.ts";
import { appAccess, forwardMailboxMessage, getMailboxMessage } from "../../_shared/graph-client.ts";
import { capBody } from "../../_shared/info-mail.ts";

const env = (k: string) => Deno.env.get(k);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function routerGate(ctx: SalesOsContext) {
  const { data, error } = await ctx.asCaller.rpc("is_pipeline_operator", { _user_id: ctx.caller.userId });
  if (error) return err("Could not verify your permissions", 500);
  if (data !== true) return err("Only sales managers, BD and sales ops route info@ mail", 403);
  return null;
}

function mailbox() {
  return (env("INFO_MAILBOX") ?? "").trim().toLowerCase();
}

async function openMessage(ctx: SalesOsContext, id: string) {
  const { data } = await ctx.svc.from("info_mail")
    .select("id, graph_message_id, subject, status, inbox_item_id, category").eq("id", id).maybeSingle();
  return data as { id: string; graph_message_id: string; subject: string | null; status: string; inbox_item_id: string | null; category: string } | null;
}

async function info_mail_forward(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const id = String(payload.id ?? "");
  const toUserId = String(payload.toUserId ?? "");
  if (!UUID.test(id) || !UUID.test(toUserId)) return err("Choose a message and a colleague", 400);
  const denied = await routerGate(ctx);
  if (denied) return denied;
  const box = mailbox();
  const cfg = readGraphConfig(env);
  if (!box || !cfg.configured) return err("The info@ mailbox is not connected yet", 503);

  const m = await openMessage(ctx, id);
  if (!m || m.status !== "new" || m.inbox_item_id) return err("This message was already handled", 409);
  const { data: to } = await ctx.svc.from("profiles").select("email, status").eq("id", toUserId).maybeSingle();
  const address = String(to?.email ?? "").trim().toLowerCase();
  if (!to || to.status !== "active" || !address.endsWith("@phc-sa.com")) {
    return err("You can forward only to an active colleague", 400);
  }
  const { data: me } = await ctx.svc.from("profiles").select("full_name, email").eq("id", ctx.caller.userId).maybeSingle();
  // eslint-disable-next-line no-control-regex -- strip control characters from a display name
  const who = String(me?.full_name || me?.email || "a colleague").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, 100) || "a colleague";

  // Claim the row before Graph, so two clicks at once cannot both send. A claim
  // older than five minutes is stale (a crashed attempt) and may be taken again.
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: claimed } = await ctx.svc.from("info_mail")
    .update({ handled_by: ctx.caller.userId, handled_at: new Date().toISOString() })
    .eq("id", id).eq("status", "new").is("inbox_item_id", null)
    .or(`handled_at.is.null,handled_at.lt.${staleBefore}`).select("id");
  if (!claimed || claimed.length === 0) return err("This message was already handled", 409);
  const release = () => ctx.svc.from("info_mail").update({ handled_by: null, handled_at: null })
    .eq("id", id).eq("status", "new").eq("handled_by", ctx.caller.userId);

  const tok = await appAccess(cfg);
  if (!tok.ok) {
    await release();
    return err("The info@ mailbox could not be reached", 502);
  }
  const sent = await forwardMailboxMessage(tok.access, box, m.graph_message_id, address,
    `Routed to you by ${who} from info@ via PHC Command Center.`);
  if (!sent.ok) {
    await release();
    return err("Outlook refused the forward", 502);
  }

  // Graph accepted: from here a failure must never invite a second send.
  const record = () => ctx.svc.rpc("info_mail_record_forward", { _id: id, _to: toUserId, _by: ctx.caller.userId });
  let { error } = await record();
  if (error) {
    const again = await openMessage(ctx, id);
    if (again?.status === "forwarded") return json({ ok: true });
    ({ error } = await record());
  }
  if (error) return err("Forwarded, but not recorded. Do not forward it again.", 500);
  await ctx.audit(ctx.svc, ctx.caller.userId, "info_mail.forwarded", "info_mail", id, { to: toUserId }, ctx.caller.roles);
  return json({ ok: true });
}

async function info_mail_mark_rfq(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const id = String(payload.id ?? "");
  if (!UUID.test(id)) return err("Choose a message", 400);
  const denied = await routerGate(ctx);
  if (denied) return denied;
  const box = mailbox();
  const cfg = readGraphConfig(env);
  if (!box || !cfg.configured) return err("The info@ mailbox is not connected yet", 503);

  const m = await openMessage(ctx, id);
  if (!m || m.status !== "new" || m.inbox_item_id || m.category === "client_reply") {
    return err("This message was already handled", 409);
  }
  const tok = await appAccess(cfg);
  if (!tok.ok) return err("The info@ mailbox could not be reached", 502);
  const detail = await getMailboxMessage(tok.access, box, m.graph_message_id, false);
  if (!detail) return err("The message could not be read from Outlook", 502);

  const { data: item, error } = await ctx.svc.rpc("info_mail_promote", {
    _id: id, _by: ctx.caller.userId, _body: capBody(detail.body) ?? "",
  });
  if (error) {
    return error.code === "P0002"
      ? err("The request could not be created", 409)
      : err("The request could not be created", 500);
  }
  await ctx.audit(ctx.svc, ctx.caller.userId, "info_mail.marked_rfq", "info_mail", id, { inbox_item_id: item }, ctx.caller.roles);
  return json({ ok: true, inboxItemId: item });
}

export const infoMailModule: HandlerModule = {
  name: "info-mail",
  handlers: { info_mail_forward, info_mail_mark_rfq },
};
