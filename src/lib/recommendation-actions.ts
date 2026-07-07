import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";

type Uuid = string;

// The 10 AI modules (section 9). Agents run externally and write via the MCP
// server / service_role; the app only reads, accepts, or dismisses.
export const AI_MODULES = [
  "data_cleanup",
  "project_radar",
  "lead_qualification",
  "boq_intelligence",
  "contact_mapping",
  "project_stage",
  "follow_up",
  "risk_finance",
  "reporting",
  "knowledge_search",
] as const;

// The 9 approval types (section 11).
export const APPROVAL_TYPES = [
  "lead",
  "outreach",
  "boq",
  "quotation",
  "discount",
  "tender",
  "contract",
  "won_lost",
  "account_ownership",
] as const;

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
    entity_type: "recommendation",
    entity_id: entityId,
    after_value: (after ?? null) as never,
  });
}

export async function dismissRecommendation(id: Uuid) {
  const { error } = await supabase.from("recommendations").update({ status: "dismissed" }).eq("id", id);
  if (error) throw error;
  await audit("recommendation.dismissed", id);
}

// Accepting a recommendation records the human decision and, when the
// recommendation names a required approval on an opportunity, opens the matching
// approval request. Routed through the backend layer — AI never acts directly,
// this is the human-in-the-loop step.
export async function acceptRecommendation(rec: { id: Uuid }) {
  await callBackend("accept_recommendation", { recommendationId: rec.id });
}
