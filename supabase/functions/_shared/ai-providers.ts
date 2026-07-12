// =============================================================================
// PHC Sales OS — Sprint 10: Safe AI Orchestrator — provider abstraction.
//
// Provider-neutral interface: the orchestrator and agents call
// generateStructured() and only ever see AiProviderResult, never an
// OpenAI-shaped or Anthropic-shaped response. Provider selection reads
// server-side configuration only (env vars, injected via an EnvReader
// function rather than calling Deno.env directly in this module) — the
// frontend request schema (ai-schemas.ts) has no field that can influence
// which provider, model, or endpoint is used beyond the restricted
// `provider` override, which the orchestrator only honors for callers
// already confirmed to hold an administrative role.
//
// This module never touches Deno.env or Deno-specific globals directly, so
// it stays importable/testable from `bun test ./src`
// (see src/lib/ai-providers.test.ts) — env resolution is dependency-injected
// via EnvReader, and the actual network call is dependency-injected via
// FetchLike, so both can be swapped for fakes in tests. No live provider
// call is ever made from a test.
// =============================================================================
import type { ProviderName } from "./ai-schemas.ts";

export type EnvReader = (key: string) => string | undefined;
export type FetchLike = typeof fetch;

export type ProviderConfig = {
  provider: ProviderName;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

const SUPPORTED_PROVIDERS: readonly ProviderName[] = ["openai", "anthropic"];
const DEFAULT_TIMEOUT_MS = 20000;
// Required Fix 9: AI_REQUEST_TIMEOUT_MS must be bounded, not just "any
// positive number." Too low would abort every real provider call before it
// could ever finish; too high would let a single request hold an Edge
// Function instance (and a caller's HTTP connection) open indefinitely,
// which is exactly the "unlimited or absurdly high timeout" this fix
// prohibits regardless of what the platform's own execution ceiling is.
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 60000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1500;
const DEFAULT_TEMPERATURE = 0.2;

export type ResolveProviderConfigResult =
  | { ok: true; config: ProviderConfig }
  | { ok: false; reason: "unsupported_provider" }
  | { ok: false; reason: "not_configured"; provider: ProviderName };

// Reads AI_PROVIDER / <PROVIDER>_API_KEY / <PROVIDER>_MODEL / AI_REQUEST_TIMEOUT_MS
// via the injected EnvReader. `requestedProvider` is only honored when
// `adminOverrideAllowed` is true — the caller (index.ts) is responsible for
// deciding that from the authenticated user's roles before this is ever
// called with a non-null requestedProvider.
//
// Deliberately does NOT fall back to a hardcoded default model: this repo
// has no existing documented "default LLM model" convention, so an unset
// <PROVIDER>_MODEL is treated the same as an unset API key — both mean "not
// configured" rather than silently picking a model nobody chose.
export function resolveProviderConfig(
  env: EnvReader,
  requestedProvider: ProviderName | null | undefined,
  adminOverrideAllowed: boolean,
): ResolveProviderConfigResult {
  const configuredDefault = env("AI_PROVIDER");
  const effectiveProvider: string =
    (requestedProvider && adminOverrideAllowed ? requestedProvider : undefined) ?? configuredDefault ?? "openai";

  if (!SUPPORTED_PROVIDERS.includes(effectiveProvider as ProviderName)) {
    return { ok: false, reason: "unsupported_provider" };
  }
  const provider = effectiveProvider as ProviderName;

  const apiKey = provider === "openai" ? env("OPENAI_API_KEY") : env("ANTHROPIC_API_KEY");
  const model = provider === "openai" ? env("OPENAI_MODEL") : env("ANTHROPIC_MODEL");
  if (!apiKey || !model) {
    return { ok: false, reason: "not_configured", provider };
  }

  const timeoutRaw = env("AI_REQUEST_TIMEOUT_MS");
  const parsedTimeout = timeoutRaw ? Number(timeoutRaw) : NaN;
  const timeoutInBounds = Number.isFinite(parsedTimeout) && parsedTimeout >= MIN_TIMEOUT_MS && parsedTimeout <= MAX_TIMEOUT_MS;
  const timeoutMs = timeoutInBounds ? parsedTimeout : DEFAULT_TIMEOUT_MS;

  return { ok: true, config: { provider, apiKey, model, timeoutMs } };
}

// ---------------------------------------------------------------------------
// Neutral result envelope
// ---------------------------------------------------------------------------

export type AiProviderResult<T> =
  | { ok: true; data: T; model: string; usage?: { inputTokens?: number; outputTokens?: number } }
  | { ok: false; code: "AI_PROVIDER_TIMEOUT" | "AI_PROVIDER_ERROR" | "AI_RESPONSE_PARSE_FAILED"; message: string };

export type GenerateStructuredInput = {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  traceId: string;
  temperature?: number;
  maxOutputTokens?: number;
};

// Providers occasionally wrap JSON in a markdown fence despite instructions
// not to — strip one defensively before parsing. This never loosens
// validation: whatever comes out still goes through the agent's zod schema
// in the orchestrator before it is trusted.
function stripMarkdownFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
}

function parseJsonResult(rawText: string, model: string, usage?: { inputTokens?: number; outputTokens?: number }): AiProviderResult<unknown> {
  try {
    const data = JSON.parse(stripMarkdownFence(rawText));
    return { ok: true, data, model, usage };
  } catch {
    return { ok: false, code: "AI_RESPONSE_PARSE_FAILED", message: "Provider response was not valid JSON." };
  }
}

async function callOpenAi(
  config: ProviderConfig,
  input: GenerateStructuredInput,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: input.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`openai_http_${res.status}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("openai_empty_response");
  return {
    text,
    usage: { inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens },
  };
}

async function callAnthropic(
  config: ProviderConfig,
  input: GenerateStructuredInput,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: config.model,
      system: input.systemPrompt,
      messages: [{ role: "user", content: input.userPrompt }],
      max_tokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      temperature: input.temperature ?? DEFAULT_TEMPERATURE,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`anthropic_http_${res.status}`);
  const body = (await res.json()) as {
    content?: { type?: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = body.content?.find((c) => c.type === "text")?.text ?? body.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("anthropic_empty_response");
  return {
    text,
    usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens },
  };
}

// Single entry point the orchestrator calls. Never throws — every failure
// mode (timeout, HTTP error, empty response, unparsable JSON) resolves to an
// AiProviderResult with a stable code, never a raw error/stack/provider body.
// At most one attempt is made; there is no retry loop (the sprint brief
// permits "at most one carefully bounded retry only if justified and
// documented" — a single provider call already has its own bounded timeout,
// and retrying a timed-out or erroring LLM call risks doubling latency and
// cost for a request whose caller is already waiting synchronously, with no
// clear benefit over surfacing the failure and letting the human retry
// deliberately, so this sprint does not add one).
export async function generateStructured(
  config: ProviderConfig,
  input: GenerateStructuredInput,
  fetchImpl: FetchLike = fetch,
): Promise<AiProviderResult<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const { text, usage } =
      config.provider === "openai"
        ? await callOpenAi(config, input, fetchImpl, controller.signal)
        : await callAnthropic(config, input, fetchImpl, controller.signal);
    return parseJsonResult(text, config.model, usage);
  } catch (e) {
    if (controller.signal.aborted) {
      return { ok: false, code: "AI_PROVIDER_TIMEOUT", message: "Provider request timed out." };
    }
    return { ok: false, code: "AI_PROVIDER_ERROR", message: "Provider request failed." };
  } finally {
    clearTimeout(timer);
  }
}
