import { callBackend } from "@/lib/backend";

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
