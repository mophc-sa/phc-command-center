import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";

type Uuid = string;

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export type RfqClassification = "jih" | "tender" | "other";

export async function createRfq(input: {
  rfqNumber?: string;
  sourceType?: string;
  projectId?: Uuid | null;
  companyId?: Uuid | null;
  contactId?: Uuid | null;
  city?: string | null;
  classification?: RfqClassification | null;
  classificationOther?: string | null;
  receivedDate?: string | null;
  responseDueDate?: string | null;
  estimatedValue?: number | null;
  documentUrl?: string | null;
  // Explicit assignment (managers only — enforced by the frontend only
  // showing this picker to canManageSalesPipeline roles). Falls back to
  // claimOwner (self-assign) for a salesperson creating their own RFQ.
  salesOwnerId?: Uuid | null;
  claimOwner?: boolean;
  /** Links the RFQ to the opportunity it belongs to (spec §25.2/§25.10).
   *  Left null by the intake-conversion path, which creates the RFQ first. */
  opportunityId?: Uuid | null;
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("rfqs")
    .insert({
      opportunity_id: input.opportunityId ?? null,
      rfq_number: input.rfqNumber ?? null,
      source_type: input.sourceType ?? null,
      project_id: input.projectId ?? null,
      company_id: input.companyId ?? null,
      contact_id: input.contactId ?? null,
      city: input.city ?? null,
      classification: input.classification ?? null,
      classification_other: input.classification === "other" ? (input.classificationOther ?? null) : null,
      // received_date is NOT NULL with a DEFAULT CURRENT_DATE — pass
      // undefined (not null) when unset so the DB default applies.
      received_date: input.receivedDate ?? undefined,
      response_due_date: input.responseDueDate ?? null,
      estimated_value: input.estimatedValue ?? null,
      document_url: input.documentUrl ?? null,
      sales_owner_id: input.salesOwnerId ?? (input.claimOwner ? uid : null),
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
/**
 * Spec §25 in one call: saving one RFQ form produces the whole starting state.
 *
 * §25 lists 18 things that must happen automatically when an RFQ is saved. This
 * covers the ones that are actionable today: generate the opportunity (2),
 * classify it Tender or JIH (3), write the first activity record (4), set a
 * default next follow-up (17), and create-or-link both the contact (13) and the
 * company account (14).
 *
 * Before this was wired up, reaching the same state took a salesperson four
 * screens — New Intake, Classify, Convert, then a separate RFQ→Opportunity
 * action — and the RFQ that came out the far end was not even linked to its
 * opportunity. Faisal, 2026-08-05: "why all these steps after filling in the
 * form?" Spec §45-1 asks for a new RFQ in under two minutes; §6 asks for a
 * "+ New RFQ" button reachable from anywhere.
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
  /** §24 mandatory: Tender or JIH. Drives the opportunity's starting stage. */
  opportunityType?: "jih" | "tender";
  /** §24: Source (Email, WhatsApp, Phone, Portal, ...). */
  sourceType?: string | null;
  /** §24: link to the source — the email the RFQ arrived in, typically. */
  documentUrl?: string | null;
  projectId?: string | null;
  location?: string | null;
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

  // 3. Opportunity at rfq_received (§25.2, §25.3, docs/DECISIONS.md D6)
  const { data: opp, error: oppErr } = await supabase
    .from("opportunities")
    .insert({
      project_name: input.projectScope.trim(),
      stage: "quotation",
      sales_stage: "rfq_received",
      company_id: companyId,
      project_id: input.projectId ?? null,
      location: input.location ?? null,
      owner_id: uid,
      // §25.3 "Classify it as Tender or JIH". A tender-track RFQ is one where
      // the contractor is still bidding, so it is not a direct RFQ.
      flow_type: input.opportunityType === "tender" ? "manual" : "direct_rfq",
    })
    .select("id").single();
  if (oppErr) throw oppErr;

  // 4. RFQ, linked back to the opportunity.
  //
  // The link is the point. This function already created both records before,
  // but never set rfqs.opportunity_id — so every RFQ it produced was an orphan,
  // and the urgent-submissions table could not navigate anywhere from it.
  const rfq = await createRfq({
    projectId: input.projectId ?? null,
    companyId,
    contactId,
    sourceType: input.sourceType ?? undefined,
    documentUrl: input.documentUrl ?? null,
    responseDueDate: input.responseDueDate,
    estimatedValue: input.estimatedValue ?? null,
    opportunityId: opp.id,
    // Without this the opportunity page's "JIH or Tender" field renders "—",
    // even though the user picked one on the intake form: that panel reads
    // `rfqs.classification`, and this path never set it. Found by browser QA
    // 2026-08-05 — the database looked correct, the screen did not.
    classification: input.opportunityType === "tender" ? "tender" : "jih",
    claimOwner: true,
  });

  // 4b. Stakeholder — so the person actually shows on the opportunity.
  //
  // The contact created above is linked to the RFQ (`rfqs.contact_id`), but the
  // opportunity page's Client Details panel reads `stakeholders`, not
  // `contacts`. Without this row the panel renders Contact Person / Number /
  // Email as "—" even though the user typed all three on the intake form.
  // Found by browser QA 2026-08-05: every database check passed while the
  // screen the user lands on was blank.
  if (input.contactName?.trim() || input.contactPhone?.trim()) {
    await supabase.from("stakeholders").insert({
      opportunity_id: opp.id,
      name: input.contactName?.trim() || input.companyName.trim(),
      phone: input.contactPhone?.trim() || null,
      organization: input.companyName?.trim() || null,
      contact_order: 1,
    });
  }

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
