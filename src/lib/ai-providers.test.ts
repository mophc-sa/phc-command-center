// PHC Sales OS — Sprint 10 Safe AI Orchestrator: provider abstraction tests.
// No live provider calls are made — every fetch is a mock. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  resolveProviderConfig,
  generateStructured,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  type ProviderConfig,
  type FetchLike,
  type EnvReader,
} from "../../supabase/functions/_shared/ai-providers";

function makeEnv(vars: Record<string, string>): EnvReader {
  return (key: string) => vars[key];
}

// ---------------------------------------------------------------------------
// resolveProviderConfig — provider selection, missing-key fallback,
// unsupported provider, admin override restriction.
// ---------------------------------------------------------------------------

test("resolveProviderConfig picks the configured default provider when none is requested", () => {
  const env = makeEnv({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-x" });
  const r = resolveProviderConfig(env, null, false);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.config.provider).toBe("anthropic");
});

test("resolveProviderConfig defaults to openai when AI_PROVIDER is unset", () => {
  const env = makeEnv({ OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-x" });
  const r = resolveProviderConfig(env, null, false);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.config.provider).toBe("openai");
});

test("resolveProviderConfig: missing API key produces a 'not_configured' result, not a thrown error", () => {
  const env = makeEnv({ AI_PROVIDER: "openai", OPENAI_MODEL: "gpt-x" }); // no OPENAI_API_KEY
  const r = resolveProviderConfig(env, null, false);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("not_configured");
});

test("resolveProviderConfig: missing model produces 'not_configured' too (no hardcoded model fallback)", () => {
  const env = makeEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k" }); // no OPENAI_MODEL
  const r = resolveProviderConfig(env, null, false);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("not_configured");
});

test("resolveProviderConfig rejects an unsupported provider name from AI_PROVIDER", () => {
  const env = makeEnv({ AI_PROVIDER: "mistral" });
  const r = resolveProviderConfig(env, null, false);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("unsupported_provider");
});

test("resolveProviderConfig ignores a requested provider override for a non-admin caller", () => {
  const env = makeEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-x", ANTHROPIC_API_KEY: "k2", ANTHROPIC_MODEL: "claude-x" });
  const r = resolveProviderConfig(env, "anthropic", /* adminOverrideAllowed */ false);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.config.provider).toBe("openai"); // override ignored, not honored
});

test("resolveProviderConfig honors a requested provider override for an admin caller", () => {
  const env = makeEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-x", ANTHROPIC_API_KEY: "k2", ANTHROPIC_MODEL: "claude-x" });
  const r = resolveProviderConfig(env, "anthropic", /* adminOverrideAllowed */ true);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.config.provider).toBe("anthropic");
});

test("resolveProviderConfig falls back to the default timeout when AI_REQUEST_TIMEOUT_MS is unset or invalid", () => {
  const env = makeEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-x" });
  const r = resolveProviderConfig(env, null, false);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.config.timeoutMs).toBeGreaterThan(0);
});

// Required Fix 9: bounded timeout configuration — no unlimited/absurd value.
test("resolveProviderConfig accepts a timeout within bounds", () => {
  const env = makeEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-x", AI_REQUEST_TIMEOUT_MS: "5000" });
  const r = resolveProviderConfig(env, null, false);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.config.timeoutMs).toBe(5000);
});

test("resolveProviderConfig rejects a timeout below the safe minimum and falls back to default", () => {
  const env = makeEnv({
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "k",
    OPENAI_MODEL: "gpt-x",
    AI_REQUEST_TIMEOUT_MS: String(MIN_TIMEOUT_MS - 1),
  });
  const r = resolveProviderConfig(env, null, false);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.config.timeoutMs).not.toBe(MIN_TIMEOUT_MS - 1);
});

test("resolveProviderConfig rejects an absurdly high timeout and falls back to default rather than allowing it unbounded", () => {
  const env = makeEnv({
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "k",
    OPENAI_MODEL: "gpt-x",
    AI_REQUEST_TIMEOUT_MS: "999999999",
  });
  const r = resolveProviderConfig(env, null, false);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.config.timeoutMs).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
    expect(r.config.timeoutMs).not.toBe(999999999);
  }
});

test("resolveProviderConfig accepts the exact min/max boundary timeout values", () => {
  const envMin = makeEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-x", AI_REQUEST_TIMEOUT_MS: String(MIN_TIMEOUT_MS) });
  const envMax = makeEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-x", AI_REQUEST_TIMEOUT_MS: String(MAX_TIMEOUT_MS) });
  const rMin = resolveProviderConfig(envMin, null, false);
  const rMax = resolveProviderConfig(envMax, null, false);
  expect(rMin.ok && rMin.config.timeoutMs).toBe(MIN_TIMEOUT_MS);
  expect(rMax.ok && rMax.config.timeoutMs).toBe(MAX_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// generateStructured — conversion of provider-specific responses into the
// neutral AiProviderResult shape, timeout mapping, invalid JSON handling.
// ---------------------------------------------------------------------------

const baseInput = { systemPrompt: "sys", userPrompt: "user", schemaName: "test_schema", traceId: "trace-1" };

function config(provider: "openai" | "anthropic", timeoutMs = 5000): ProviderConfig {
  return { provider, apiKey: "test-key", model: "test-model", timeoutMs };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

test("generateStructured (openai): converts a chat-completions response into the neutral result shape", async () => {
  const fetchImpl: FetchLike = (() =>
    Promise.resolve(
      jsonResponse({
        choices: [{ message: { content: JSON.stringify({ hello: "world" }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    )) as unknown as FetchLike;
  const result = await generateStructured(config("openai"), baseInput, fetchImpl);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data).toEqual({ hello: "world" });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  }
});

test("generateStructured (anthropic): converts a messages-API response into the neutral result shape", async () => {
  const fetchImpl: FetchLike = (() =>
    Promise.resolve(
      jsonResponse({
        content: [{ type: "text", text: JSON.stringify({ ok_field: 1 }) }],
        usage: { input_tokens: 8, output_tokens: 3 },
      }),
    )) as unknown as FetchLike;
  const result = await generateStructured(config("anthropic"), baseInput, fetchImpl);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data).toEqual({ ok_field: 1 });
    expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 3 });
  }
});

test("generateStructured strips a markdown JSON fence before parsing", async () => {
  const fetchImpl: FetchLike = (() =>
    Promise.resolve(jsonResponse({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }))) as unknown as FetchLike;
  const result = await generateStructured(config("openai"), baseInput, fetchImpl);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.data).toEqual({ a: 1 });
});

test("generateStructured maps invalid JSON in the response to AI_RESPONSE_PARSE_FAILED", async () => {
  const fetchImpl: FetchLike = (() =>
    Promise.resolve(jsonResponse({ choices: [{ message: { content: "Sure! The answer is 42." } }] }))) as unknown as FetchLike;
  const result = await generateStructured(config("openai"), baseInput, fetchImpl);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe("AI_RESPONSE_PARSE_FAILED");
});

test("generateStructured maps a non-ok HTTP response to AI_PROVIDER_ERROR without leaking the response body", async () => {
  const fetchImpl: FetchLike = (() =>
    Promise.resolve(jsonResponse({ error: { message: "invalid_api_key: sk-secret-leak-value" } }, false, 401))) as unknown as FetchLike;
  const result = await generateStructured(config("openai"), baseInput, fetchImpl);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe("AI_PROVIDER_ERROR");
    expect(result.message).not.toContain("sk-secret-leak-value");
  }
});

test("generateStructured maps an aborted/timed-out request to AI_PROVIDER_TIMEOUT", async () => {
  const fetchImpl: FetchLike = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as unknown as FetchLike;
  const result = await generateStructured(config("openai", 20), baseInput, fetchImpl);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe("AI_PROVIDER_TIMEOUT");
});

test("generateStructured never throws — a fetch-level network error still resolves to AI_PROVIDER_ERROR", async () => {
  const fetchImpl: FetchLike = (() => Promise.reject(new Error("network down"))) as unknown as FetchLike;
  const result = await generateStructured(config("openai"), baseInput, fetchImpl);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe("AI_PROVIDER_ERROR");
});
