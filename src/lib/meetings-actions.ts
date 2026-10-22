// Fireflies meetings: reads go straight to the tables (RLS limits them to
// reviewers and the people in each meeting); decisions, the deal link and the
// Fireflies key go through sales-os-api so the MFA gate applies and the key
// never comes back to the browser.
import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";

export type MeetingRow = {
  id: string;
  title: string;
  occurred_at: string | null;
  duration_minutes: number | null;
  status: "pending_review" | "reviewed";
  provider_meeting_id: string;
  meeting_action_items: { status: string; created_at: string; decided_at: string | null; decided_by: string | null }[];
};

type DealRef = { id: string; project_name: string | null };

export type MeetingDetail = {
  id: string;
  title: string;
  occurred_at: string | null;
  duration_minutes: number | null;
  status: "pending_review" | "reviewed";
  provider_meeting_id: string;
  summary_short: string | null;
  summary_overview: string | null;
  keywords: string[];
  transcript_url: string | null;
  organizer_email: string | null;
  related_opportunity_id: string | null;
  suggested_opportunity_id: string | null;
  related: DealRef | null;
  suggested: DealRef | null;
};

/** What the caller may do on one meeting (meeting_review_rights). */
export type ReviewRights = { manager: boolean; organizer: boolean; attendee: boolean; decidable: string[] };

export type MeetingItem = {
  id: string;
  position: number;
  speaker_label: string | null;
  title: string;
  at_seconds: number | null;
  suggested_owner_id: string | null;
  owner_id: string | null;
  related_opportunity_id: string | null;
  due_date: string | null;
  status: "pending" | "approved" | "dismissed";
  task_id: string | null;
  decision_note: string | null;
  expires_at: string;
  opportunities: DealRef | null;
};

export async function listMeetings(): Promise<MeetingRow[]> {
  const { data, error } = await supabase
    .from("meetings")
    .select("id, title, occurred_at, duration_minutes, status, provider_meeting_id, meeting_action_items(status, created_at, decided_at, decided_by)")
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as MeetingRow[];
}

const NO_RIGHTS: ReviewRights = { manager: false, organizer: false, attendee: false, decidable: [] };

export async function getMeeting(id: string): Promise<{ meeting: MeetingDetail; items: MeetingItem[]; rights: ReviewRights }> {
  const [m, i, r] = await Promise.all([
    supabase
      .from("meetings")
      .select(
        "id, title, occurred_at, duration_minutes, status, provider_meeting_id, summary_short, summary_overview, keywords, transcript_url, organizer_email, related_opportunity_id, suggested_opportunity_id, related:opportunities!meetings_related_opportunity_id_fkey(id, project_name), suggested:opportunities!meetings_suggested_opportunity_id_fkey(id, project_name)",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("meeting_action_items")
      .select("id, position, speaker_label, title, at_seconds, suggested_owner_id, owner_id, related_opportunity_id, due_date, status, task_id, decision_note, expires_at, opportunities(id, project_name)")
      .eq("meeting_id", id)
      .order("position"),
    supabase.rpc("meeting_review_rights", { _meeting_id: id }),
  ]);
  if (m.error) throw m.error;
  if (i.error) throw i.error;
  if (r.error) throw r.error;
  const rights = (r.data as ReviewRights | null) ?? NO_RIGHTS;
  return { meeting: m.data as unknown as MeetingDetail, items: (i.data ?? []) as MeetingItem[], rights };
}

/** Meeting items waiting for the caller: the Work Queue and My Day item. */
export type ReviewQueue = { pending: number; over_7_days: number; meetings: number; oldest_meeting_id: string | null };

export async function meetingReviewQueue(): Promise<ReviewQueue> {
  const { data, error } = await supabase.rpc("meeting_review_queue");
  if (error) throw error;
  const q = (data ?? {}) as Partial<ReviewQueue>;
  return {
    pending: Number(q.pending ?? 0),
    over_7_days: Number(q.over_7_days ?? 0),
    meetings: Number(q.meetings ?? 0),
    oldest_meeting_id: typeof q.oldest_meeting_id === "string" ? q.oldest_meeting_id : null,
  };
}

/** Confirm, change or clear (null) the deal a meeting is about. */
export function confirmMeetingDeal(meetingId: string, opportunityId: string | null) {
  return callBackend<{ ok: boolean; opportunity_id: string | null }>("meeting_confirm_deal", { meetingId, opportunityId });
}

/** The caller's own Fireflies account, as Settings shows it — never the key. */
export type FirefliesConnection = {
  email: string;
  status: "active" | "needs_reconnect";
  connected_at: string;
  last_synced_at: string | null;
  last_error: string | null;
};

export async function getFirefliesConnection(): Promise<FirefliesConnection | null> {
  const { data, error } = await supabase.rpc("my_fireflies_connection");
  if (error) throw error;
  return (data as FirefliesConnection | null) ?? null;
}

/** The key goes to the backend once; it checks it with Fireflies and keeps it in Vault. */
export function connectFireflies(apiKey: string) {
  return callBackend<{ ok: boolean; email: string; pulled: boolean; added?: number }>("fireflies_connect", { apiKey });
}

export function disconnectFireflies() {
  return callBackend<{ ok: boolean; disconnected: boolean }>("fireflies_disconnect", {});
}

export async function searchOpportunities(q: string): Promise<{ id: string; project_name: string | null }[]> {
  const term = q.trim().replace(/[%,()]/g, " ");
  if (term.length < 2) return [];
  const { data, error } = await supabase
    .from("opportunities")
    .select("id, project_name")
    .ilike("project_name", `%${term}%`)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

export type MeetingDecision =
  | { itemId: string; action: "approve"; title: string; ownerId: string; dueDate: string | null; opportunityId: string | null }
  | { itemId: string; action: "dismiss"; note: string };

export function decideMeetingAction(d: MeetingDecision) {
  return callBackend<{ ok: boolean; status: string; task_id: string | null }>("meeting_action_decision", d);
}

/** Pull the last two weeks of processed Fireflies meetings (company account and/or your own) and store the ones we lack. */
export function syncMeetings() {
  return callBackend<{ ok: boolean; found: number; added: number; already: number }>("meetings_sync", {});
}

/** The Fireflies page for a meeting, optionally at a moment in the recording. */
export function firefliesLink(providerMeetingId: string, atSeconds?: number | null): string {
  const base = `https://app.fireflies.ai/view/${encodeURIComponent(providerMeetingId)}`;
  return atSeconds != null ? `${base}?t=${atSeconds}` : base;
}

export function formatStamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
