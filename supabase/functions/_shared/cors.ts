// Shared CORS headers for PHC backend functions. Production is intentionally
// fail-closed to the canonical app origin. Preview/local environments must set
// CORS_ALLOWED_ORIGIN explicitly instead of widening access to every origin.
const allowedOrigin = Deno.env.get("CORS_ALLOWED_ORIGIN")?.trim() || "https://agent.phc-sa.com";

export const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  Vary: "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
