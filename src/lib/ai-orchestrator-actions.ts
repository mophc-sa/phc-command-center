import { supabase } from "@/integrations/supabase/client";
import type { AgentKey, EntityType, ProviderName } from "../../supabase/functions/_shared/ai-schemas";

export type { AgentKey, EntityType, ProviderName };

export type OrchestratorSuccess = {
  ok: true;
  traceId: string;
  outputId: string;
  agent: AgentKey;
  status: string;
  result: Record<string, unknown>;
};
export type OrchestratorFailure = { ok: false; code: string; message: string; traceId: string | null };
export type OrchestratorResult = OrchestratorSuccess | OrchestratorFailure;

// The one and only frontend entry point to the AI orchestrator. Mirrors
// ai-schemas.ts's `.strict()` OrchestratorRequestSchema exactly — do not add
// fields here beyond what that schema accepts. There is deliberately no
// `model`, `systemPrompt`, `template`, or provider-URL parameter: the caller
// only ever names an agent, a target record, and a small bounded input
// object. `provider` is always sent as null — an override is only ever
// honored server-side for administrative callers, so ordinary UI code has no
// reason to set it.
//
// This function only stages a recommendation/draft for human review — it
// never applies, sends, approves, or deletes anything. There is no
// "auto-apply" path anywhere in this module.
export async function runAiAgent(params: {
  agent: AgentKey;
  entityType: EntityType;
  entityId: string;
  input?: Record<string, unknown>;
  clientRequestId?: string;
}): Promise<OrchestratorResult> {
  const { data, error } = await supabase.functions.invoke("ai-orchestrator", {
    body: {
      agent: params.agent,
      entityType: params.entityType,
      entityId: params.entityId,
      input: params.input ?? {},
      provider: null,
      ...(params.clientRequestId ? { clientRequestId: params.clientRequestId } : {}),
    },
  });

  if (error) {
    let message = error.message;
    let code = "AI_UNKNOWN_ERROR";
    let traceId: string | null = null;
    try {
      const ctx = (error as { context?: Response }).context;
      const parsed = ctx ? await ctx.json() : null;
      if (parsed?.message) message = parsed.message;
      if (parsed?.code) code = parsed.code;
      if (parsed?.traceId) traceId = parsed.traceId ?? null;
    } catch {
      /* keep the generic message */
    }
    return { ok: false, code, message, traceId };
  }

  return data as OrchestratorResult;
}
