import { callBackend } from "@/lib/backend";
import { supabase } from "@/integrations/supabase/client";

type Uuid = string;

// The 4 agents whose outputs get a review action in the "AI Outputs" tab.
// The other 10 (import-pipeline) agents already have their own dedicated
// review/commit flow in data-import.$batchId.tsx against separate tables —
// deliberately not wired to this action.
export const REVIEWABLE_AGENT_KEYS = [
  "opportunity_evaluation",
  "smart_followup_draft",
  "project_radar",
  "risk_finance",
] as const;

export type AiAgentOutputRow = {
  id: Uuid;
  agent_key: string;
  status: string;
  entity_type: string | null;
  entity_id: Uuid | null;
  summary: string | null;
  created_at: string;
  output_type: string;
  client_request_id: string | null;
  reviewed_by: Uuid | null;
  reviewed_at: string | null;
  review_decision: string | null;
  // Only populated by getLatestAgentOutput() below — agent-activity.tsx's
  // list query deliberately omits this column (not needed for the flat
  // "AI Outputs" tab, and it can be large).
  structured_output?: Record<string, unknown>;
};

export async function reviewAgentOutput(input: {
  outputId: Uuid;
  decision: "accepted" | "rejected";
}): Promise<AiAgentOutputRow> {
  const res = await callBackend<{ output: AiAgentOutputRow }>("review_ai_agent_output", {
    outputId: input.outputId,
    decision: input.decision,
  });
  return res.output;
}

/**
 * Most recent ai_agent_outputs row for one agent against one entity — lets a
 * detail page (e.g. the opportunity page's Risk Assessment / Opportunity
 * Evaluation panels) show that run's review status in context, instead of
 * only via the global "AI Outputs" tab in agent-activity.tsx. Plain SELECT:
 * RLS already scopes this to the requester (while they still own the
 * entity) or a commercial manager — no backend round-trip needed for a read.
 */
export async function getLatestAgentOutput(
  entityType: string,
  entityId: Uuid,
  agentKey: string,
): Promise<AiAgentOutputRow | null> {
  const { data, error } = await supabase
    .from("ai_agent_outputs")
    .select("id, agent_key, status, entity_type, entity_id, summary, created_at, output_type, client_request_id, reviewed_by, reviewed_at, review_decision, structured_output")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("agent_key", agentKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as AiAgentOutputRow | null;
}
