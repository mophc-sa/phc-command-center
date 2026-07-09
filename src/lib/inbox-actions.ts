// =============================================================================
// PHC Sales OS — Lead & Tender Inbox (Sprint 3).
//
// A thin capture + triage layer. It never writes to companies/contacts/
// projects/rfqs/tenders/leads directly — every "create X" action here calls
// the same create* function the rest of the app already uses (crm-actions,
// rfq-actions, tender-actions, lead-actions), so every downstream safeguard
// those enforce (pending_review accounts, the full lead qualification
// pipeline before an opportunity exists, etc.) applies unchanged. Nothing
// becomes an opportunity without review: "create opportunity candidate"
// calls createLead, never an opportunity insert.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createCompany, createContact, createProject, type CompanyType, type ContactAuthority, type ContactLocation, type ProjectStage } from "@/lib/crm-actions";
import { createRfq } from "@/lib/rfq-actions";
import { createTender } from "@/lib/tender-actions";
import { createLead } from "@/lib/lead-actions";

type Uuid = string;
export type InboxSourceType = Database["public"]["Enums"]["inbox_source_type"];
export type InboxClassification = Database["public"]["Enums"]["inbox_classification"];
export type InboxStatus = Database["public"]["Enums"]["inbox_status"];

export const INBOX_SOURCE_TYPES: InboxSourceType[] = [
  "manual_lead", "manual_tender", "manual_rfq", "old_data_candidate",
  "referral", "market_signal", "email_placeholder", "whatsapp_placeholder",
];

export const INBOX_CLASSIFICATIONS: InboxClassification[] = [
  "unclassified", "company", "contact", "project", "rfq", "tender",
  "opportunity_candidate", "signal_watchlist", "duplicate", "incomplete",
];

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function auditInbox(action: string, itemId: Uuid, after?: unknown) {
  const uid = await currentUserId();
  await supabase.from("audit_log").insert({
    actor_id: uid, actor_type: "user", action, entity_type: "inbox_item", entity_id: itemId, after_value: (after ?? null) as never,
  });
}

export type InboxItemInput = {
  sourceType: InboxSourceType;
  sourceName?: string;
  companyName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  projectName?: string;
  clientOwner?: string;
  mainContractor?: string;
  consultant?: string;
  scope?: string;
  location?: string;
  estimatedValue?: number | null;
  deadline?: string | null;
  notes?: string;
  evidenceUrl?: string;
  assignedOwnerId?: Uuid | null;
  nextAction?: string;
  followUpDate?: string | null;
};

export async function createInboxItem(input: InboxItemInput) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("inbox_items")
    .insert({
      source_type: input.sourceType,
      source_name: input.sourceName ?? null,
      company_name: input.companyName ?? null,
      contact_name: input.contactName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      project_name: input.projectName ?? null,
      client_owner: input.clientOwner ?? null,
      main_contractor: input.mainContractor ?? null,
      consultant: input.consultant ?? null,
      scope: input.scope ?? null,
      location: input.location ?? null,
      estimated_value: input.estimatedValue ?? null,
      deadline: input.deadline ?? null,
      notes: input.notes ?? null,
      evidence_url: input.evidenceUrl ?? null,
      assigned_owner_id: input.assignedOwnerId ?? uid,
      next_action: input.nextAction ?? null,
      follow_up_date: input.followUpDate ?? null,
      classification: "unclassified",
      status: "new",
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  await auditInbox("inbox_item.created", data.id, data);
  return data;
}

export async function classifyInboxItem(id: Uuid, classification: InboxClassification) {
  const { data, error } = await supabase
    .from("inbox_items")
    .update({ classification, status: "in_review" })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await auditInbox("inbox_item.classified", id, { classification });
  return data;
}

// ---- Duplicate check (client-side, before creation) -----------------------
// Lightweight equivalent of the import pipeline's duplicate engine
// (supabase/functions/_shared/duplicates.ts is Deno-only and not importable
// here), scoped to a handful of live-table lookups rather than a full
// union-find pass — enough to warn, not to auto-merge.
function normalize(v: string | null | undefined): string {
  return (v ?? "").toLowerCase().trim();
}

export type DuplicateCandidate = { table: "companies" | "contacts" | "projects"; id: string; label: string; matchedOn: string };

export async function checkInboxDuplicates(input: {
  companyName?: string;
  phone?: string;
  email?: string;
  projectName?: string;
}): Promise<DuplicateCandidate[]> {
  const candidates: DuplicateCandidate[] = [];

  const companyName = normalize(input.companyName);
  if (companyName.length >= 3) {
    const { data } = await supabase.from("companies").select("id, name").ilike("name", `%${companyName}%`).limit(5);
    for (const c of data ?? []) candidates.push({ table: "companies", id: c.id, label: c.name, matchedOn: "name" });
  }

  const phone = normalize(input.phone);
  const email = normalize(input.email);
  if (phone || email) {
    let q = supabase.from("contacts").select("id, name, phone, email").limit(5);
    if (phone && email) q = q.or(`phone.eq.${phone},email.eq.${email}`);
    else if (phone) q = q.eq("phone", phone);
    else q = q.eq("email", email);
    const { data } = await q;
    for (const c of data ?? []) candidates.push({ table: "contacts", id: c.id, label: c.name, matchedOn: c.email === email && email ? "email" : "phone" });
  }

  const projectName = normalize(input.projectName);
  if (projectName.length >= 3) {
    const { data } = await supabase.from("projects").select("id, name").ilike("name", `%${projectName}%`).limit(5);
    for (const p of data ?? []) candidates.push({ table: "projects", id: p.id, label: p.name, matchedOn: "name" });
  }

  return candidates;
}

async function markConverted(id: Uuid, recordType: string, recordId: Uuid) {
  const { error } = await supabase
    .from("inbox_items")
    .update({ status: "converted", converted_record_type: recordType, converted_record_id: recordId })
    .eq("id", id);
  if (error) throw error;
  await auditInbox("inbox_item.converted", id, { record_type: recordType, record_id: recordId });
}

// ---- Conversion actions — each wraps the existing, already-safeguarded
// create* function; the inbox never inserts into the target table itself.

export async function convertInboxToCompany(id: Uuid, input: { name: string; companyType: CompanyType; claimOwner?: boolean }) {
  const company = await createCompany(input);
  await markConverted(id, "company", company.id);
  return company;
}

export async function convertInboxToContact(id: Uuid, input: {
  name: string; companyId?: Uuid | null; phone?: string; email?: string;
  location?: ContactLocation; authority?: ContactAuthority; claimOwner?: boolean;
}) {
  const contact = await createContact(input);
  await markConverted(id, "contact", contact.id);
  return contact;
}

export async function convertInboxToProject(id: Uuid, input: {
  name: string; location?: string; ownerCompanyId?: Uuid | null; mainContractorId?: Uuid | null;
  consultantId?: Uuid | null; totalValue?: number | null; projectStage?: ProjectStage; source?: string;
}) {
  const project = await createProject(input);
  await markConverted(id, "project", project.id);
  return project;
}

export async function convertInboxToRfq(id: Uuid, input: {
  rfqNumber?: string; sourceType?: string; projectId?: Uuid | null; companyId?: Uuid | null;
  contactId?: Uuid | null; responseDueDate?: string | null; estimatedValue?: number | null; claimOwner?: boolean;
}) {
  const rfq = await createRfq(input);
  await markConverted(id, "rfq", rfq.id);
  return rfq;
}

export async function convertInboxToTender(id: Uuid, input: {
  tenderName: string; source?: string; projectId?: Uuid | null; classification?: "A" | "B" | "C" | null;
  expectedAwardDate?: string | null; estimatedProjectValue?: number | null; claimOwner?: boolean;
}) {
  const tender = await createTender(input);
  await markConverted(id, "tender", tender.id);
  return tender;
}

// "Opportunity candidate" — deliberately calls createLead, never an
// opportunity insert. The lead still has to pass its full 11-stage
// qualification pipeline (LEAD_STAGES) before convertLeadToOpportunity can
// ever run. This is what "nothing becomes an opportunity without review"
// means concretely.
export async function convertInboxToOpportunityCandidate(id: Uuid, input: {
  projectName: string; source?: string; location?: string; mainContractorGuess?: string; estimatedValue?: number | null;
}) {
  const lead = await createLead(input);
  await markConverted(id, "lead", lead.id);
  return lead;
}

export async function sendInboxToMissingData(id: Uuid, reason: string) {
  const { data, error } = await supabase
    .from("inbox_items")
    .update({ status: "sent_to_missing_data", classification: "incomplete", missing_data_reason: reason })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await auditInbox("inbox_item.sent_to_missing_data", id, { reason });
  return data;
}

export async function markInboxDuplicate(id: Uuid, of: { type: string; id: Uuid }) {
  const { data, error } = await supabase
    .from("inbox_items")
    .update({ status: "marked_duplicate", classification: "duplicate", duplicate_of_type: of.type, duplicate_of_id: of.id })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await auditInbox("inbox_item.marked_duplicate", id, { duplicate_of_type: of.type, duplicate_of_id: of.id });
  return data;
}

export async function archiveInboxItem(id: Uuid, reason: string) {
  const { data, error } = await supabase
    .from("inbox_items")
    .update({ status: "archived", archive_reason: reason })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await auditInbox("inbox_item.archived", id, { reason });
  return data;
}
