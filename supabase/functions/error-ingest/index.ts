// =============================================================================
// error-ingest — browser error ingestion endpoint
//
// Receives scrubbed error payloads from src/lib/error-reporting.ts and stores
// them in public.client_errors for system_admin review.
//
// Auth: no user JWT required (errors may occur before login). Requests must
// carry the anon key as the `apikey` header to pass Supabase's gateway.
//
// Rate-limiting: not implemented here — rely on Supabase's built-in function
// invocation limits. Add an explicit rate-limit if abuse is observed.
// =============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

// ---------------------------------------------------------------------------
// Per-IP rate limiting — 50 requests / minute per source IP.
// Module-level Map is best-effort: state resets on cold start, but is shared
// across all requests in the same warm isolate, which covers most burst cases.
// ---------------------------------------------------------------------------
interface IpEntry { count: number; resetAt: number; }
const ipCounts = new Map<string, IpEntry>();
const IP_LIMIT = 50;
const WINDOW_MS = 60_000;

function checkIpLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= IP_LIMIT) return false;
  entry.count++;
  return true;
}

// Shape we expect from error-reporting.ts — everything is pre-scrubbed.
interface ErrorPayload {
  env?: string;
  release?: string;
  category?: string;
  route?: string;
  language?: string;
  role?: string | null;
  requestId?: string;
  severity?: string;
  error?: { name?: string; message?: string; stack?: string };
  browser?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  // CORS pre-flight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Per-IP rate limit — drop silently with 429 to avoid noisy logs on abuse.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  if (!checkIpLimit(ip)) {
    return new Response(null, { status: 429, headers: corsHeaders });
  }

  let body: ErrorPayload;
  try {
    body = await req.json() as ErrorPayload;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Basic shape guard — drop obviously malformed payloads.
  if (typeof body !== "object" || body === null) {
    return new Response(JSON.stringify({ error: "Unexpected payload shape" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const svc = serviceClient();
  const { error } = await svc.from("client_errors").insert({
    env:         String(body.env         ?? "unknown").slice(0, 50),
    release:     String(body.release     ?? "").slice(0, 100),
    category:    String(body.category    ?? "runtime").slice(0, 50),
    route:       body.route    != null ? String(body.route).slice(0, 500)   : null,
    language:    body.language != null ? String(body.language).slice(0, 10) : null,
    role:        body.role     != null ? String(body.role).slice(0, 50)     : null,
    request_id:  body.requestId != null ? String(body.requestId).slice(0, 100) : null,
    severity:    String(body.severity ?? "error").slice(0, 20),
    error_name:  body.error?.name    != null ? String(body.error.name).slice(0, 200)    : null,
    error_msg:   body.error?.message != null ? String(body.error.message).slice(0, 2000) : null,
    error_stack: body.error?.stack   != null ? String(body.error.stack).slice(0, 8000)   : null,
    browser:     body.browser ?? null,
    extra:       body.extra   ?? null,
  });

  if (error) {
    // Log to function logs but still return 200 — the client shouldn't retry
    // error reports on DB failure (would create an error-reporting loop).
    console.error("[error-ingest] DB insert failed:", error.message);
  }

  return new Response(null, { status: 204, headers: corsHeaders });
});
