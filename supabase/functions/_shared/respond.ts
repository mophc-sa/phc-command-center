import { corsHeaders } from "./cors.ts";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function err(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...(extra ?? {}) }, status);
}
