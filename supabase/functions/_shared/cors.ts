// Shared CORS headers for PHC backend functions. Production is intentionally
// fail-closed to the canonical app origin. Preview/local environments must set
// CORS_ALLOWED_ORIGIN explicitly instead of widening access to every origin.
//
// WHY THIS BECAME AN ALLOWLIST
// ----------------------------
// The single-origin form worked, but nobody could exercise ai-orchestrator
// from a dev machine: the browser blocked the request before it left. That
// looked harmless — the Command Center reported "AI commentary unavailable" —
// and it hid a real, permanent orchestrator failure behind an identical
// message for the entire life of that feature. A path that cannot be exercised
// before production is a path that users verify for you.
//
// CORS_ALLOWED_ORIGIN now accepts a comma-separated list, so one environment
// can serve several known origins (local dev over http and https, a preview
// host). Never "*": these functions read an Authorization header, and a
// wildcard cannot carry credentials.
//
// PRODUCTION IS UNCHANGED. It sets no CORS_ALLOWED_ORIGIN, so the allowlist is
// exactly [https://agent.phc-sa.com] — the same single value this file has
// always emitted. Nothing here adds localhost to a deployed environment; local
// access comes from the local environment setting the variable itself
// (supabase/functions/.env.example).

const PRODUCTION_ORIGIN = "https://agent.phc-sa.com";

/** Parsed once. Empty config means production's single origin. */
export const ALLOWED_ORIGINS: readonly string[] = (() => {
  const configured = (Deno.env.get("CORS_ALLOWED_ORIGIN") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    // A wildcard is never a valid entry here, however it arrives.
    .filter((o) => o !== "*");
  return configured.length > 0 ? [...new Set(configured)] : [PRODUCTION_ORIGIN];
})();

/** The origin to echo back, or null when the caller is not on the allowlist. */
export function resolveAllowedOrigin(requestOrigin: string | null | undefined): string | null {
  if (!requestOrigin) return null;
  return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : null;
}

const BASE_HEADERS = {
  Vary: "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Headers for one request, echoing the caller's origin when it is allowed.
 *
 * Used on the preflight, which is where the browser actually decides. A caller
 * not on the list receives no Access-Control-Allow-Origin at all — the same
 * refusal every disallowed origin already got.
 */
export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = resolveAllowedOrigin(req.headers.get("Origin"));
  return origin ? { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin } : { ...BASE_HEADERS };
}

/**
 * Static headers for response bodies.
 *
 * Every environment that serves exactly one origin — production, and a dev
 * machine that set CORS_ALLOWED_ORIGIN to its own origin — gets the right
 * value here, which is why the 25 response sites behind respond.ts do not need
 * to thread a Request through.
 */
export const corsHeaders = {
  ...BASE_HEADERS,
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
};
