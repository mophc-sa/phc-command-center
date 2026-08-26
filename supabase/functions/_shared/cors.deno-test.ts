// =============================================================================
// Who may call a PHC backend function from a browser.
//
// The rule these tests hold: production stays exactly as fail-closed as it was,
// a developer can opt their own machine in explicitly, and no configuration
// path — including a stray "*" in the environment — produces a wildcard.
//
// The env var is read once at module load, so each case re-imports the module
// with a cache-busting query string after setting the environment.
// =============================================================================

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MODULE = "./cors.ts";
let bust = 0;

async function loadWith(env: Record<string, string | null>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === null) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  bust += 1;
  return await import(`${MODULE}?case=${bust}`);
}

const preflight = (origin: string | null) =>
  new Request("https://x.functions.supabase.co/ai-orchestrator", {
    method: "OPTIONS",
    headers: origin ? { Origin: origin } : {},
  });

Deno.test("production: unset config allows only the canonical origin", async () => {
  const m = await loadWith({ CORS_ALLOWED_ORIGIN: null });
  assertEquals(m.ALLOWED_ORIGINS, ["https://agent.phc-sa.com"]);
  assertEquals(m.corsHeaders["Access-Control-Allow-Origin"], "https://agent.phc-sa.com");
  assertEquals(
    m.corsHeadersFor(preflight("https://agent.phc-sa.com"))["Access-Control-Allow-Origin"],
    "https://agent.phc-sa.com",
  );
});

Deno.test("production: an arbitrary origin is refused", async () => {
  const m = await loadWith({ CORS_ALLOWED_ORIGIN: null });
  for (const bad of [
    "https://evil.example.com",
    "http://localhost:5173", // not allowed in production, only where configured
    "https://agent.phc-sa.com.evil.example.com",
    "http://agent.phc-sa.com",
  ]) {
    assertEquals(m.resolveAllowedOrigin(bad), null, bad);
    assertFalse("Access-Control-Allow-Origin" in m.corsHeadersFor(preflight(bad)), bad);
  }
});

Deno.test("local: an approved dev origin is allowed when configured", async () => {
  const m = await loadWith({
    CORS_ALLOWED_ORIGIN: "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080",
  });
  for (const ok of ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080"]) {
    assertEquals(m.corsHeadersFor(preflight(ok))["Access-Control-Allow-Origin"], ok, ok);
  }
  // …and the response still names ONE origin, not the list.
  assertEquals(m.corsHeadersFor(preflight("http://localhost:5173"))["Access-Control-Allow-Origin"],
    "http://localhost:5173");
});

Deno.test("local config does not silently admit anything else", async () => {
  const m = await loadWith({ CORS_ALLOWED_ORIGIN: "http://localhost:5173" });
  assertEquals(m.resolveAllowedOrigin("http://localhost:5174"), null);
  assertEquals(m.resolveAllowedOrigin("https://evil.example.com"), null);
  // A different port is a different origin, and must be treated as one.
  assertEquals(m.resolveAllowedOrigin("http://localhost:8080"), null);
});

Deno.test("a wildcard can never be produced, however it is configured", async () => {
  for (const attempt of ["*", " * ", "*,https://agent.phc-sa.com", "https://a.example.com,*"]) {
    const m = await loadWith({ CORS_ALLOWED_ORIGIN: attempt });
    assertFalse(m.ALLOWED_ORIGINS.includes("*"), attempt);
    assertEquals(m.corsHeaders["Access-Control-Allow-Origin"] === "*", false, attempt);
    assertEquals(m.resolveAllowedOrigin("https://anything.example.com"), null, attempt);
    // "*" alone must fall back to production, never to an empty/permissive state.
    if (attempt.trim() === "*") assertEquals(m.ALLOWED_ORIGINS, ["https://agent.phc-sa.com"]);
  }
});

Deno.test("a request with no Origin header gets no allow-origin", async () => {
  // Server-to-server callers need no CORS grant; only browsers do.
  const m = await loadWith({ CORS_ALLOWED_ORIGIN: null });
  assertEquals(m.resolveAllowedOrigin(null), null);
  assertFalse("Access-Control-Allow-Origin" in m.corsHeadersFor(preflight(null)));
});

Deno.test("credentials-bearing headers stay permitted, and methods stay narrow", async () => {
  const m = await loadWith({ CORS_ALLOWED_ORIGIN: null });
  const h = m.corsHeadersFor(preflight("https://agent.phc-sa.com"));
  assert(h["Access-Control-Allow-Headers"].includes("authorization"));
  assertEquals(h["Access-Control-Allow-Methods"], "POST, OPTIONS");
  // Vary: Origin is required the moment the value can differ per caller.
  assertEquals(h["Vary"], "Origin");
});
