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
//   traceId -> authenticate -> validate request -> resolve agent -> role +
//   record access -> atomic request claim (if clientRequestId supplied) ->
//   insert "started" trace event (abort if this write fails) -> load minimal
//   context -> enforce context size (record count AND character length) ->
//   build prompt -> resolve provider config -> call provider -> validate
//   structured output -> guardrail scan -> insert ai_agent_outputs -> mark
//   claim succeeded + insert "succeeded" trace event (both checked — a
//   failure here returns AI_TRACE_PERSIST_FAILED, never a silent ok:true) ->
//   return safe envelope.
//
// On any failure: insert a failed/rejected/skipped trace event (and release
// the request claim so a legitimate retry isn't blocked), never a partial
// output row, and return only a stable error code + traceId — never a raw
// provider error, stack trace, SQL error, or secret.
//
// ai_agent_trace_events is an append-only event log (see the migration): each
// call inserts one row per state change under the same trace_id rather than
// mutating one row in place, so a crash mid-flow still leaves a truthful
// "started" record instead of an ambiguous gap.
//
// Concurrency: ai_agent_requests + claim_ai_agent_request() (both in the
// migration) are what actually prevent two simultaneous requests with the
// same idempotency key from both calling the provider — this file never
// relies on the ai_agent_outputs unique index alone for that (see
// docs/ai-orchestrator.md's "Concurrent request claiming" section).
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
  isContextTextWithinCharLimit,
  isOutputWithinSizeLimit,
  scanForGuardrailViolations,
  resolveMaxInputChars,
} from "../_shared/ai-guardrails.ts";
import { resolveProviderConfig, generateStructured } from "../_shared/ai-providers.ts";
import { PROMPT_VERSION } from "../_shared/ai-prompts.ts";
import { interpretClaimRpcResult, type ClaimRpcRow } from "../_shared/ai-idempotency.ts";

type Caller = { userId: string; roles: AppRole[] };
type ServiceClient = ReturnType<typeof serviceClient>;

function errorEnvelope(code: AiErrorCode, message: string, traceId: string | null, status: number, outputId?: string): Response {
  return json({ ok: false, code, message, traceId, ...(outputId ? { outputId } : {}) }, status);
}

// Returns whether the write actually succeeded — Required Fix 3: every trace
// write must be checked, never fired-and-forgotten. Logs (never throws) on
// failure so the caller can decide how to react (abort vs. best-effort log).
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
): Promise<{ ok: true } | { ok: false }> {
  const { error } = await svc.from("ai_agent_trace_events").insert({
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
  if (error) {
    console.error(`[ai-orchestrator] trace event insert failed (status=${params.status}, trace_id=${params.traceId}):`, error.message);
    return { ok: false };
  }
  return { ok: true };
}

// ---- Request claim (Required Fix 2) ----------------------------------------
// Thin wrapper around the claim_ai_agent_request() RPC (see the migration
// for the atomic INSERT/UPDATE logic) — only calls the RPC and hands its raw
// result to interpretClaimRpcResult() (ai-idempotency.ts), which carries the
// actual decision logic and is unit-tested independently (this file itself
// cannot be, being Deno-only). Only ever called when the caller supplied a
// clientRequestId — a request with no idempotency key is never
// claimed/deduplicated, matching the original opt-in design.
async function claimRequest(
  svc: ServiceClient,
  params: { requestedBy: string; agentKey: AgentKey; entityType: EntityType; entityId: string; clientRequestId: string; traceId: string },
) {
  const { data, error } = await svc.rpc("claim_ai_agent_request", {
    _requested_by: params.requestedBy,
    _agent_key: params.agentKey,
    _entity_type: params.entityType,
    _entity_id: params.entityId,
    _client_request_id: params.clientRequestId,
    _trace_id: params.traceId,
  });
  if (error) console.error("[ai-orchestrator] claim_ai_agent_request RPC failed:", error.message);
  const row = Array.isArray(data) ? (data[0] as ClaimRpcRow | undefined) : undefined;
  return interpretClaimRpcResult(row, Boolean(error));
}

async function markClaim(
  svc: ServiceClient,
  claimId: string,
  status: "succeeded" | "failed",
  extra?: { outputId?: string; errorCode?: string },
): Promise<{ ok: boolean }> {
  const { error } = await svc
    .from("ai_agent_requests")
    .update({ status, output_id: extra?.outputId ?? null, error_code: extra?.errorCode ?? null })
    .eq("id", claimId);
  if (error) {
    console.error(`[ai-orchestrator] claim ${claimId} status update to ${status} failed:`, error.message);
    return { ok: false };
  }
  return { ok: true };
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

  const maxInputChars = resolveMaxInputChars((key) => Deno.env.get(key));
  if (!isInputWithinLimit(request.input, maxInputChars)) {
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

  // ---- 5. Role + record access ----------------------------------------------
  if (!agentDef.hasRole(caller.roles)) {
    return errorEnvelope("AI_AGENT_NOT_ALLOWED", "Your role cannot run this agent.", traceId, 403);
  }
  const access = await agentDef.checkAccess(svc, entityType, entityId, caller.userId, caller.roles);
  if (!access.ok) {
    return errorEnvelope("AI_RECORD_ACCESS_DENIED", access.message, traceId, 403);
  }

  // ---- Atomic claim (Required Fix 1 + 2) -------------------------------------
  // Only attempted once the caller is known to be authorized — an
  // unauthorized request never creates a claim row at all. A matching prior
  // SUCCEEDED request (same requested_by + agent_key + entity_type +
  // entity_id + clientRequestId — entity-scoped, so reusing a
  // clientRequestId against a different entity can never match) returns the
  // existing output immediately; a matching IN-FLIGHT request returns a
  // controlled AI_REQUEST_IN_PROGRESS instead of allowing a second provider
  // call to start.
  let claimId: string | null = null;
  if (request.clientRequestId) {
    const claim = await claimRequest(svc, {
      requestedBy: caller.userId,
      agentKey: request.agent,
      entityType,
      entityId,
      clientRequestId: request.clientRequestId,
      traceId,
    });
    if (claim.kind === "duplicate_succeeded") {
      if (claim.outputId) {
        const { data: existing } = await svc
          .from("ai_agent_outputs")
          .select("id, trace_id, status, structured_output")
          .eq("id", claim.outputId)
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
      // Claim says succeeded but the output row couldn't be found — treat as
      // a persistence inconsistency rather than fabricating a response.
      return errorEnvelope("AI_TRACE_PERSIST_FAILED", "The previous result for this request could not be located.", traceId, 500);
    }
    if (claim.kind === "duplicate_processing") {
      return errorEnvelope("AI_REQUEST_IN_PROGRESS", "An identical request is already being processed.", traceId, 409);
    }
    if (claim.kind === "claim_error") {
      return errorEnvelope("AI_UNKNOWN_ERROR", "Could not process this request. Please try again.", traceId, 500);
    }
    claimId = claim.claimId;
  }

  const markClaimFailed = async (errorCode: string) => {
    if (claimId) await markClaim(svc, claimId, "failed", { errorCode });
  };

  // ---- 6. Insert started trace event -----------------------------------------
  // Required Fix 3: if this write fails, abort before context/provider —
  // there must never be a successful output with zero corresponding trace
  // rows at all.
  const startedTrace = await insertTraceEvent(svc, {
    traceId,
    requestedBy: caller.userId,
    agentKey: request.agent,
    entityType,
    entityId,
    status: "started",
    inputCharacterCount: JSON.stringify(request.input ?? {}).length,
    metadata: { promptVersion: PROMPT_VERSION },
  });
  if (!startedTrace.ok) {
    await markClaimFailed("AI_TRACE_PERSIST_FAILED");
    return errorEnvelope("AI_TRACE_PERSIST_FAILED", "Could not start request tracing.", traceId, 500);
  }

  const fail = async (code: AiErrorCode, message: string, status: number, extra?: Record<string, unknown>) => {
    await markClaimFailed(code);
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
    await markClaimFailed(code);
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
    await markClaimFailed(code);
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

  // ---- 8. Enforce context size — record count AND character length ------------
  // (Required Fix 4: record count alone previously let an oversized single
  // field slip through uncapped.)
  if (!isContextRecordCountWithinLimit(contextResult.recordCount, agentDef.maxContextRecords)) {
    return await fail("AI_CONTEXT_TOO_LARGE", "Too much context was loaded for this request.", 400, {
      recordCount: contextResult.recordCount,
    });
  }
  if (!isContextTextWithinCharLimit(contextResult.contextText)) {
    return await fail("AI_CONTEXT_TOO_LARGE", "The loaded context exceeded the maximum allowed size.", 400, {
      contextChars: contextResult.contextText.length,
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
  const outputId = (outputRow as { id: string }).id;

  // ---- 16. Mark claim succeeded + mark trace succeeded ---------------------------------------
  // Required Fix 3: the output already exists at this point and is NEVER
  // rolled back/deleted below, regardless of what happens next — it is
  // preserved for reconciliation (see docs/ai-orchestrator.md). Both writes
  // below are checked; if either fails, the caller is told explicitly
  // (AI_TRACE_PERSIST_FAILED, carrying outputId) rather than receiving a
  // silent ok:true that would hide an incomplete trace/claim record.
  const claimUpdate = claimId ? await markClaim(svc, claimId, "succeeded", { outputId }) : { ok: true };
  const succeededTrace = await insertTraceEvent(svc, {
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

  if (!succeededTrace.ok || !claimUpdate.ok) {
    console.error(
      `[ai-orchestrator] AI_TRACE_PERSIST_FAILED: output ${outputId} was persisted but the terminal trace/claim write failed (trace_id=${traceId}, agent=${request.agent}).`,
    );
    return errorEnvelope(
      "AI_TRACE_PERSIST_FAILED",
      "The recommendation was saved, but request tracking could not be finalized. Reference the traceId/outputId below for reconciliation.",
      traceId,
      500,
      outputId,
    );
  }

  // ---- 17. Return safe output envelope -------------------------------------------------------
  return json({
    ok: true,
    traceId,
    outputId,
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
