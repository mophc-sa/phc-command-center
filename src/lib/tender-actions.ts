import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";
import type { Database } from "@/integrations/supabase/types";

type Uuid = string;
export type TenderStage = Database["public"]["Enums"]["tender_stage"];

export const TENDER_STAGES: TenderStage[] = [
  "tender_identified", "tender_under_process", "tender_bafo", "award_negotiation",
  "awarded_to_contractor", "converted_to_jih", "tender_lost_or_archived",
];

const TENDER_TRANSITIONS: Record<string, TenderStage[]> = {
  tender_identified: ["tender_under_process", "tender_lost_or_archived"],
  tender_under_process: ["tender_bafo", "award_negotiation", "awarded_to_contractor", "tender_lost_or_archived"],
  tender_bafo: ["award_negotiation", "awarded_to_contractor", "tender_lost_or_archived"],
  award_negotiation: ["awarded_to_contractor", "tender_lost_or_archived"],
  awarded_to_contractor: ["converted_to_jih", "tender_lost_or_archived"],
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
