// Fireflies meetings: reads go straight to the tables (RLS limits them to
// reviewers); the decision goes through sales-os-api so the MFA gate applies.
import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";

export type MeetingRow = {
  id: string;
  title: string;
  occurred_at: string | null;
  duration_minutes: number | null;
  status: "pending_review" | "reviewed";
  provider_meeting_id: string;
  meeting_action_items: { status: string }[];
};

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
};

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
  opportunities: { id: string; project_name: string | null } | null;
};

export async function listMeetings(): Promise<MeetingRow[]> {
  const { data, error } = await supabase
    .from("meetings")
    .select("id, title, occurred_at, duration_minutes, status, provider_meeting_id, meeting_action_items(status)")
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as MeetingRow[];
}

export async function getMeeting(id: string): Promise<{ meeting: MeetingDetail; items: MeetingItem[] }> {
  const [m, i] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, title, occurred_at, duration_minutes, status, provider_meeting_id, summary_short, summary_overview, keywords, transcript_url")
      .eq("id", id)
      .single(),
    supabase
      .from("meeting_action_items")
      .select("id, position, speaker_label, title, at_seconds, suggested_owner_id, owner_id, related_opportunity_id, due_date, status, task_id, decision_note, opportunities(id, project_name)")
      .eq("meeting_id", id)
      .order("position"),
  ]);
  if (m.error) throw m.error;
  if (i.error) throw i.error;
  return { meeting: m.data as MeetingDetail, items: (i.data ?? []) as MeetingItem[] };
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

/** Pull the last two weeks of processed Fireflies meetings and store the ones we lack. */
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
