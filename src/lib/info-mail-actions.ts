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
  /** 3 or more with category "unclassified": the sorter gave up, route by hand. */
  triage_attempts: number;
};
const COLS = "id, from_email, from_name, subject, received_at, category, summary, status, web_link, attachment_names, triage_attempts";

/** Messages waiting for a router, newest 200: not an item, not a reply, not spam, not yet handled. */
export async function listOpenInfoMail(): Promise<InfoMailRow[]> {
  const { data, error } = await supabase.from("info_mail").select(COLS)
    .eq("status", "new").is("inbox_item_id", null).neq("category", "client_reply").neq("category", "spam")
    .order("received_at", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as InfoMailRow[];
}

/** How many newsletters and spam are waiting to be dismissed (same rows as dismissOpenSpam). */
export async function countOpenInfoSpam(): Promise<number> {
  const { count, error } = await supabase.from("info_mail").select("id", { count: "exact", head: true })
    .eq("status", "new").eq("category", "spam").is("inbox_item_id", null).is("handled_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** Dismiss every open newsletter/spam row in one step. Returns how many were dismissed. */
export async function dismissOpenInfoSpam(): Promise<number> {
  const { data, error } = await supabase.rpc("info_mail_dismiss_spam" as never, {} as never);
  if (error) throw error;
  return typeof data === "number" ? data : 0;
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

/** People who can open this deal, so a mention always reaches someone who can follow it. */
export async function mentionableColleagues(opportunityId: string): Promise<Colleague[]> {
  const { data, error } = await supabase.rpc("mentionable_colleagues" as never, { _opportunity_id: opportunityId } as never);
  if (error) throw error;
  return ((data ?? []) as Colleague[]);
}
