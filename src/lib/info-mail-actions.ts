// The info@ mailbox from the browser: read through RLS, act through the backend
// (forward, mark as RFQ) or one RPC (dismiss). Never Graph directly.
import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";

export type InfoMailRow = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string;
  category: string;
  summary: string | null;
  status: string;
  web_link: string | null;
  attachment_names: string[];
};
const COLS = "id, from_email, from_name, subject, received_at, category, summary, status, web_link, attachment_names";

/** Messages waiting for a router: not an item, not a reply, not yet handled. */
export async function listOpenInfoMail(): Promise<InfoMailRow[]> {
  const { data, error } = await supabase.from("info_mail").select(COLS)
    .eq("status", "new").is("inbox_item_id", null).neq("category", "client_reply")
    .order("received_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as InfoMailRow[];
}

export async function forwardInfoMail(id: string, toUserId: string): Promise<void> {
  await callBackend("info_mail_forward", { id, toUserId });
}

export async function markInfoMailRfq(id: string): Promise<string> {
  const r = await callBackend<{ inboxItemId?: string }>("info_mail_mark_rfq", { id });
  if (!r?.inboxItemId) throw new Error("The request could not be created");
  return r.inboxItemId;
}

export async function dismissInfoMail(id: string): Promise<void> {
  const { error } = await supabase.rpc("info_mail_dismiss", { _id: id });
  if (error) throw error;
}

/** The email a deal came from (the first request in its info@ conversation), if any. */
export async function sourceEmailFor(opportunityId: string): Promise<(InfoMailRow & { body_text: string | null }) | null> {
  const { data, error } = await supabase.from("info_mail").select(`${COLS}, body_text`)
    .eq("opportunity_id", opportunityId).in("category", ["rfq", "quotation_request"])
    .order("received_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  return (data ?? null) as (InfoMailRow & { body_text: string | null }) | null;
}

export type Colleague = { id: string; full_name: string | null; email: string | null };

/** Active people on the company domain (not display accounts), by name. */
export async function listColleagues(): Promise<Colleague[]> {
  const { data, error } = await supabase.from("profiles")
    .select("id, full_name, email").eq("status", "active").eq("is_display_account", false).order("full_name");
  if (error) throw error;
  return (data ?? []).filter((p) => String(p.email ?? "").toLowerCase().endsWith("@phc-sa.com"));
}
