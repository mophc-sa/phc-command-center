// =============================================================================
// PHC Sales OS — privileged server-key resolver (pure, no I/O).
//
// Background: a legacy JWT-based service_role API key was exposed inside a
// Claude tool result during Sprint 10 live UAT (see the exposure assessment).
// Supabase now issues new-format opaque secret keys (`sb_secret_...`) via the
// platform-injected SUPABASE_SECRET_KEYS env var — a JSON dictionary keyed by
// name, normally containing a "default" entry. This module is the single
// place that decides which key value a privileged server client should use,
// so no individual consumer (Edge Function or SSR admin client) duplicates
// this parsing/precedence logic.
//
// Precedence:
//   1. SUPABASE_SECRET_KEYS["default"] — preferred. If this env var is
//      present at all, it is authoritative: any problem with it (malformed
//      JSON, empty dictionary, missing "default" key, wrong prefix) is a
//      hard configuration error, never a silent fall-through to the legacy
//      key — an operator who explicitly set this var deserves a clear error,
//      not a masked misconfiguration.
//   2. SUPABASE_SERVICE_ROLE_KEY — temporary migration fallback, used only
//      when SUPABASE_SECRET_KEYS is not set at all. This covers two real
//      deployments: Edge Functions before the platform has propagated the
//      new variable, and the Cloudflare-deployed SSR admin client, which has
//      no natural way to receive a Supabase-specific JSON dictionary at all
//      (Cloudflare Worker secrets are flat name/value pairs) — for that
//      environment this fallback IS the primary path, and its value may
//      legitimately be either the legacy JWT or an operator-pasted
//      `sb_secret_...` value; this resolver accepts either without requiring
//      Cloudflare to adopt a JSON-dictionary format it has no natural notion
//      of. This fallback is deliberately temporary/deprecated — see
//      docs/ai-orchestrator.md and docs/deployment-governance.md.
//
// No key-name selector beyond "default" exists — no such configuration
// convention exists anywhere else in this codebase, so none is invented here.
//
// Never logs the dictionary or any key value; every error path returns a
// stable, non-secret reason code and a generic message — the raw
// SUPABASE_SECRET_KEYS content and the resolved key value are never included
// in a thrown error or a return value beyond the single `key` field callers
// must already treat as sensitive (matching how SUPABASE_SERVICE_ROLE_KEY
// itself was already handled before this change).
// =============================================================================

export type EnvReader = (key: string) => string | undefined;

const DEFAULT_SECRET_KEY_NAME = "default";
const NEW_SECRET_KEY_PREFIX = "sb_secret_";

export type ResolveServiceKeyReason =
  | "malformed_secret_keys_json"
  | "empty_secret_keys_dictionary"
  | "missing_named_key"
  | "invalid_key_format"
  | "not_configured";

export type ResolveServiceKeyResult =
  | { ok: true; key: string; source: "sb_secret_keys" | "legacy_service_role" }
  | { ok: false; reason: ResolveServiceKeyReason };

// Stable, non-secret message per reason — safe to surface in a thrown Error
// or a log line. Never includes the dictionary content or any key value.
export function describeResolveServiceKeyReason(reason: ResolveServiceKeyReason): string {
  switch (reason) {
    case "malformed_secret_keys_json":
      return "SUPABASE_SECRET_KEYS is set but is not valid JSON.";
    case "empty_secret_keys_dictionary":
      return "SUPABASE_SECRET_KEYS is set but contains no keys.";
    case "missing_named_key":
      return `SUPABASE_SECRET_KEYS is set but has no "${DEFAULT_SECRET_KEY_NAME}" entry.`;
    case "invalid_key_format":
      return `The resolved server key does not have the expected "${NEW_SECRET_KEY_PREFIX}" prefix.`;
    case "not_configured":
      return "Neither SUPABASE_SECRET_KEYS nor SUPABASE_SERVICE_ROLE_KEY is configured.";
  }
}

export function resolveServiceKey(env: EnvReader): ResolveServiceKeyResult {
  const rawSecretKeys = env("SUPABASE_SECRET_KEYS");

  // SUPABASE_SECRET_KEYS present at all -> authoritative. Any problem with
  // it is a hard error; it never silently falls through to the legacy key.
  if (rawSecretKeys !== undefined && rawSecretKeys !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawSecretKeys);
    } catch {
      return { ok: false, reason: "malformed_secret_keys_json" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: "malformed_secret_keys_json" };
    }
    const dict = parsed as Record<string, unknown>;
    if (Object.keys(dict).length === 0) {
      return { ok: false, reason: "empty_secret_keys_dictionary" };
    }
    if (!(DEFAULT_SECRET_KEY_NAME in dict)) {
      return { ok: false, reason: "missing_named_key" };
    }
    const selected = dict[DEFAULT_SECRET_KEY_NAME];
    if (typeof selected !== "string" || !selected.startsWith(NEW_SECRET_KEY_PREFIX)) {
      // Also covers a publishable key (or any other non-sb_secret_ value)
      // being present under "default" — never permitted for admin/service use.
      return { ok: false, reason: "invalid_key_format" };
    }
    return { ok: true, key: selected, source: "sb_secret_keys" };
  }

  // Temporary migration fallback — deprecated. Accepts either the legacy JWT
  // or an operator-pasted sb_secret_ value, since a flat single-variable
  // environment (Cloudflare Workers) cannot express which format it holds
  // without inspecting the value itself, and both are valid Supabase API
  // keys for this purpose.
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) {
    return { ok: true, key: legacy, source: "legacy_service_role" };
  }

  return { ok: false, reason: "not_configured" };
}
