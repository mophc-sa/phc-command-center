import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Uuid = string;
export type ActivityType = Database["public"]["Enums"]["activity_type"];
export type ActivityStatus = Database["public"]["Enums"]["activity_status"];
export type Activity = Database["public"]["Tables"]["activities"]["Row"];

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// Log a real interaction (call/visit/meeting/note) or capture a draft.
// Drafts are stored but never auto-sent — sending is a human action.
export async function logActivity(input: {
  type: ActivityType;
  summary?: string;
  draftContent?: string;
  opportunityId?: Uuid | null;
  companyId?: Uuid | null;
  contactId?: Uuid | null;
  rfqId?: Uuid | null;
  tenderId?: Uuid | null;
  templateId?: Uuid | null;
  occurredAt?: string | null;
}) {
  const uid = await currentUserId();
  const isDraft = input.type === "email_draft" || input.type === "whatsapp_draft";
  const { data, error } = await supabase
    .from("activities")
    .insert({
      activity_type: input.type,
      status: isDraft ? "draft" : "logged",
      summary: input.summary ?? null,
      draft_content: input.draftContent ?? null,
      related_opportunity_id: input.opportunityId ?? null,
      company_id: input.companyId ?? null,
      contact_id: input.contactId ?? null,
      related_rfq_id: input.rfqId ?? null,
      related_tender_id: input.tenderId ?? null,
      template_id: input.templateId ?? null,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      owner_id: uid,
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("audit_log").insert({
    actor_id: uid,
    actor_type: "user",
    action: "activity.logged",
    entity_type: "activity",
    entity_id: data.id,
    after_value: data as never,
  });
  // Keep the opportunity's last-activity timestamp fresh for cadence tracking.
  if (input.opportunityId) {
    await supabase
      .from("opportunities")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", input.opportunityId);
  }
  return data;
}

// Pure guard for markActivitySent — kept separate from the Supabase calls so
// it's testable without a live client. Throws a clear, specific error for
// each way an activity is NOT a sendable draft, rather than letting
// markActivitySent silently update whatever row/status it's pointed at (the
// UI only ever shows "Mark as Sent" for draft email_draft/whatsapp_draft
// rows, but the function itself must not trust that — it can be called
// directly with any id).
export function assertSendableDraft(
  activity: Activity | null | undefined,
  activityId: Uuid,
): asserts activity is Activity {
  if (!activity) {
    throw new Error(`Cannot mark as sent: activity ${activityId} was not found.`);
  }
  if (activity.activity_type !== "email_draft" && activity.activity_type !== "whatsapp_draft") {
    throw new Error(
      `Cannot mark as sent: activity ${activityId} has type "${activity.activity_type}", ` +
        `only email_draft/whatsapp_draft activities can be marked as sent.`,
    );
  }
  if (activity.status !== "draft") {
    throw new Error(
      `Cannot mark as sent: activity ${activityId} has status "${activity.status}", ` +
        `only draft activities can be marked as sent.`,
    );
  }
}

// Human confirms a draft (email_draft/whatsapp_draft) was actually sent
// outside the app (Outlook / WhatsApp). Phase 1 never sets this itself.
export async function markActivitySent(activityId: Uuid) {
  const uid = await currentUserId();

  const { data: before, error: fetchError } = await supabase
    .from("activities")
    .select("*")
    .eq("id", activityId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  assertSendableDraft(before, activityId);

  const { data, error } = await supabase
    .from("activities")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_by: uid })
    .eq("id", activityId)
    .select()
    .single();
  if (error) throw error;

  // The status update above already succeeded — an audit-log failure here
  // must be surfaced (not silently swallowed) but must never roll back or
  // re-throw, since that would falsely report the "mark as sent" action as
  // failed when the actual state change already committed.
  const { error: auditError } = await supabase.from("audit_log").insert({
    actor_id: uid,
    actor_type: "user",
    action: "activity.marked_sent",
    entity_type: "activity",
    entity_id: activityId,
    before_value: before as never,
    after_value: data as never,
  });
  if (auditError) {
    console.error(`[activity] audit insert failed for activity.marked_sent on activity ${activityId}:`, auditError);
  }

  return data;
}

// Communication-history timeline query — filter by exactly one linked record.
export type ActivityTimelineFilter =
  | { opportunityId: Uuid }
  | { companyId: Uuid }
  | { contactId: Uuid }
  | { rfqId: Uuid }
  | { tenderId: Uuid };

export async function listActivities(filter: ActivityTimelineFilter, limit = 50): Promise<Activity[]> {
  let query = supabase.from("activities").select("*").order("occurred_at", { ascending: false }).limit(limit);
  if ("opportunityId" in filter) query = query.eq("related_opportunity_id", filter.opportunityId);
  else if ("companyId" in filter) query = query.eq("company_id", filter.companyId);
  else if ("contactId" in filter) query = query.eq("contact_id", filter.contactId);
  else if ("rfqId" in filter) query = query.eq("related_rfq_id", filter.rfqId);
  else query = query.eq("related_tender_id", filter.tenderId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
