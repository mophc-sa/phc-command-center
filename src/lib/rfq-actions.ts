import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";

type Uuid = string;

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function createRfq(input: {
  rfqNumber?: string;
  sourceType?: string;
  projectId?: Uuid | null;
  companyId?: Uuid | null;
  contactId?: Uuid | null;
  responseDueDate?: string | null;
  estimatedValue?: number | null;
  documentUrl?: string | null;
  claimOwner?: boolean;
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("rfqs")
    .insert({
      rfq_number: input.rfqNumber ?? null,
      source_type: input.sourceType ?? null,
      project_id: input.projectId ?? null,
      company_id: input.companyId ?? null,
      contact_id: input.contactId ?? null,
      response_due_date: input.responseDueDate ?? null,
      estimated_value: input.estimatedValue ?? null,
      document_url: input.documentUrl ?? null,
      sales_owner_id: input.claimOwner ? uid : null,
      status: "open",
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("audit_log").insert({
    actor_id: uid, actor_type: "user", action: "rfq.created",
    entity_type: "rfq", entity_id: data.id, after_value: data as never,
  });
  return data;
}

// RFQ_RECEIVED -> JIH is enforced by the backend (PHC conversion rules + audit).
export async function convertRfqToJih(
  rfqId: Uuid,
  fields: Record<string, unknown>,
  review?: Record<string, unknown>,
) {
  return await callBackend<{ opportunity: unknown }>("convert_rfq_to_jih", { rfqId, fields, review });
}
