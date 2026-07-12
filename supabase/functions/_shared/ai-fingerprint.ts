// =============================================================================
// PHC Sales OS — Sprint 10: Safe AI Orchestrator — request fingerprinting
// (pure, no I/O).
//
// Computes a deterministic SHA-256 digest of the caller-controlled SEMANTIC
// content of a request — used by the orchestrator to detect when a reused
// idempotency key (requested_by + agent_key + entity_type + entity_id +
// client_request_id) is being replayed with genuinely different content,
// which the 5-field claim scope alone cannot see (see
// docs/ai-orchestrator.md's "Idempotency" section).
//
// Only two fields ever go into the fingerprint:
//   - input: the caller's free-form request.input object.
//   - provider: the EFFECTIVE provider override — null unless the caller is
//     both authorized to override the provider AND actually supplied one.
//     A non-admin caller's ignored `provider` value must never affect the
//     fingerprint (see resolveEffectiveProviderOverride below) — otherwise a
//     caller who cannot influence execution at all could still manufacture a
//     false conflict.
//
// Deliberately NEVER includes: requested_by, agent_key, entity_type,
// entity_id, client_request_id (already the claim scope — redundant to
// re-hash), secrets, JWTs, access tokens, API keys, timestamps, trace IDs,
// server-generated context, model responses, or provider credentials — none
// of these are ever passed into this module to begin with.
//
// The canonical JSON string used to produce the digest is intentionally
// never exposed by this module's public API — only the resulting hex digest
// is returned, and only the digest is ever meant to be persisted or compared
// (never the raw input, never the canonical string).
//
// Uses only the standard Web Crypto API (`crypto.subtle`), available as a
// global in both Deno (the Edge Function runtime) and Bun (`bun test`) — no
// dependency added for SHA-256.
// =============================================================================
import type { ProviderName } from "./ai-schemas.ts";

export type FingerprintSemantics = {
  input: unknown;
  providerOverride: ProviderName | null;
};

// Resolves the EFFECTIVE provider override for fingerprint purposes only —
// mirrors the same admin-gate expression resolveProviderConfig() applies
// internally (ai-providers.ts), but exposed here as a standalone value so
// index.ts can compute it once, before the claim, and reuse it both for the
// fingerprint and later for the real provider resolution. A requested
// provider from a non-admin caller is never honored server-side, so it must
// normalize to the same `null` as "no override supplied at all" — otherwise
// two requests that behave identically at runtime would fingerprint
// differently.
export function resolveEffectiveProviderOverride(
  requestedProvider: ProviderName | null | undefined,
  adminOverrideAllowed: boolean,
): ProviderName | null {
  return adminOverrideAllowed && requestedProvider ? requestedProvider : null;
}

// Recursively rebuilds a JSON-shaped value with object keys in sorted order
// and `undefined`-valued object properties omitted, so that two
// semantically-identical values with different key insertion order or
// incidental `undefined` properties always canonicalize to the same shape.
// Arrays keep their given order (order is caller-meaningful) but their
// elements are recursively canonicalized too. `null` is preserved as a
// distinct value, never conflated with "absent".
function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const fieldValue = source[key];
      if (fieldValue === undefined) continue; // omit undefined / absent optional fields
      result[key] = canonicalize(fieldValue);
    }
    return result;
  }
  return value; // string, number, boolean
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Public entry point: canonicalize -> serialize -> SHA-256 -> lowercase hex.
// Operates on the already-parsed request object (post req.json()), never on
// raw HTTP body bytes. Always returns a 64-character lowercase hex digest.
export async function computeRequestFingerprint(semantics: FingerprintSemantics): Promise<string> {
  const canonicalPayload = canonicalize({
    input: semantics.input ?? {},
    provider: semantics.providerOverride ?? null,
  });
  const canonicalJson = JSON.stringify(canonicalPayload);
  return sha256Hex(canonicalJson);
}
