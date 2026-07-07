import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { callBackend } from "@/lib/backend";

type Uuid = string;
export type LeadStage = Database["public"]["Enums"]["lead_stage"];

// The linear qualification flow (6.10). A lead advances one step at a time.
export const LEAD_STAGES: LeadStage[] = [
  "detected",
  "duplicate_check",
  "research",
  "contractor_identification",
  "project_stage_check",
  "signage_assessment",
  "value_estimate",
  "scored",
  "human_review",
  "converted",
  "rejected",
];

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function audit(action: string, entityId: Uuid, after?: unknown) {
  const actor = await currentUserId();
  await supabase.from("audit_log").insert({
    actor_id: actor,
    actor_type: "user",
    action,
    entity_type: "lead",
    entity_id: entityId,
    after_value: (after ?? null) as never,
  });
}

export async function createLead(input: {
  projectName: string;
  source?: string;
  sourceUrl?: string;
  location?: string;
  mainContractorGuess?: string;
  estimatedValue?: number | null;
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("leads")
    .insert({
      project_name: input.projectName,
      source: input.source ?? "manual",
      source_url: input.sourceUrl ?? null,
      location: input.location ?? null,
      main_contractor_guess: input.mainContractorGuess ?? null,
      estimated_value: input.estimatedValue ?? null,
      lead_stage: "detected",
      owner_id: uid,
      created_by: uid,
    })
    .select()
    .single();
  if (error) throw error;
  await audit("lead.created", data.id, data);
  return data;
}

export async function advanceLeadStage(id: Uuid, stage: LeadStage, patch?: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("leads")
    .update({ lead_stage: stage, ...(patch ?? {}) })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await audit("lead.stage_changed", id, { stage });
  return data;
}

export async function rejectLead(id: Uuid, reason: string) {
  const { data, error } = await supabase
    .from("leads")
    .update({ lead_stage: "rejected", rejection_reason: reason })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await audit("lead.rejected", id, { reason });
  return data;
}

// Human-gated conversion: only from human_review or scored. Enforced by the
// backend layer, which validates the lead stage, creates the opportunity, and
// marks the lead converted server-side.
export async function convertLeadToOpportunity(lead: { id: Uuid }) {
  const res = await callBackend<{ opportunity: unknown }>("convert_lead", { leadId: lead.id });
  return res.opportunity;
}
