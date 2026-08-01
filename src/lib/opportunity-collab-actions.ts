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

/* ---------------- Discussion (single-thread, append-only) ---------------- */
// RLS restricts SELECT/INSERT to General Manager, Sales Manager, Development
// Manager (bd_manager), and System Administrator — see
// can_use_discussion(uuid) in the migration. No UPDATE/DELETE grant exists
// at all: posts are permanent, matching the product requirement that
// previous updates are never replaced.

export type DiscussionPost = {
  id: string;
  opportunity_id: string;
  body: string;
  person_in_charge_id: string | null;
  person_in_charge_note: string | null;
  created_by: string | null;
  created_at: string;
  author: { full_name: string | null; email: string | null } | null;
};

export async function listDiscussion(opportunityId: Uuid): Promise<DiscussionPost[]> {
  const { data, error } = await supabase
    .from("opportunity_discussions")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const posts = (data ?? []) as unknown as Omit<DiscussionPost, "author">[];

  // opportunity_discussions.created_by references auth.users, not
  // public.profiles directly, so there's no FK PostgREST can embed
  // through in one query — resolve author names with a second lookup
  // instead (profiles.id shares the same UUID space as auth.users.id).
  const authorIds = [...new Set(posts.map((p) => p.created_by).filter((v): v is string => !!v))];
  let authors = new Map<string, { full_name: string | null; email: string | null }>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", authorIds);
    authors = new Map((profiles ?? []).map((p) => [p.id, { full_name: p.full_name, email: p.email }]));
  }

  return posts.map((p) => ({ ...p, author: p.created_by ? (authors.get(p.created_by) ?? null) : null }));
}

export async function postDiscussionUpdate(input: {
  opportunityId: Uuid;
  body: string;
  personInChargeId?: string | null;
  personInChargeNote?: string | null;
}) {
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from("opportunity_discussions")
    .insert({
      opportunity_id: input.opportunityId,
      body: input.body,
      person_in_charge_id: input.personInChargeId ?? null,
      person_in_charge_note: input.personInChargeNote ?? null,
      created_by,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("discussion.posted", "opportunity", input.opportunityId, { id: data.id });
  return data;
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
  const { url } = await uploadAttachment(`evidence/${input.opportunityId}`, input.file);

  const { data, error } = await supabase
    .from("evidence_sources")
    .insert({
      related_opportunity_id: input.opportunityId,
      source_type: "file_upload",
      source_title: input.file.name,
      source_url: url,
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
