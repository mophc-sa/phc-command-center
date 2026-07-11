// =============================================================================
// PHC Sales OS — Sprint 10: Safe AI Orchestrator
//
// The single public entry point for every AI agent in the system. Frontend
// and other clients call only this function — there is one Edge Function per
// SPRINT, not one per agent. Which agent runs, what context it may see, what
// role/ownership it requires, and what shape it must return are all resolved
// server-side from AGENT_REGISTRY (ai-agent-registry.ts); the request body
// only ever names an agent key, an entity, and a small bounded input object.
//
// Flow (see docs/ai-orchestrator.md for the full description):
//   traceId -> authenticate -> validate request -> resolve agent ->
//   idempotency check -> role + record access -> insert "started" trace event
//   -> load minimal context -> enforce context size -> build prompt ->
//   resolve provider config -> call provider -> validate structured output ->
//   guardrail scan -> insert ai_agent_outputs (pending_review) -> insert
//   "succeeded" trace event -> return safe envelope.
//
// On any failure: insert a failed/rejected/skipped trace event, never a
// partial output row, and return only a stable error code + traceId — never
// a raw provider error, stack trace, SQL error, or secret.
//
// ai_agent_trace_events is an append-only event log (see the migration): each
// call inserts one row per state change under the same trace_id rather than
// mutating one row in place, so a crash mid-flow still leaves a truthful
// "started" record instead of an ambiguous gap.
// =============================================================================
import { corsHeaders } from "../_shared/cors.ts";
import { json, err } from "../_shared/respond.ts";
import { resolveCaller, serviceClient, type AppRole } from "../_shared/supabase.ts";
import { isSystemAdmin } from "../_shared/roles.ts";
import { OrchestratorRequestSchema, type AiErrorCode, type AgentKey, type EntityType } from "../_shared/ai-schemas.ts";
import { AGENT_REGISTRY } from "../_shared/ai-agent-registry.ts";
import {
  isAllowedAgent,
  isEntityAllowedForAgent,
  isInputWithinLimit,
  isContextRecordCountWithinLimit,
  isOutputWithinSizeLimit,
  scanForGuardrailViolations,
  DEFAULT_MAX_INPUT_CHARS,
} from "../_shared/ai-guardrails.ts";
import { resolveProviderConfig, generateStructured } from "../_shared/ai-providers.ts";
import { PROMPT_VERSION } from "../_shared/ai-prompts.ts";

type Caller = { userId: string; roles: AppRole[] };
type ServiceClient = ReturnType<typeof serviceClient>;

function errorEnvelope(code: AiErrorCode, message: string, traceId: string | null, status: number): Response {
  return json({ ok: false, code, message, traceId }, status);
}

async function insertTraceEvent(
  svc: ServiceClient,
  params: {
    traceId: string;
    requestedBy: string;
    agentKey: AgentKey;
    provider?: string | null;
    model?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    status: "started" | "succeeded" | "failed" | "rejected" | "skipped";
    errorCode?: string | null;
    errorMessage?: string | null;
    durationMs?: number | null;
    inputCharacterCount?: number | null;
    outputCharacterCount?: number | null;
    inputTokenCount?: number | null;
    outputTokenCount?: number | null;
    contextManifest?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await svc.from("ai_agent_trace_events").insert({
    trace_id: params.traceId,
    requested_by: params.requestedBy,
    agent_key: params.agentKey,
    provider: params.provider ?? null,
    model: params.model ?? null,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    status: params.status,
    error_code: params.errorCode ?? null,
    error_message: params.errorMessage ?? null,
    duration_ms: params.durationMs ?? null,
    input_character_count: params.inputCharacterCount ?? null,
    output_character_count: params.outputCharacterCount ?? null,
    input_token_count: params.inputTokenCount ?? null,
    output_token_count: params.outputTokenCount ?? null,
    context_manifest: params.contextManifest ?? {},
    metadata: params.metadata ?? {},
  });
}

async function handleRequest(req: Request): Promise<Response> {
  const traceId = crypto.randomUUID();
  const startedAt = Date.now();

  // ---- 2. Authenticate ----------------------------------------------------
  let caller: Caller;
  try {
    caller = await resolveCaller(req.headers.get("Authorization"));
  } catch {
    // Deliberately generic — never confirm/deny *why* auth failed.
    return errorEnvelope("AI_UNAUTHENTICATED", "Authentication is required.", null, 401);
  }

  const svc = serviceClient();

  // ---- 3. Parse and validate request ---------------------------------------
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorEnvelope("AI_INPUT_INVALID", "Request body must be valid JSON.", traceId, 400);
  }
  const parsed = OrchestratorRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorEnvelope("AI_INPUT_INVALID", "Request did not match the required shape.", traceId, 400);
  }
  const request = parsed.data;

  // ---- 4. Resolve agent from registry --------------------------------------
  if (!isAllowedAgent(request.agent)) {
    return errorEnvelope("AI_AGENT_NOT_ALLOWED", "Unknown agent.", traceId, 400);
  }
  const agentDef = AGENT_REGISTRY[request.agent];

  if (!isInputWithinLimit(request.input, DEFAULT_MAX_INPUT_CHARS)) {
    return errorEnvelope("AI_INPUT_INVALID", "Request input exceeds the maximum allowed size.", traceId, 400);
  }

  // entityType/entityId are required for every agent in this sprint.
  if (!request.entityType || !request.entityId) {
    return errorEnvelope("AI_INPUT_INVALID", "entityType and entityId are required.", traceId, 400);
  }
  if (!isEntityAllowedForAgent(request.agent, request.entityType)) {
    return errorEnvelope("AI_ENTITY_NOT_ALLOWED", "This agent does not accept that entity type.", traceId, 400);
  }
  const entityType = request.entityType as EntityType;
  const entityId = request.entityId;

  // ---- Idempotency: a matching prior output short-circuits everything below
  // — no re-validation, no new trace event, no provider call. -----------------
  if (request.clientRequestId) {
    const { data: existing } = await svc
      .from("ai_agent_outputs")
      .select("id, trace_id, status, structured_output")
      .eq("requested_by", caller.userId)
      .eq("agent_key", request.agent)
      .eq("client_request_id", request.clientRequestId)
      .maybeSingle();
    if (existing) {
      return json({
        ok: true,
        traceId: existing.trace_id,
        outputId: existing.id,
        agent: request.agent,
        status: existing.status,
        result: existing.structured_output,
      });
    }
  }

  // ---- 5. Role + record access ----------------------------------------------
  if (!agentDef.hasRole(caller.roles)) {
    return errorEnvelope("AI_AGENT_NOT_ALLOWED", "Your role cannot run this agent.", traceId, 403);
  }
  const access = await agentDef.checkAccess(svc, entityType, entityId, caller.userId, caller.roles);
  if (!access.ok) {
    return errorEnvelope("AI_RECORD_ACCESS_DENIED", access.message, traceId, 403);
  }

  // ---- 6. Insert started trace event -----------------------------------------
  await insertTraceEvent(svc, {
    traceId,
    requestedBy: caller.userId,
    agentKey: request.agent,
    entityType,
    entityId,
    status: "started",
    inputCharacterCount: JSON.stringify(request.input ?? {}).length,
    metadata: { promptVersion: PROMPT_VERSION },
  });

  const fail = async (code: AiErrorCode, message: string, status: number, extra?: Record<string, unknown>) => {
    await insertTraceEvent(svc, {
      traceId,
      requestedBy: caller.userId,
      agentKey: request.agent,
      entityType,
      entityId,
      status: "failed",
      errorCode: code,
      errorMessage: message,
      durationMs: Date.now() - startedAt,
      metadata: { promptVersion: PROMPT_VERSION, ...extra },
    });
    return errorEnvelope(code, message, traceId, status);
  };

  const skip = async (code: AiErrorCode, message: string, status: number) => {
    await insertTraceEvent(svc, {
      traceId,
      requestedBy: caller.userId,
      agentKey: request.agent,
      entityType,
      entityId,
      status: "skipped",
      errorCode: code,
      errorMessage: message,
      durationMs: Date.now() - startedAt,
      metadata: { promptVersion: PROMPT_VERSION },
    });
    return errorEnvelope(code, message, traceId, status);
  };

  const reject = async (code: AiErrorCode, message: string, status: number, extra?: Record<string, unknown>) => {
    await insertTraceEvent(svc, {
      traceId,
      requestedBy: caller.userId,
      agentKey: request.agent,
      entityType,
      entityId,
      status: "rejected",
      errorCode: code,
      errorMessage: message,
      durationMs: Date.now() - startedAt,
      metadata: { promptVersion: PROMPT_VERSION, ...extra },
    });
    return errorEnvelope(code, message, traceId, status);
  };

  // ---- 7. Load minimal context ------------------------------------------------
  const contextResult = await agentDef.loadContext(svc, entityType, entityId, request.input as Record<string, unknown>);
  if (!contextResult.ok) {
    return await fail(contextResult.code, contextResult.message, 400);
  }

  // ---- 8. Enforce context size --------------------------------------------------
  if (!isContextRecordCountWithinLimit(contextResult.recordCount, agentDef.maxContextRecords)) {
    return await fail("AI_CONTEXT_TOO_LARGE", "Too much context was loaded for this request.", 400, {
      recordCount: contextResult.recordCount,
    });
  }

  // ---- 9. Build prompt -------------------------------------------------------------
  const prompt = agentDef.buildPrompt(contextResult.contextText);

  // ---- 10. Resolve configured provider -----------------------------------------------
  // Provider override is only honored for system_admin — every other
  // caller's `provider` field is ignored (server-side config decides), not
  // merely rejected.
  const adminOverrideAllowed = isSystemAdmin(caller.roles);
  const providerResolution = resolveProviderConfig((key) => Deno.env.get(key), request.provider ?? null, adminOverrideAllowed);
  if (!providerResolution.ok) {
    // Both failure reasons (unsupported provider, missing key/model) map to
    // the same caller-facing "not configured" outcome — the specific reason
    // is never named to the caller, only recorded in the trace event.
    return await skip("AI_NOT_CONFIGURED", "AI service is not configured.", 200);
  }
  const { config } = providerResolution;

  // ---- 11 & 12. Call provider with timeout, parse response ----------------------------
  const providerResult = await generateStructured(config, {
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schemaName: prompt.schemaName,
    traceId,
  });
  if (!providerResult.ok) {
    return await fail(providerResult.code, "The AI provider could not complete this request.", 502, {
      provider: config.provider,
      model: config.model,
    });
  }

  // ---- 13. Validate structured output ---------------------------------------------------
  const validation = agentDef.outputSchema.safeParse(providerResult.data);
  if (!validation.success) {
    return await fail("AI_OUTPUT_VALIDATION_FAILED", "The AI provider's response did not match the required format.", 502, {
      provider: config.provider,
      model: config.model,
      // Redacted summary only — never the raw provider text or full zod issues.
      issueCount: validation.error.issues.length,
    });
  }
  const structuredOutput = validation.data as Record<string, unknown>;

  // ---- 14. Apply output guardrails -------------------------------------------------------
  if (!isOutputWithinSizeLimit(structuredOutput)) {
    return await reject("AI_GUARDRAIL_REJECTED", "The AI provider's response exceeded the maximum allowed size.", 502);
  }
  const findings = scanForGuardrailViolations(structuredOutput);
  if (findings.length > 0) {
    return await reject("AI_GUARDRAIL_REJECTED", "The AI provider's response was rejected by a safety guardrail.", 502, {
      provider: config.provider,
      model: config.model,
      findingKinds: findings.map((f) => f.kind),
    });
  }

  // ---- 15. Insert ai_agent_outputs (pending_review) ----------------------------------------
  const outputCharacterCount = JSON.stringify(structuredOutput).length;
  const rationale = typeof structuredOutput.rationale === "string" ? structuredOutput.rationale : null;
  const { data: outputRow, error: outputError } = await svc
    .from("ai_agent_outputs")
    .insert({
      trace_id: traceId,
      agent_key: request.agent,
      output_type: agentDef.outputType,
      entity_type: entityType,
      entity_id: entityId,
      requested_by: caller.userId,
      status: "pending_review",
      structured_output: structuredOutput,
      summary: rationale ? rationale.slice(0, 300) : null,
      client_request_id: request.clientRequestId ?? null,
    })
    .select("id")
    .single();

  if (outputError || !outputRow) {
    return await fail("AI_OUTPUT_PERSIST_FAILED", "The recommendation could not be saved.", 500, {
      provider: config.provider,
      model: config.model,
    });
  }

  // ---- 16. Mark trace succeeded -------------------------------------------------------------
  await insertTraceEvent(svc, {
    traceId,
    requestedBy: caller.userId,
    agentKey: request.agent,
    provider: config.provider,
    model: config.model,
    entityType,
    entityId,
    status: "succeeded",
    durationMs: Date.now() - startedAt,
    inputCharacterCount: prompt.userPrompt.length,
    outputCharacterCount,
    inputTokenCount: providerResult.usage?.inputTokens ?? null,
    outputTokenCount: providerResult.usage?.outputTokens ?? null,
    contextManifest: contextResult.manifest,
    metadata: { promptVersion: PROMPT_VERSION },
  });

  // ---- 17. Return safe output envelope -------------------------------------------------------
  return json({
    ok: true,
    traceId,
    outputId: (outputRow as { id: string }).id,
    agent: request.agent,
    status: "pending_review",
    result: structuredOutput,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed", 405);
  try {
    return await handleRequest(req);
  } catch {
    // Last-resort catch: never leak a raw error/stack to the caller.
    return errorEnvelope("AI_UNKNOWN_ERROR", "An unexpected error occurred.", null, 500);
  }
});
