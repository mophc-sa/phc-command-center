import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Uuid = string;
export type ActivityType = Database["public"]["Enums"]["activity_type"];

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
