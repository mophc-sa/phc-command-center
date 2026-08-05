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
import { createRfq, createRfqWithOpportunity } from "@/lib/rfq-actions";
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

export type IntakeRouteResult =
  | { routed: "rfq"; inboxItemId: Uuid; opportunityId: Uuid; rfqId: Uuid }
  | { routed: "tender"; inboxItemId: Uuid; tenderId: Uuid }
  | { routed: "none"; inboxItemId: Uuid };

/**
 * One form, one save, routed onto the right track.
 *
 * This is the whole of spec §25 behind a single submit: the form is saved, the
 * classification is derived from it (§25.3, see D8), and the item is carried
 * straight onto its track — RFQ → opportunity in the pipeline (§25.2, §25.10),
 * or Tender → the monitoring board (§3, §27).
 *
 * Requested directly by the user on 2026-08-05, after Faisal's report: one
 * intake form that decides for itself, rather than a second "New RFQ" form
 * beside it and a manual classify/convert pair behind it. Two forms covering
 * the same ground was the worse answer — see D11.
 *
 * `routed: "none"` is not a failure. An item with no project type, or no
 * project name, cannot be routed confidently — it stays in the inbox as
 * `unclassified` for manual triage, which is what the classify step is
 * genuinely for: market signals, incomplete captures, duplicates, and items
 * that turn out to be a company or a contact.
 *
 * Routing failure does not lose the capture. If the conversion throws, the
 * inbox item is already saved; the error propagates so the caller can report
 * it, and the item is left for manual conversion rather than being rolled back.
 */
export async function createInboxItemAndRoute(input: InboxItemInput): Promise<IntakeRouteResult> {
  const item = await createInboxItem(input);
  const classification = item.classification as InboxClassification;

  if (classification === "rfq") {
    const res = await convertInboxToRfq(item.id, {});
    return { routed: "rfq", inboxItemId: item.id, opportunityId: res.opportunityId, rfqId: res.rfqId };
  }

  if (classification === "tender") {
    const tender = await convertInboxToTender(item.id, {});
    return { routed: "tender", inboxItemId: item.id, tenderId: tender.id };
  }

  return { routed: "none", inboxItemId: item.id };
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

/**
 * The `project` classification — a genuine market/reference project record,
 * not a sales deal. Unlike the RFQ path, this one is *meant* to create a
 * project, because the intake item genuinely described one.
 *
 * Fields the dialog does not ask for (sector, source) are carried across from
 * the intake record rather than dropped; anything the dialog does ask for wins,
 * since the user has just confirmed it against real company pickers.
 */
export async function convertInboxToProject(id: Uuid, input: {
  name: string; location?: string; ownerCompanyId?: Uuid | null; mainContractorId?: Uuid | null;
  consultantId?: Uuid | null; totalValue?: number | null; projectStage?: ProjectStage; source?: string;
}) {
  const { data: item } = await supabase
    .from("inbox_items")
    .select("scope, scope_type, source_name, location, location_city")
    .eq("id", id)
    .single();

  const project = await createProject({
    ...input,
    location: input.location ?? item?.location ?? item?.location_city ?? undefined,
    sector: item?.scope_type ?? item?.scope ?? undefined,
    source: input.source ?? item?.source_name ?? undefined,
  });
  await markConverted(id, "project", project.id);
  return project;
}

/**
 * Converts an intake item onto the JIH track: opportunity first, RFQ attached.
 *
 * This used to call `createRfq` and stop. The result was that classify+convert
 * produced an RFQ row and *nothing else* — no opportunity, so nothing appeared
 * in Pipeline → Opportunities, and there was no record to advance through
 * stages. The only thing the user could see afterwards was whatever project the
 * convert dialog had made them create, which is how a sales enquiry ended up
 * presenting as a Production project (field report, 2026-08-05, second round).
 *
 * Spec §25 is explicit that saving an RFQ must "create the opportunity" (2) and
 * "add the opportunity to the correct pipeline" (10). §29 puts project creation
 * at the *other* end of the lifecycle, under Awarded: "create project
 * handover". The repo already implements that end correctly — the
 * `create_project_from_won_opportunity` trigger builds the Production project
 * when an opportunity reaches `won`.
 *
 * There was also a second, quieter harm in forcing a project here: that trigger
 * only fires `WHEN NEW.project_id IS NULL`. An opportunity that was handed a
 * project at intake therefore never gets its proper post-award project — the
 * premature one silently takes its place.
 *
 * `projectId` stays supported but optional, for the §39 case where several
 * bidders are priced against one existing master project.
 */
export async function convertInboxToRfq(id: Uuid, input: {
  rfqNumber?: string; sourceType?: string; projectId?: Uuid | null; companyId?: Uuid | null;
  contactId?: Uuid | null; responseDueDate?: string | null; estimatedValue?: number | null; claimOwner?: boolean;
}) {
  const { data: item, error: readErr } = await supabase
    .from("inbox_items")
    .select("*")
    .eq("id", id)
    .single();
  if (readErr) throw readErr;

  const result = await createRfqWithOpportunity({
    companyName: item.company_name ?? "",
    contactName: item.contact_name ?? "",
    contactPhone: item.phone ?? "",
    existingCompanyId: input.companyId ?? null,
    existingContactId: input.contactId ?? null,
    projectScope: item.project_name?.trim() || item.project_number || "RFQ Opportunity",
    location: item.location ?? item.location_city ?? null,
    // The dialog's deadline wins; the intake deadline is the fallback. If
    // neither exists we still need a date for the follow-up cadence, so use
    // today rather than failing the conversion outright.
    responseDueDate: input.responseDueDate ?? item.deadline ?? new Date().toISOString().slice(0, 10),
    // §25.3 — carried from the intake form, not asked again. See D8.
    opportunityType: item.project_type === "tender" ? "tender" : "jih",
    sourceType: item.source_type ?? null,
    documentUrl: item.evidence_url ?? null,
    projectId: input.projectId ?? null,
    estimatedValue: input.estimatedValue ?? item.estimated_value ?? null,
  });

  // Point the intake item at the opportunity: that is the record the user
  // should open and work, not the RFQ document behind it.
  await markConverted(id, "opportunity", result.opportunityId);
  return result;
}

/**
 * Converts an intake item onto the tender-monitoring track.
 *
 * Every argument is optional now, so the caller can hand over just the id and
 * let the intake record supply the rest — the same shape as the RFQ path. That
 * is what lets a single form route itself without a second dialog.
 *
 * A tender deliberately does NOT create an opportunity. Spec §3 keeps the two
 * tracks apart until the main contract is awarded, and §27 says a tender "must
 * not be counted in the JIH pipeline until converted". The opportunity is
 * created later, by the Tender → JIH conversion (§40).
 */
export async function convertInboxToTender(id: Uuid, input: {
  tenderName?: string; source?: string; projectId?: Uuid | null; classification?: "A" | "B" | "C" | null;
  expectedAwardDate?: string | null; estimatedProjectValue?: number | null; claimOwner?: boolean;
} = {}) {
  const { data: item, error: readErr } = await supabase
    .from("inbox_items")
    .select("project_name, project_number, source_name, deadline, estimated_value")
    .eq("id", id)
    .single();
  if (readErr) throw readErr;

  const tender = await createTender({
    ...input,
    tenderName:
      input.tenderName?.trim() || item?.project_name?.trim() || item?.project_number || "Tender",
    source: input.source ?? item?.source_name ?? undefined,
    expectedAwardDate: input.expectedAwardDate ?? item?.deadline ?? null,
    estimatedProjectValue: input.estimatedProjectValue ?? item?.estimated_value ?? null,
    claimOwner: input.claimOwner ?? true,
  });
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
