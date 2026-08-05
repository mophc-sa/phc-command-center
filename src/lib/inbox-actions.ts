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
export type InboxClientType = Database["public"]["Enums"]["inbox_client_type"];
export type InboxProjectType = Database["public"]["Enums"]["inbox_project_type"];
export type InboxRfqFrom = Database["public"]["Enums"]["inbox_rfq_from"];
export type InboxScope = Database["public"]["Enums"]["inbox_scope"];
export type InboxLocation = Database["public"]["Enums"]["inbox_location"];

export const INBOX_SOURCE_TYPES: InboxSourceType[] = [
  "manual_lead", "manual_tender", "manual_rfq", "old_data_candidate",
  "referral", "market_signal", "email_placeholder", "whatsapp_placeholder",
];

export const INBOX_CLIENT_TYPES: InboxClientType[] = ["main_client", "contractor_jih", "contractor_tender", "consultant"];
export const INBOX_PROJECT_TYPES: InboxProjectType[] = ["jih", "tender"];
export const INBOX_RFQ_FROM: InboxRfqFrom[] = ["owner_developer", "main_contractor", "consultant"];
export const INBOX_SCOPES: InboxScope[] = [
  "supply_and_installation", "supply_only_signage", "supply_installation_others",
  "supply_only_others", "mockup_sample_request", "installation_only",
];
export const INBOX_LOCATIONS: InboxLocation[] = [
  "riyadh", "jeddah", "makkah", "madinah", "dammam", "al_khobar", "dhahran",
  "jubail", "taif", "tabuk", "abha", "yanbu", "jazan", "buraydah", "hail",
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
  clientType?: InboxClientType;
  projectType?: InboxProjectType;
  projectName?: string;
  projectNumber?: string;
  rfqFrom?: InboxRfqFrom;
  dateReceived?: string;
  clientOwner?: string;
  mainContractor?: string;
  consultant?: string;
  scope?: string;
  location?: string;
  scopeType?: InboxScope;
  locationCity?: InboxLocation;
  estimatedValue?: number | null;
  deadline?: string | null;
  notes?: string;
  evidenceUrl?: string;
  assignedOwnerId?: Uuid | null;
  nextAction?: string;
  followUpDate?: string | null;
};

/**
 * Derives the classification from the intake form instead of asking again.
 *
 * Spec §25 lists what saving an RFQ must do automatically, and item 3 is
 * "Classify it as Tender or JIH" — automatic, not a separate manual step. The
 * intake form already captures exactly that distinction in `projectType`
 * (`jih` | `tender`), so asking the user to restate it in a second dialog is
 * pure re-entry. Faisal's words, 2026-08-05: the classify step "has no point,
 * I already specified it in the form".
 *
 * Requires a project name as well as a type: a bare type with nothing attached
 * is not enough to route an item confidently, and guessing there would be worse
 * than asking.
 *
 * Returns null when it cannot tell — the item stays `unclassified` and the
 * manual classify step applies, which is what it is genuinely for: vague market
 * signals, duplicates, incomplete captures, and items that turn out to be a
 * company or contact rather than a deal.
 *
 * The mapping to `rfq` (not a "jih" classification) is not a fudge: in this
 * system the JIH track is entered through an RFQ record — `convertInboxToRfq`
 * is the JIH path, `convertInboxToTender` is the tender path. Spec §4.2 agrees,
 * naming the first JIH stage "New JIH RFQ".
 */
export function inferClassification(input: {
  projectType?: InboxProjectType | null;
  projectName?: string | null;
}): InboxClassification | null {
  if (!input.projectType) return null;
  if (!input.projectName?.trim()) return null;
  return input.projectType === "tender" ? "tender" : "rfq";
}

export async function createInboxItem(input: InboxItemInput) {
  const uid = await currentUserId();
  const inferred = inferClassification(input);
  const { data, error } = await supabase
    .from("inbox_items")
    .insert({
      source_type: input.sourceType,
      source_name: input.sourceName ?? null,
      company_name: input.companyName ?? null,
      contact_name: input.contactName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      client_type: input.clientType ?? null,
      project_type: input.projectType ?? null,
      project_name: input.projectName ?? null,
      project_number: input.projectNumber ?? null,
      rfq_from: input.rfqFrom ?? null,
      date_received: input.dateReceived ?? undefined,
      client_owner: input.clientOwner ?? null,
      main_contractor: input.mainContractor ?? null,
      consultant: input.consultant ?? null,
      scope: input.scope ?? null,
      location: input.location ?? null,
      scope_type: input.scopeType ?? null,
      location_city: input.locationCity ?? null,
      estimated_value: input.estimatedValue ?? null,
      deadline: input.deadline ?? null,
      notes: input.notes ?? null,
      evidence_url: input.evidenceUrl ?? null,
      assigned_owner_id: input.assignedOwnerId ?? uid,
      next_action: input.nextAction ?? null,
      follow_up_date: input.followUpDate ?? null,
      classification: inferred ?? "unclassified",
      // An item that classified itself is ready to convert, so it lands in the
      // same state a manual classify would have left it in.
      status: inferred ? "in_review" : "new",
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  await auditInbox("inbox_item.created", data.id, { ...data, auto_classified: inferred ?? null });
  return data;
}

export async function classifyInboxItem(id: Uuid, classification: InboxClassification) {
  // An already-converted item must not be silently re-classified.
  //
  // Field report, 2026-08-05 (Faisal): classified an item as RFQ, converted it,
  // then wanted it to be a Tender instead. Nothing stopped him — this function
  // reset `status` to 'in_review' unconditionally, and converting again
  // overwrote `converted_record_type`/`converted_record_id`. The rfqs row
  // created by the first conversion was left behind with nothing pointing at
  // it: a real record, owned by nobody, invisible from the inbox.
  //
  // Spec §40 is explicit that conversion must "preserve the original RFQ" and
  // "record who converted it" — silently orphaning it is the opposite. Blocking
  // here is deliberate: the safe correction path is to reopen the created
  // record and act on it (or archive the inbox item and start clean), not to
  // rewind a conversion that already produced downstream data.
  const { data: current, error: readErr } = await supabase
    .from("inbox_items")
    .select("status, converted_record_type, converted_record_id")
    .eq("id", id)
    .single();
  if (readErr) throw readErr;
  if (current?.status === "converted") {
    throw new Error(
      `This item was already converted to a ${humanizeRecordType(current.converted_record_type)}. ` +
        `Re-classifying would leave that record orphaned. Open the ${humanizeRecordType(current.converted_record_type)} ` +
        `and change it there, or archive this intake item and create a new one.`,
    );
  }

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

function humanizeRecordType(t: string | null | undefined): string {
  if (!t) return "record";
  return t === "rfq" ? "RFQ" : t.replace(/_/g, " ");
}

/**
 * Corrects an intake record that has not been converted yet.
 *
 * Until now an inbox_item was write-once: the only mutable fields were
 * `classification` and `status`. A mistyped project name, the wrong contractor,
 * a wrong deadline — none of it could be fixed, and neither could `project_type`.
 *
 * That last one is what Faisal actually ran into (2026-08-05). He asked to
 * change an item classified as RFQ into a Tender. Under spec §25.3 the
 * classification is derived from the form rather than chosen separately, so
 * "change it to Tender" means "change project_type on the intake record" — which
 * was impossible. This makes it possible, before conversion, which is the only
 * point where it is safe.
 *
 * After conversion the answer is no: downstream records exist, and spec §40
 * requires them to be preserved rather than silently detached.
 */
export async function updateInboxItem(
  id: Uuid,
  patch: Partial<{
    source_name: string | null;
    company_name: string | null;
    contact_name: string | null;
    phone: string | null;
    email: string | null;
    project_name: string | null;
    client_owner: string | null;
    main_contractor: string | null;
    consultant: string | null;
    scope: string | null;
    location: string | null;
    estimated_value: number | null;
    deadline: string | null;
    notes: string | null;
    evidence_url: string | null;
    next_action: string | null;
    follow_up_date: string | null;
    client_type: InboxClientType | null;
    project_type: InboxProjectType | null;
    rfq_from: InboxRfqFrom | null;
    // NOT NULL in the schema — correctable, but not clearable.
    date_received: string;
    scope_type: InboxScope | null;
    location_city: InboxLocation | null;
  }>,
) {
  const { data: current, error: readErr } = await supabase
    .from("inbox_items")
    .select("status, converted_record_type")
    .eq("id", id)
    .single();
  if (readErr) throw readErr;
  if (current?.status === "converted") {
    throw new Error(
      `This item was already converted to a ${humanizeRecordType(current.converted_record_type)}. ` +
        `Edit that record directly — changing the intake entry now would put the two out of sync.`,
    );
  }

  const { data, error } = await supabase
    .from("inbox_items")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await auditInbox("inbox_item.updated", id, { fields: Object.keys(patch) });
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
  // Defence in depth for spec §40 ("preserve the original"). classifyInboxItem
  // already refuses to re-open a converted item, but this is the write that
  // would actually detach the first record — guarding it here means no future
  // caller can orphan one by taking a different route in.
  const { data: current } = await supabase
    .from("inbox_items")
    .select("status, converted_record_type, converted_record_id")
    .eq("id", id)
    .single();
  if (current?.status === "converted" && current.converted_record_id) {
    throw new Error(
      `This item is already linked to a ${humanizeRecordType(current.converted_record_type)}. ` +
        `Converting again would leave that record orphaned.`,
    );
  }

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

/**
 * Resolves a free-text company name to an existing company id.
 *
 * Link-only, never create. Spec §25.14 sanctions "create or link the company
 * account", but the intake form captures these three as free text, so
 * auto-creating on every conversion would mint a company record for every
 * typo and abbreviation. Linking an exact match keeps the relationship when we
 * are certain, and leaves the field empty — visibly, on the project page — when
 * we are not.
 */
async function linkCompanyByName(name: string | null | undefined): Promise<Uuid | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const { data } = await supabase
    .from("companies")
    .select("id")
    .ilike("name", trimmed)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Creates a project carrying the intake record's data across.
 *
 * Field report, 2026-08-05 (Faisal): filled in the 19-field intake form,
 * converted to RFQ, was required to pick a project, used the inline "add new
 * project" shortcut — and the resulting project page was blank. The shortcut
 * (added in PR #167) only ever asked for a name and called
 * `createProject({ name })`, dropping every other field the user had already
 * typed one screen earlier.
 *
 * Spec §39 treats the project as the master record several bidder
 * opportunities hang off, so an empty one is not a cosmetic problem — it is
 * the anchor for everything downstream.
 *
 * `overrides` wins over the inbox item, so the caller can still let the user
 * correct the name before creating.
 */
export async function createProjectFromInboxItem(
  item: {
    project_name?: string | null;
    location?: string | null;
    location_city?: string | null;
    client_owner?: string | null;
    main_contractor?: string | null;
    consultant?: string | null;
    estimated_value?: number | null;
    scope?: string | null;
    scope_type?: string | null;
    source_name?: string | null;
  },
  overrides: { name?: string; location?: string } = {},
) {
  const [ownerCompanyId, mainContractorId, consultantId] = await Promise.all([
    linkCompanyByName(item.client_owner),
    linkCompanyByName(item.main_contractor),
    linkCompanyByName(item.consultant),
  ]);

  return await createProject({
    name: (overrides.name ?? item.project_name ?? "").trim(),
    // `location` is free text; `location_city` is the enum picker. Prefer what
    // the user typed, fall back to the picker.
    location: overrides.location ?? item.location ?? item.location_city ?? undefined,
    sector: item.scope_type ?? item.scope ?? undefined,
    ownerCompanyId,
    mainContractorId,
    consultantId,
    totalValue: item.estimated_value ?? null,
    source: item.source_name ?? undefined,
  });
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
