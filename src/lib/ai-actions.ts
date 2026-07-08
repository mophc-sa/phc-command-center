import { supabase } from "@/integrations/supabase/client";
import { callBackend } from "@/lib/backend";

// The AI tables are newer than the generated Database types; query them through
// an untyped view of the client and re-type locally at this boundary.
const db = supabase as unknown as {
  from: (t: string) => any;
};

export type AiRecommendation = {
  id: string;
  agent_key: string;
  title: string;
  recommendation: string;
  rationale: string | null;
  confidence: number | null;
  severity: string | null;
  status: string;
  entity_type: string | null;
  entity_id: string | null;
  suggested_action: string | null;
  required_approval_type: string | null;
  missing_data: string[] | null;
  generated_by: string;
  created_at: string;
};

export type AiEvidenceItem = {
  id: string;
  recommendation_id: string;
  label: string;
  field: string | null;
  value: string | null;
  source_type: string | null;
  source_ref: string | null;
  source_url: string | null;
  weight: number | null;
};

export type AiAgentRun = {
  id: string;
  agent_key: string;
  status: string;
  records_scanned: number;
  recommendations_created: number;
  summary: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

export type FeedbackAction = "accept" | "dismiss" | "request_review" | "create_task" | "create_approval";

// ---- The AI Evidence Panel view-model (pure — unit tested) ------------------
export type EvidencePanel = {
  title: string;
  confidence: number | null;
  reasonCodes: string[];
  fieldsUsed: string[];
  sources: { label: string; ref: string | null; url: string | null }[];
  missingData: string[];
  generatedBy: string;
  timestamp: string;
  requiresApproval: boolean;
};

export function buildEvidencePanel(rec: AiRecommendation, evidence: AiEvidenceItem[]): EvidencePanel {
  const reasonCodes = (rec.rationale ?? "")
    .replace(/^Reason codes:\s*/i, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    title: rec.title,
    confidence: rec.confidence,
    reasonCodes,
    fieldsUsed: [...new Set(evidence.map((e) => e.field).filter((f): f is string => !!f))],
    sources: evidence.map((e) => ({ label: e.label, ref: e.source_ref, url: e.source_url })),
    missingData: rec.missing_data ?? [],
    generatedBy: rec.generated_by,
    timestamp: rec.created_at,
    requiresApproval: !!rec.required_approval_type,
  };
}

// ---- Queries ----------------------------------------------------------------
export async function listRecommendations(status = "pending"): Promise<AiRecommendation[]> {
  const { data, error } = await db
    .from("ai_recommendations")
    .select("*")
    .eq("status", status)
    .order("confidence", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AiRecommendation[];
}

export async function listEvidence(recommendationId: string): Promise<AiEvidenceItem[]> {
  const { data, error } = await db
    .from("ai_evidence_items")
    .select("*")
    .eq("recommendation_id", recommendationId);
  if (error) throw error;
  return (data ?? []) as AiEvidenceItem[];
}

export async function listAgentRuns(): Promise<AiAgentRun[]> {
  const { data, error } = await db
    .from("ai_agent_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as AiAgentRun[];
}

// ---- Backend actions (all server-enforced) ----------------------------------
export const runLeadScoring = () => callBackend("run_lead_scoring", {});
export const runDuplicateDetection = () => callBackend("run_duplicate_detection", {});
export const generateWeeklyReport = () => callBackend<{ report: Record<string, number> }>("generate_ai_weekly_report", {});

export function sendRecommendationFeedback(recommendationId: string, action: FeedbackAction, note?: string) {
  return callBackend("ai_recommendation_feedback", { recommendationId, action, note });
}

// Honest scaffolds — return { configured: false } when the dependency is missing.
export const AGENT_ACTIONS: Record<string, string> = {
  data_cleanup: "run_data_cleanup",
  project_radar: "run_project_radar",
  protenders_ingest: "run_protenders_ingest",
  boq_extraction: "run_boq_extraction",
  contact_mapping: "run_contact_mapping",
  risk_finance: "run_risk_finance",
  smart_followup: "run_smart_followup",
};

export function runAgent(action: string) {
  return callBackend<{ configured?: boolean; status?: string; detail?: string }>(action, {});
}
