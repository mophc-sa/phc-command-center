import { supabase } from "@/integrations/supabase/client";
import { uploadAttachment } from "@/lib/storage-actions";

type Uuid = string;

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function audit(action: string, entityType: string, entityId: Uuid, after?: unknown) {
  const actor = await currentUserId();
  await supabase.from("audit_log").insert({
    actor_id: actor,
    actor_type: "user",
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_value: null as never,
    after_value: (after ?? null) as never,
  });
}

/* ---------------- Discussion (single-thread) ---------------- */
// RLS restricts SELECT/INSERT to General Manager, Sales Manager, Development
// Manager (bd_manager), and System Administrator — see
// can_use_discussion(uuid) in the migration. UPDATE/DELETE are restricted to
// the post's own author, or system_admin (20260803120000 — reversed the
// earlier "immutable log" design per explicit 2026-08-03 client direction).
// A post can optionally @mention one person for review/approval/endorsement;
// that creates a pending `approvals` row (assigned_approver) so the
// mentioned person sees it via the existing NotificationCenter / my-workspace
// "my approvals" paths — no separate notification system needed.

export type MentionPurpose = "review" | "approval" | "endorsement";

export type DiscussionPost = {
  id: string;
  opportunity_id: string;
  body: string;
  person_in_charge_id: string | null;
  person_in_charge_note: string | null;
  mentioned_user_id: string | null;
  mention_purpose: MentionPurpose | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  author: { full_name: string | null; email: string | null } | null;
  mentioned: { full_name: string | null; email: string | null } | null;
};

export async function listDiscussion(opportunityId: Uuid): Promise<DiscussionPost[]> {
  const { data, error } = await supabase
    .from("opportunity_discussions")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const posts = (data ?? []) as unknown as Omit<DiscussionPost, "author" | "mentioned">[];

  // opportunity_discussions.created_by/mentioned_user_id reference
  // auth.users, not public.profiles directly, so there's no FK PostgREST
  // can embed through in one query — resolve names with a second lookup
  // instead (profiles.id shares the same UUID space as auth.users.id).
  const userIds = [
    ...new Set(
      posts.flatMap((p) => [p.created_by, p.mentioned_user_id]).filter((v): v is string => !!v),
    ),
  ];
  let profiles = new Map<string, { full_name: string | null; email: string | null }>();
  if (userIds.length > 0) {
    const { data: rows } = await supabase.from("profiles").select("id, full_name, email").in("id", userIds);
    profiles = new Map((rows ?? []).map((p) => [p.id, { full_name: p.full_name, email: p.email }]));
  }

  return posts.map((p) => ({
    ...p,
    author: p.created_by ? (profiles.get(p.created_by) ?? null) : null,
    mentioned: p.mentioned_user_id ? (profiles.get(p.mentioned_user_id) ?? null) : null,
  }));
}

export async function postDiscussionUpdate(input: {
  opportunityId: Uuid;
  body: string;
  personInChargeId?: string | null;
  personInChargeNote?: string | null;
  mentionedUserId?: string | null;
  mentionPurpose?: MentionPurpose | null;
}) {
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from("opportunity_discussions")
    .insert({
      opportunity_id: input.opportunityId,
      body: input.body,
      person_in_charge_id: input.personInChargeId ?? null,
      person_in_charge_note: input.personInChargeNote ?? null,
      mentioned_user_id: input.mentionedUserId ?? null,
      mention_purpose: input.mentionPurpose ?? null,
      created_by,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("discussion.posted", "opportunity", input.opportunityId, { id: data.id });

  if (input.mentionedUserId && input.mentionPurpose) {
    await supabase.from("approvals").insert({
      related_opportunity_id: input.opportunityId,
      approval_type: `discussion_${input.mentionPurpose}`,
      status: "pending",
      requested_by: created_by,
      assigned_approver: input.mentionedUserId,
      linked_record_type: "opportunity_discussion",
      linked_record_id: data.id,
      requested_payload: { discussion_id: data.id, body_preview: input.body.slice(0, 200) } as never,
    });
  }

  return data;
}

export async function updateDiscussionPost(id: Uuid, body: string) {
  const { error } = await supabase.from("opportunity_discussions").update({ body } as never).eq("id", id);
  if (error) throw error;
}

export async function deleteDiscussionPost(id: Uuid) {
  const { error } = await supabase.from("opportunity_discussions").delete().eq("id", id);
  if (error) throw error;
}

/* ---------------- Assignment (single source of truth) ---------------- */
// Client Contact and Primary Person are read from existing data
// (stakeholders + opportunities.owner_id) — only Person in Charge is new,
// and it lives on the opportunity itself so Discussion and the Assignment
// card both read/write the same column instead of duplicating it.

export async function updatePersonInCharge(input: {
  opportunityId: Uuid;
  personInChargeId: string | null;
  personInChargeNote?: string | null;
}) {
  const { error } = await supabase
    .from("opportunities")
    .update({
      person_in_charge_id: input.personInChargeId,
      person_in_charge_note: input.personInChargeNote ?? null,
    })
    .eq("id", input.opportunityId);
  if (error) throw error;
  await audit("assignment.person_in_charge_updated", "opportunity", input.opportunityId, {
    personInChargeId: input.personInChargeId,
  });
}

/* ---------------- Evidence file uploads ---------------- */
// Reuses the existing shared `attachments` storage bucket (storage-actions.ts)
// — server-side type/size limits are enforced on the bucket itself (25MB,
// allowlisted MIME types), not just in this client-side check.

const MAX_EVIDENCE_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EVIDENCE_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function validateEvidenceFile(file: File): string | null {
  if (file.size > MAX_EVIDENCE_FILE_BYTES) {
    return "file_too_large";
  }
  if (file.type && !ALLOWED_EVIDENCE_MIME_TYPES.has(file.type)) {
    return "file_type_not_allowed";
  }
  return null;
}

export async function uploadEvidenceFile(input: {
  opportunityId: Uuid;
  file: File;
}) {
  const clientError = validateEvidenceFile(input.file);
  if (clientError) throw new Error(clientError);

  const uploaded_by = await currentUserId();
  // Store the path in vault_path (which exists for exactly this) and leave
  // source_url null — an expiring signed URL in a business column is what this
  // hotfix exists to stop.
  const { path } = await uploadAttachment(`evidence/${input.opportunityId}`, input.file);

  const { data, error } = await supabase
    .from("evidence_sources")
    .insert({
      related_opportunity_id: input.opportunityId,
      source_type: "file_upload",
      source_title: input.file.name,
      // vault_path exists for exactly this. An expiring signed URL in
      // source_url is what this hotfix set out to stop.
      source_url: null,
      vault_path: path,
      confidence_level: "medium",
      file_size: input.file.size,
      file_type: input.file.type || null,
      uploaded_by,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("evidence.uploaded", "opportunity", input.opportunityId, { fileName: input.file.name });
  return data;
}

/* ---------------- Contracts ---------------- */
// A minimal contract record linked to an opportunity — see the migration's
// header comment for why this is new (no complete contract model existed
// before). Multiple contracts per opportunity are supported.

export type ContractStage = "draft" | "sent_for_signature" | "signed" | "active" | "completed" | "terminated";

export type ContractRecord = {
  id: string;
  opportunity_id: string;
  contract_name: string | null;
  contract_reference_number: string | null;
  stage: ContractStage;
  client: string | null;
  contract_value: number | null;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  responsible_user_id: string | null;
  document_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export async function listContracts(opportunityId: Uuid): Promise<ContractRecord[]> {
  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ContractRecord[];
}

export async function createContract(input: {
  opportunityId: Uuid;
  contractName?: string | null;
  contractReferenceNumber?: string | null;
  stage?: ContractStage;
  client?: string | null;
  contractValue?: number | null;
  currency?: string;
  startDate?: string | null;
  endDate?: string | null;
  responsibleUserId?: string | null;
  documentUrl?: string | null;
  notes?: string | null;
}) {
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from("contracts")
    .insert({
      opportunity_id: input.opportunityId,
      contract_name: input.contractName ?? null,
      contract_reference_number: input.contractReferenceNumber ?? null,
      stage: input.stage ?? "draft",
      client: input.client ?? null,
      contract_value: input.contractValue ?? null,
      currency: input.currency ?? "SAR",
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      responsible_user_id: input.responsibleUserId ?? null,
      document_url: input.documentUrl ?? null,
      notes: input.notes ?? null,
      created_by,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("contract.created", "opportunity", input.opportunityId, { id: data.id });
  return data as unknown as ContractRecord;
}

export async function updateContract(
  contractId: Uuid,
  opportunityId: Uuid,
  patch: Partial<{
    contractName: string | null;
    contractReferenceNumber: string | null;
    stage: ContractStage;
    client: string | null;
    contractValue: number | null;
    currency: string;
    startDate: string | null;
    endDate: string | null;
    responsibleUserId: string | null;
    documentUrl: string | null;
    notes: string | null;
  }>,
) {
  const dbPatch: Record<string, unknown> = {};
  if ("contractName" in patch) dbPatch.contract_name = patch.contractName;
  if ("contractReferenceNumber" in patch) dbPatch.contract_reference_number = patch.contractReferenceNumber;
  if ("stage" in patch) dbPatch.stage = patch.stage;
  if ("client" in patch) dbPatch.client = patch.client;
  if ("contractValue" in patch) dbPatch.contract_value = patch.contractValue;
  if ("currency" in patch) dbPatch.currency = patch.currency;
  if ("startDate" in patch) dbPatch.start_date = patch.startDate;
  if ("endDate" in patch) dbPatch.end_date = patch.endDate;
  if ("responsibleUserId" in patch) dbPatch.responsible_user_id = patch.responsibleUserId;
  if ("documentUrl" in patch) dbPatch.document_url = patch.documentUrl;
  if ("notes" in patch) dbPatch.notes = patch.notes;

  const { data, error } = await supabase
    .from("contracts")
    .update(dbPatch as never)
    .eq("id", contractId)
    .select()
    .single();
  if (error) throw error;
  await audit("contract.updated", "opportunity", opportunityId, { id: contractId });
  return data as unknown as ContractRecord;
}

/* ---------------- Client Details (editable, CRM-linked) ------------------- */
// Writes back to the real CRM records instead of just displaying derived
// data: the contact goes into `stakeholders` (create the opportunity's
// primary stakeholder if none exists yet, else update it), the company
// name finds-or-creates a `companies` row and links opportunities.company_id
// (mirrors the find-or-create pattern already used by
// createRfqWithOpportunity in rfq-actions.ts), and location writes directly
// to opportunities.location (not server-guarded — only stage/sales_stage
// are protected by protect_commercial_stage()).

export async function upsertClientDetails(input: {
  opportunityId: Uuid;
  existingStakeholderId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  companyName?: string | null;
  location?: string | null;
  /** "jih" | "tender" | "other", or "" to leave it unset. */
  classification?: string | null;
  /** The RFQ this opportunity already has, if any. */
  existingRfqId?: string | null;
}) {
  // 1. Stakeholder (contact person) — update in place if one already exists
  // for this opportunity, else create it.
  if (input.contactName && input.contactName.trim()) {
    const contactPatch = {
      name: input.contactName.trim(),
      phone: input.contactPhone?.trim() || null,
      email: input.contactEmail?.trim() || null,
    };
    if (input.existingStakeholderId) {
      const { error } = await supabase
        .from("stakeholders")
        .update(contactPatch as never)
        .eq("id", input.existingStakeholderId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("stakeholders")
        .insert({ opportunity_id: input.opportunityId, ...contactPatch } as never);
      if (error) throw error;
    }
  }

  // 2. Company — find or create by name, link opportunities.company_id.
  let companyId: string | undefined;
  if (input.companyName && input.companyName.trim()) {
    const name = input.companyName.trim();
    const existing = await supabase.from("companies").select("id").ilike("name", name).maybeSingle();
    if (existing.data) {
      companyId = existing.data.id;
    } else {
      const { data: newCo, error: coErr } = await supabase
        .from("companies")
        .insert({ name, company_type: "target_account" } as never)
        .select("id")
        .single();
      if (coErr) throw coErr;
      companyId = newCo.id;
    }
  }

  // 3. Opportunity fields (location + company link).
  const oppPatch: Record<string, unknown> = {};
  if (input.location !== undefined) oppPatch.location = input.location?.trim() || null;
  if (companyId) oppPatch.company_id = companyId;
  if (Object.keys(oppPatch).length > 0) {
    const { error } = await supabase.from("opportunities").update(oppPatch as never).eq("id", input.opportunityId);
    if (error) throw error;
  }

  // 4. JIH or Tender.
  //
  // Client feedback 2026-08-25: this field was READ-ONLY on the detail page and
  // showed "—" on records that plainly are a JIH. It lives on the RFQ, not on
  // the opportunity — every screen that displays it (this card, the pipeline
  // list's "JIH / Tender" column, the archive's route filter) reads
  // rfqs.classification, so writing it anywhere else would put a second answer
  // next to the first.
  //
  // An opportunity with no RFQ row therefore has nowhere to hold the answer,
  // and those were exactly the records showing "—". We create the row rather
  // than refuse the edit: the columns beyond the link are all nullable, so what
  // is written is precisely what the user stated and nothing invented.
  if (input.classification !== undefined && input.classification !== null && input.classification !== "") {
    const classification = input.classification;
    if (input.existingRfqId) {
      const { error } = await supabase
        .from("rfqs")
        .update({ classification } as never)
        .eq("id", input.existingRfqId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("rfqs").insert({
        opportunity_id: input.opportunityId,
        classification,
        ...(companyId ? { company_id: companyId } : {}),
        created_by: await currentUserId(),
      } as never);
      if (error) throw error;
    }
  }

  await audit("client_details.updated", "opportunity", input.opportunityId, input);
}

/**
 * Add another contact person to an opportunity.
 *
 * Asked for on 2026-09-02 (PDF, page 2): the Relationships panel said, in its
 * own comment, that it "reads the existing per-opportunity stakeholders;
 * creates no contact". So a deal with three people on the client side could
 * hold exactly one of them, and the other two lived in someone's phone.
 *
 * `upsertClientDetails` above is not this. That one edits THE primary contact
 * -- one row, updated in place -- which is the right shape for "correct the
 * client details" and the wrong one for "there is also a project manager".
 *
 * `contact_order` is assigned rather than left null so the panel has a stable
 * order: rows added later sit below the primary contact instead of shuffling
 * on every read.
 */
export async function addStakeholder(input: {
  opportunityId: Uuid;
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  organization?: string | null;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("stakeholder_name_required");

  // The next slot, read at write time. Two people adding a contact in the same
  // second would collide on the number; they would not collide on the row, and
  // a duplicated order is a cosmetic tie, not a lost contact.
  const { data: existing } = await supabase
    .from("stakeholders")
    .select("contact_order")
    .eq("opportunity_id", input.opportunityId)
    .order("contact_order", { ascending: false })
    .limit(1);
  const nextOrder = Number(existing?.[0]?.contact_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("stakeholders")
    .insert({
      opportunity_id: input.opportunityId,
      name,
      role: input.role?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      organization: input.organization?.trim() || null,
      contact_order: nextOrder,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}
