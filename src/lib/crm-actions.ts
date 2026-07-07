import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { callBackend } from "@/lib/backend";

type Uuid = string;
export type CompanyType = Database["public"]["Enums"]["company_type"];
export type AccountStatus = Database["public"]["Enums"]["account_status"];
export type ContactAuthority = Database["public"]["Enums"]["contact_authority"];
export type ContactLocation = Database["public"]["Enums"]["contact_location"];
export type ProjectStage = Database["public"]["Enums"]["project_stage"];

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function audit(
  action: string,
  entityType: string,
  entityId: Uuid,
  before?: unknown,
  after?: unknown,
) {
  const actor = await currentUserId();
  await supabase.from("audit_log").insert({
    actor_id: actor,
    actor_type: "user",
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_value: (before ?? null) as never,
    after_value: (after ?? null) as never,
  });
}

/* ---------------- Companies (Accounts) ---------------- */

// New accounts added by the sales team start as pending_review — a manager
// confirms them (or reassigns type/owner). This mirrors the Sales OS rule that
// salespeople may add a Target Account only as "Pending Review".
export async function createCompany(input: {
  name: string;
  companyType: CompanyType;
  regions?: string;
  relationshipLevel?: string;
  nextAction?: string;
  internalNotes?: string;
  claimOwner?: boolean; // salesperson claims themselves as account owner
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("companies")
    .insert({
      name: input.name,
      company_type: input.companyType,
      regions: input.regions ?? null,
      relationship_level: input.relationshipLevel ?? null,
      next_action: input.nextAction ?? null,
      internal_notes: input.internalNotes ?? null,
      account_status: "pending_review",
      account_owner_id: input.claimOwner ? uid : null,
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("company.created", "company", data.id, null, data);
  return data;
}

export async function updateCompany(
  id: Uuid,
  patch: Partial<Database["public"]["Tables"]["companies"]["Update"]>,
) {
  const { data, error } = await supabase
    .from("companies")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await audit("company.updated", "company", id, null, patch);
  return data;
}

// Routed through the backend layer (managers only, enforced server-side and by
// a DB trigger as defense in depth).
export async function changeAccountOwner(id: Uuid, newOwnerId: Uuid | null) {
  const res = await callBackend<{ company: unknown }>("change_account_owner", {
    companyId: id,
    newOwnerId,
  });
  return res.company;
}

/* ---------------- Contacts ---------------- */

export async function createContact(input: {
  name: string;
  companyId?: Uuid | null;
  title?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  location?: ContactLocation;
  authority?: ContactAuthority;
  source?: string;
  confidenceScore?: number | null;
  claimOwner?: boolean;
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      name: input.name,
      company_id: input.companyId ?? null,
      title: input.title ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      linkedin: input.linkedin ?? null,
      location: input.location ?? "unknown",
      authority: input.authority ?? "unknown_authority",
      source: input.source ?? null,
      confidence_score: input.confidenceScore ?? null,
      verification_status: "pending_verification",
      owner_id: input.claimOwner ? uid : null,
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("contact.created", "contact", data.id, null, data);
  return data;
}

export async function updateContact(
  id: Uuid,
  patch: Partial<Database["public"]["Tables"]["contacts"]["Update"]>,
) {
  const { data, error } = await supabase
    .from("contacts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await audit("contact.updated", "contact", id, null, patch);
  return data;
}

/* ---------------- Projects ---------------- */

export async function createProject(input: {
  name: string;
  location?: string;
  sector?: string;
  ownerCompanyId?: Uuid | null;
  mainContractorId?: Uuid | null;
  consultantId?: Uuid | null;
  totalValue?: number | null;
  projectStage?: ProjectStage;
  completionPct?: number | null;
  expectedBoqDate?: string | null;
  source?: string;
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: input.name,
      location: input.location ?? null,
      sector: input.sector ?? null,
      owner_company_id: input.ownerCompanyId ?? null,
      main_contractor_id: input.mainContractorId ?? null,
      consultant_id: input.consultantId ?? null,
      total_value: input.totalValue ?? null,
      project_stage: input.projectStage ?? "unknown",
      completion_pct: input.completionPct ?? null,
      expected_boq_date: input.expectedBoqDate ?? null,
      source: input.source ?? null,
      verification_status: "pending_verification",
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("project.created", "project", data.id, null, data);
  return data;
}

export async function updateProject(
  id: Uuid,
  patch: Partial<Database["public"]["Tables"]["projects"]["Update"]>,
) {
  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await audit("project.updated", "project", id, null, patch);
  return data;
}
