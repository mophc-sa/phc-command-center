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

/**
 * Full RFQ quick-create: upserts company + contact (dedup by phone),
 * creates an opportunity at rfq_received stage, creates the RFQ,
 * and schedules a follow-up 3 days out.
 */
export async function createRfqWithOpportunity(input: {
  companyName: string;
  contactName: string;
  contactPhone: string;
  existingContactId?: string | null;
  existingCompanyId?: string | null;
  projectScope: string;
  responseDueDate: string;
  estimatedValue?: number | null;
}) {
  const uid = await currentUserId();

  // 1. Company — find or create
  let companyId = input.existingCompanyId ?? null;
  if (!companyId) {
    const existing = await supabase.from("companies").select("id").ilike("name", input.companyName.trim()).maybeSingle();
    if (existing.data) {
      companyId = existing.data.id;
    } else {
      const { data: newCo, error: coErr } = await supabase
        .from("companies")
        .insert({ name: input.companyName.trim(), company_type: "target_account", account_owner_id: uid })
        .select("id").single();
      if (coErr) throw coErr;
      companyId = newCo.id;
    }
  }

  // 2. Contact — find or create (dedup by phone)
  let contactId = input.existingContactId ?? null;
  if (!contactId && input.contactPhone) {
    const existing = await supabase.from("contacts").select("id").eq("phone", input.contactPhone.trim()).maybeSingle();
    if (existing.data) {
      contactId = existing.data.id;
    }
  }
  if (!contactId) {
    const { data: newContact, error: ctErr } = await supabase
      .from("contacts")
      .insert({ name: input.contactName.trim(), phone: input.contactPhone.trim() || null, company_id: companyId })
      .select("id").single();
    if (ctErr) throw ctErr;
    contactId = newContact.id;
  }

  // 3. Opportunity at rfq_received
  const { data: opp, error: oppErr } = await supabase
    .from("opportunities")
    .insert({
      project_name: input.projectScope.trim(),
      stage: "quotation",
      sales_stage: "rfq_received",
      company_id: companyId,
      owner_id: uid,
      flow_type: "direct_rfq",
    })
    .select("id").single();
  if (oppErr) throw oppErr;

  // 4. RFQ
  const rfq = await createRfq({
    projectId: null,
    companyId,
    contactId,
    responseDueDate: input.responseDueDate,
    estimatedValue: input.estimatedValue ?? null,
    claimOwner: true,
  });

  // 5. Follow-up (3 days out)
  const followUpDate = new Date();
  followUpDate.setDate(followUpDate.getDate() + 3);
  await supabase.from("follow_ups").insert({
    opportunity_id: opp.id,
    owner_id: uid,
    due_date: followUpDate.toISOString().slice(0, 10),
    channel: "call",
    status: "scheduled" as const,
    notes: `RFQ follow-up — due ${input.responseDueDate}`,
  });

  // 6. Activity log
  await supabase.from("activities").insert({
    activity_type: "note",
    related_opportunity_id: opp.id,
    owner_id: uid,
    summary: `RFQ received from ${input.companyName} — ${input.projectScope}`,
    occurred_at: new Date().toISOString(),
  });

  return { opportunityId: opp.id, rfqId: rfq.id, companyId, contactId };
}

/** Dedup check: find a contact by phone number. */
export async function findContactByPhone(phone: string) {
  if (!phone.trim()) return null;
  const { data } = await supabase
    .from("contacts")
    .select("id, name, phone, company_id")
    .eq("phone", phone.trim())
    .maybeSingle();
  return data ?? null;
}
