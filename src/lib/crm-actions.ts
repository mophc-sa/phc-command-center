import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { callBackend } from "@/lib/backend";

type Uuid = string;
export type CompanyType = Database["public"]["Enums"]["company_type"];
export type AccountStatus = Database["public"]["Enums"]["account_status"];
export type ContactAuthority = Database["public"]["Enums"]["contact_authority"];
export type ContactLocation = Database["public"]["Enums"]["contact_location"];
export type ContactConfidenceLevel = Database["public"]["Enums"]["contact_confidence_level"];
export type ProjectStage = Database["public"]["Enums"]["project_stage"];
export type SourceConfidence = Database["public"]["Enums"]["confidence_level"];
export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

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
  confidenceLevel?: ContactConfidenceLevel | null;
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
      confidence_level: input.confidenceLevel ?? null,
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
  expectedSignageDate?: string | null;
  sourceConfidence?: SourceConfidence;
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
      expected_signage_date: input.expectedSignageDate ?? null,
      source_confidence: input.sourceConfidence ?? "low",
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

/**
 * "New Opportunity" from an existing Account page (2026-08-03 client
 * request): a company already in the CRM doesn't need to go back through
 * Intake to start a new deal — flow_type "manual" is the enum value
 * already reserved for exactly this case (distinct from "direct_rfq" and
 * "tender_converted", both of which originate elsewhere).
 */
export async function createOpportunityForCompany(input: {
  companyId: Uuid;
  projectName: string;
  location?: string | null;
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("opportunities")
    .insert({
      project_name: input.projectName,
      location: input.location ?? null,
      company_id: input.companyId,
      stage: "discovery",
      // Without this the row lands with sales_stage = NULL and is invisible to
      // every JIH view (My Workspace panels, Award Queue, computeJihPipelineTotal
      // all filter on sales_stage). Found live 2026-08-05: 2 of 4 production
      // opportunities were orphaned this way. `rfq_received` is the enum's real
      // entry point — deliberately NOT `jih`, which would fabricate progress for
      // a deal that has not received an RFQ yet. rfq_received -> jih is a legal
      // transition, so nothing downstream is blocked.
      sales_stage: "rfq_received",
      flow_type: "manual",
      owner_id: uid,
    })
    .select("id")
    .single();
  if (error) throw error;
  await audit("opportunity.created", "opportunity", data.id, null, data);
  return data;
}

/**
 * Mark a project verified. Distinct from a plain updateProject() call so the
 * audit_log entry records specifically that this was a verification action,
 * not a generic field edit.
 */
export async function verifyProject(id: Uuid) {
  const { data, error } = await supabase
    .from("projects")
    .update({ verification_status: "verified" })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await audit("project.verified", "project", id, null, data);
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
