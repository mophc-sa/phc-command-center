import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";
import type { Database } from "@/integrations/supabase/types";

type Uuid = string;
export type TenderStage = Database["public"]["Enums"]["tender_stage"];

export const TENDER_STAGES: TenderStage[] = [
  "tender_identified", "tender_under_process", "award_negotiation",
  "awarded_to_contractor", "converted_to_jih", "tender_lost_or_archived",
];

// converted_to_jih is deliberately unreachable here — see advance_tender_stage
// in supabase/functions/sales-os-api/index.ts, which enforces the same
// omission server-side. Conversion only happens via requestTenderConversion
// (gated by evaluateConversion) + approveTenderConversion.
const TENDER_TRANSITIONS: Record<string, TenderStage[]> = {
  tender_identified: ["tender_under_process", "tender_lost_or_archived"],
  tender_under_process: ["award_negotiation", "awarded_to_contractor", "tender_lost_or_archived"],
  award_negotiation: ["awarded_to_contractor", "tender_lost_or_archived"],
  awarded_to_contractor: ["tender_lost_or_archived"],
  converted_to_jih: [],
  tender_lost_or_archived: [],
};
export function nextTenderStages(from: TenderStage): TenderStage[] {
  return TENDER_TRANSITIONS[from] ?? [];
}

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function createTender(input: {
  tenderName: string;
  source?: string;
  projectId?: Uuid | null;
  classification?: "A" | "B" | "C" | null;
  expectedAwardDate?: string | null;
  estimatedProjectValue?: number | null;
  signagePotential?: "high" | "medium" | "low" | null;
  claimOwner?: boolean;
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("tenders")
    .insert({
      tender_name: input.tenderName,
      source: input.source ?? null,
      project_id: input.projectId ?? null,
      tender_priority_classification: input.classification ?? null,
      expected_award_date: input.expectedAwardDate ?? null,
      estimated_project_value: input.estimatedProjectValue ?? null,
      signage_potential: input.signagePotential ?? null,
      tender_stage: "tender_identified",
      tender_owner_id: input.claimOwner ? uid : null,
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("audit_log").insert({
    actor_id: uid, actor_type: "user", action: "tender.created",
    entity_type: "tender", entity_id: data.id, after_value: data as never,
  });
  return data;
}

export async function addTenderContractor(input: {
  tenderId: Uuid;
  contractorCompanyId?: Uuid | null;
  contractorStatus?: string;
  winLikelihood?: "high" | "medium" | "low" | null;
  notes?: string;
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("tender_contractors")
    .insert({
      tender_id: input.tenderId,
      contractor_company_id: input.contractorCompanyId ?? null,
      contractor_status: input.contractorStatus ?? null,
      win_likelihood: input.winLikelihood ?? null,
      notes: input.notes ?? null,
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Sensitive tender transitions + conversion go through the backend.
export async function advanceTenderStage(input: {
  tenderId: Uuid;
  toStage: TenderStage;
  fields?: Record<string, unknown>;
}) {
  return await callBackend("advance_tender_stage", { ...input });
}

export type ConversionReviewInput = {
  project_stage_suitable?: boolean;
  package_not_closed?: boolean;
  estimated_signage_value?: number | null;
  contact_plan_ready?: boolean;
  main_contractor_confirmed?: boolean;
  signage_package_status?: string | null;
  signage_package_confidence?: string | null;
  conversion_reason?: string | null;
};

export async function requestTenderConversion(
  tenderId: Uuid,
  review?: ConversionReviewInput,
  notes?: string,
) {
  return await callBackend("request_tender_conversion", { tenderId, review, notes });
}

export async function approveTenderConversion(tenderId: Uuid, approvalId?: Uuid) {
  return await callBackend<{ opportunity: unknown }>("approve_tender_conversion", { tenderId, approvalId });
}

// ---- Non-sensitive tender edits ------------------------------------------
// These write directly (RLS already restricts to owner-or-manager, mirroring
// the "Tenders updatable by owner or manager" policy) rather than going
// through the backend gateway — same pattern as addTenderContractor above.
// Each still writes an audit_log row so every change is traceable.

async function auditTender(action: string, tenderId: Uuid, after: Record<string, unknown>) {
  const uid = await currentUserId();
  await supabase.from("audit_log").insert({
    actor_id: uid, actor_type: "user", action, entity_type: "tender", entity_id: tenderId, after_value: after as never,
  });
}

export async function updateTender(
  tenderId: Uuid,
  patch: Partial<{
    tenderName: string;
    source: string | null;
    projectId: Uuid | null;
    classification: "A" | "B" | "C" | null;
    expectedAwardDate: string | null;
    estimatedProjectValue: number | null;
    signagePotential: "high" | "medium" | "low" | null;
  }>,
) {
  const row: Record<string, unknown> = {};
  if (patch.tenderName !== undefined) row.tender_name = patch.tenderName;
  if (patch.source !== undefined) row.source = patch.source;
  if (patch.projectId !== undefined) row.project_id = patch.projectId;
  if (patch.classification !== undefined) row.tender_priority_classification = patch.classification;
  if (patch.expectedAwardDate !== undefined) row.expected_award_date = patch.expectedAwardDate;
  if (patch.estimatedProjectValue !== undefined) row.estimated_project_value = patch.estimatedProjectValue;
  if (patch.signagePotential !== undefined) row.signage_potential = patch.signagePotential;
  const { error } = await supabase.from("tenders").update(row as never).eq("id", tenderId);
  if (error) throw error;
  await auditTender("tender.edited", tenderId, row);
}

export async function assignTenderOwner(tenderId: Uuid, ownerId: Uuid | null) {
  const { error } = await supabase.from("tenders").update({ tender_owner_id: ownerId }).eq("id", tenderId);
  if (error) throw error;
  await auditTender("tender.owner_assigned", tenderId, { tender_owner_id: ownerId });
}

export async function setTenderFollowUp(tenderId: Uuid, followUpDate: string, notes?: string) {
  const { error } = await supabase.from("tenders").update({ next_follow_up_date: followUpDate }).eq("id", tenderId);
  if (error) throw error;
  await auditTender("tender.follow_up_set", tenderId, { next_follow_up_date: followUpDate, notes: notes ?? null });
}

export async function setTenderWatchlist(tenderId: Uuid, watchlisted: boolean) {
  const { error } = await supabase.from("tenders").update({ is_watchlisted: watchlisted } as never).eq("id", tenderId);
  if (error) throw error;
  await auditTender(watchlisted ? "tender.watchlisted" : "tender.unwatchlisted", tenderId, { is_watchlisted: watchlisted });
}

export async function addTenderEvidence(input: {
  tenderId: Uuid;
  evidenceType?: string;
  source?: string;
  note?: string;
  documentUrl?: string;
  dateReceived?: string | null;
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("award_evidence")
    .insert({
      linked_record_type: "tender",
      linked_record_id: input.tenderId,
      evidence_type: input.evidenceType ?? "tender_award",
      source: input.source ?? null,
      note: input.note ?? null,
      document_url: input.documentUrl ?? null,
      date_received: input.dateReceived ?? null,
      uploaded_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  await auditTender("tender.evidence_added", input.tenderId, { evidence_id: data.id });
  return data;
}

// ---- Conversion readiness (lightweight, client-side mirror) --------------
// Mirrors the gate fields evaluateConversion checks server-side
// (supabase/functions/_shared/conversion.ts) using only what's already
// persisted on the tenders row. Not a re-implementation of the value
// threshold/exception logic — just a glanceable readiness signal for the
// board; the real gate is always enforced server-side at request time.
const SUITABLE_PACKAGE_STATUSES = new Set(["confirmed", "likely", "open", "active", "suitable"]);

export type ConversionReadiness = { met: number; total: number; ready: boolean };

export function tenderConversionReadiness(t: {
  main_contractor_id?: string | null;
  project_stage_suitable?: boolean | null;
  package_not_closed?: boolean | null;
  contact_plan_ready?: boolean | null;
  main_contractor_confirmed?: boolean | null;
  signage_package_status?: string | null;
  conversion_reason?: string | null;
}): ConversionReadiness {
  const checks = [
    !!t.main_contractor_id,
    t.project_stage_suitable === true,
    t.package_not_closed === true,
    t.contact_plan_ready === true,
    t.main_contractor_confirmed === true || !!t.main_contractor_id,
    !!t.signage_package_status && SUITABLE_PACKAGE_STATUSES.has(t.signage_package_status),
    !!t.conversion_reason,
  ];
  const met = checks.filter(Boolean).length;
  return { met, total: checks.length, ready: met === checks.length };
}
