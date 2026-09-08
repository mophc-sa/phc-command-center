import { callBackend } from "./backend";
import type { DailySuggestion } from "../../supabase/functions/_shared/ai-daily";
import type { GroundedAnswer, AiCitation } from "../../supabase/functions/_shared/ai-grounding";
export type { DailySuggestion, GroundedAnswer, AiCitation };
export type DailyAssistantResult = {
  as_of: string;
  today: string;
  language: string;
  total_suggestions: number;
  scope: string;
  suggestions: DailySuggestion[];
};
export type GroundedResult = {
  result: GroundedAnswer;
  sources: AiCitation[];
  as_of: string;
  model?: string;
  traceId?: string;
};
export type KnowledgeSource = {
  id: string;
  source_type: string;
  source_id: string;
  title: string;
  content_hash: string;
  content?: string;
  status: string;
  is_current?: boolean;
  approved_at: string | null;
  indexed_at: string | null;
  chunk_count: number;
};
export type QualityRun = {
  id: string;
  case_key: string;
  language: string;
  model: string;
  status: string;
  checks: {
    numerical_accuracy: number;
    passed: boolean;
    citations_valid: boolean;
    abstention_correct: boolean;
  } | null;
  error_code: string | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  cost_basis: string | null;
  output: unknown;
  usefulness: number | null;
  review_note: string | null;
  created_at: string;
};
export type AiOperationsStatus = {
  as_of: string;
  sources: KnowledgeSource[];
  documents: { id: string; title: string | null; original_filename: string; mime_type: string }[];
  runs: QualityRun[];
  provider: { configured: boolean; provider?: string; model?: string };
  limits: { kind: string; daily_per_user: number; daily_global: number }[];
  usage: { kind: string; calls: number }[];
};
export const getDailyAssistant = (language: "ar" | "en") =>
  callBackend<DailyAssistantResult>("daily_assistant", { language });
export const getAiOperationsStatus = () =>
  callBackend<AiOperationsStatus>("ai_operations_status", {});
export const askCompanyKnowledge = (query: string, language: "ar" | "en") =>
  callBackend<GroundedResult>("ask_company_knowledge", { query, language });
export const prepareAiMeeting = (opportunityId: string, language: "ar" | "en") =>
  callBackend<GroundedResult>("prepare_ai_meeting", { opportunityId, language });
export const approveDailyTask = (suggestion: DailySuggestion, title: string, due: string | null) =>
  callBackend<{ task: { id: string }; replayed: boolean }>("approve_daily_task", {
    sourceType: suggestion.source_type,
    sourceId: suggestion.source_id,
    sourceUpdatedAt: suggestion.source_updated_at,
    title,
    due,
  });
export const getKnowledgeSource = (id: string) =>
  callBackend<{ source: KnowledgeSource }>("ai_knowledge_source_detail", { id });
export const prepareKnowledge = (sourceId: string, sourceType = "document") =>
  callBackend<{ source: KnowledgeSource }>("prepare_knowledge_source", { sourceId, sourceType });
export const reviewKnowledge = (source: KnowledgeSource, decision: "approve" | "revoke") =>
  callBackend<{ indexed: number }>("review_knowledge_source", {
    id: source.id,
    hash: source.content_hash,
    decision,
  });
export const publishKnowledge = (source: KnowledgeSource) =>
  callBackend<{ indexed: number }>("publish_knowledge_source", {
    id: source.id,
    hash: source.content_hash,
  });
export const reindexReferences = () =>
  callBackend<{ indexed: number; total: number; failed: { id: string; message: string }[] }>(
    "reindex_reference_library",
    {},
  );
export const runAiEvaluation = (caseKey: string, language: "ar" | "en", requestId: string) =>
  callBackend<{ runs: QualityRun[] }>("run_ai_evaluation", { caseKey, language, requestId });
export const reviewAiEvaluation = (id: string, usefulness: number, note: string) =>
  callBackend("review_ai_evaluation", { id, usefulness, note });
