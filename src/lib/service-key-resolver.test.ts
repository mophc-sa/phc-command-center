// Tests for the privileged server-key resolver (service-key-resolver.ts).
// Pure function tests only — no live Supabase/network calls, no secrets used
// (every value below is a fixture string shaped like a key, never a real
// one). Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  resolveServiceKey,
  describeResolveServiceKeyReason,
  type EnvReader,
} from "../../supabase/functions/_shared/service-key-resolver";

function makeEnv(vars: Record<string, string>): EnvReader {
  return (key: string) => vars[key];
}

// ---------------------------------------------------------------------------
// 1-2. New-format key preferred and resolved correctly
// ---------------------------------------------------------------------------

test("resolveServiceKey resolves SUPABASE_SECRET_KEYS['default'] successfully when valid", () => {
  const env = makeEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_fixture123" }) });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: true, key: "sb_secret_fixture123", source: "sb_secret_keys" });
});

test("resolveServiceKey prefers the new-format key over the legacy key when both are present", () => {
  const env = makeEnv({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_fixture123" }),
    SUPABASE_SERVICE_ROLE_KEY: "legacy.jwt.fixture",
  });
  const result = resolveServiceKey(env);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.source).toBe("sb_secret_keys");
    expect(result.key).toBe("sb_secret_fixture123");
  }
});

// ---------------------------------------------------------------------------
// 3-5. SUPABASE_SECRET_KEYS present but invalid — hard error, never falls
// through to the legacy key even when one is also configured.
// ---------------------------------------------------------------------------

test("resolveServiceKey rejects malformed JSON in SUPABASE_SECRET_KEYS, even with a legacy key present", () => {
  const env = makeEnv({ SUPABASE_SECRET_KEYS: "{not valid json", SUPABASE_SERVICE_ROLE_KEY: "legacy.jwt.fixture" });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: false, reason: "malformed_secret_keys_json" });
});

test("resolveServiceKey rejects an empty SUPABASE_SECRET_KEYS dictionary, even with a legacy key present", () => {
  const env = makeEnv({ SUPABASE_SECRET_KEYS: "{}", SUPABASE_SERVICE_ROLE_KEY: "legacy.jwt.fixture" });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: false, reason: "empty_secret_keys_dictionary" });
});

test("resolveServiceKey rejects a SUPABASE_SECRET_KEYS dictionary missing the 'default' entry, even with a legacy key present", () => {
  const env = makeEnv({
    SUPABASE_SECRET_KEYS: JSON.stringify({ other_name: "sb_secret_fixture123" }),
    SUPABASE_SERVICE_ROLE_KEY: "legacy.jwt.fixture",
  });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: false, reason: "missing_named_key" });
});

// ---------------------------------------------------------------------------
// 6-7. Never permit a publishable key or arbitrary value for admin/service use
// ---------------------------------------------------------------------------

test("resolveServiceKey rejects a publishable key under 'default' — never allowed for admin/service use", () => {
  const env = makeEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_publishable_fixture123" }) });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: false, reason: "invalid_key_format" });
});

test("resolveServiceKey rejects an arbitrary non-key value under 'default'", () => {
  const env = makeEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "not-a-key-at-all" }) });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: false, reason: "invalid_key_format" });
});

test("resolveServiceKey rejects a non-string value under 'default'", () => {
  const env = makeEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: 12345 }) });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: false, reason: "invalid_key_format" });
});

test("resolveServiceKey rejects SUPABASE_SECRET_KEYS that parses to a JSON array, not an object", () => {
  const env = makeEnv({ SUPABASE_SECRET_KEYS: JSON.stringify(["sb_secret_fixture123"]) });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: false, reason: "malformed_secret_keys_json" });
});

// ---------------------------------------------------------------------------
// 8. Legacy fallback — temporary, only when SUPABASE_SECRET_KEYS is entirely absent
// ---------------------------------------------------------------------------

test("resolveServiceKey falls back to SUPABASE_SERVICE_ROLE_KEY only when SUPABASE_SECRET_KEYS is not set at all", () => {
  const env = makeEnv({ SUPABASE_SERVICE_ROLE_KEY: "legacy.jwt.fixture" });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: true, key: "legacy.jwt.fixture", source: "legacy_service_role" });
});

test("resolveServiceKey's legacy fallback accepts an operator-pasted sb_secret_ value too (Cloudflare has no JSON-dictionary notion)", () => {
  const env = makeEnv({ SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture123" });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: true, key: "sb_secret_fixture123", source: "legacy_service_role" });
});

test("resolveServiceKey treats an empty-string SUPABASE_SECRET_KEYS the same as unset, falling back to legacy", () => {
  const env = makeEnv({ SUPABASE_SECRET_KEYS: "", SUPABASE_SERVICE_ROLE_KEY: "legacy.jwt.fixture" });
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: true, key: "legacy.jwt.fixture", source: "legacy_service_role" });
});

// ---------------------------------------------------------------------------
// 9. Neither configured -> safe configuration error
// ---------------------------------------------------------------------------

test("resolveServiceKey produces a safe 'not_configured' error when neither variable is set", () => {
  const env = makeEnv({});
  const result = resolveServiceKey(env);
  expect(result).toEqual({ ok: false, reason: "not_configured" });
});

// ---------------------------------------------------------------------------
// 10. No error/description ever contains a key value or the raw dictionary
// ---------------------------------------------------------------------------

test("describeResolveServiceKeyReason never echoes an actual key value or raw dictionary content for any reason code", () => {
  // The "sb_secret_" PREFIX is a public, documented constant — safe and
  // expected to appear in a message explaining the required format. What
  // must never appear is an actual fixture VALUE or raw JSON content.
  const reasons = [
    "malformed_secret_keys_json",
    "empty_secret_keys_dictionary",
    "missing_named_key",
    "invalid_key_format",
    "not_configured",
  ] as const;
  const secretLikeFragments = ["sb_secret_fixture123", "sb_publishable_fixture123", "eyJ", "legacy.jwt.fixture", "{", "}"];
  for (const reason of reasons) {
    const message = describeResolveServiceKeyReason(reason);
    for (const fragment of secretLikeFragments) {
      expect(message).not.toContain(fragment);
    }
  }
});

test("no failure result ever carries a 'key' field", () => {
  const env = makeEnv({ SUPABASE_SECRET_KEYS: "{not valid json" });
  const result = resolveServiceKey(env);
  expect(result.ok).toBe(false);
  expect("key" in result).toBe(false);
});
