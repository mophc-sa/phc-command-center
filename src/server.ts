import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// QA 2026-08-10 (ISSUE-006): this policy shipped only as
// Content-Security-Policy-Report-Only, and with no report-uri/report-to
// directive it had nowhere to send violations either — so it neither blocked
// anything nor told anyone. It is now enforced. It covers what the app does:
// Supabase (REST + realtime websocket), Cloudflare Turnstile, Google Fonts,
// and the Lovable bridge.
//
// `static.cloudflareinsights.com` is NOT an app dependency — Cloudflare
// injects its Web Analytics beacon into responses at the edge, after this
// Worker returns them. It is therefore invisible to local development and to
// every test that does not go through the CDN, and the first enforced deploy
// blocked it (caught in post-deploy verification, 2026-08-10). The beacon
// script is served from static.cloudflareinsights.com and posts its RUM
// payload to cloudflareinsights.com/cdn-cgi/rum, so both a script-src and a
// connect-src entry are required. Removing either silently kills analytics
// while the app keeps working.
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.lovable.dev https://challenges.cloudflare.com https://cloudflareinsights.com";

/**
 * The document must never be served from cache without checking.
 *
 * Assets are content-hashed and marked immutable, which is right. The HTML that
 * POINTS at them was sent with no Cache-Control at all, so browsers fell back
 * to heuristic caching and kept serving yesterday's document — which names
 * yesterday's chunk hashes. After a deploy those 404, the route fails to load,
 * and the recovery in __root.tsx cannot help either: its location.reload()
 * revalidates nothing, so it fetches the same cached HTML, fails again, and
 * the loop guard stops it at "A new version was released". The user is then
 * stuck until they hard-reload, which nothing tells them to do.
 *
 * `no-cache` does not mean "do not store" — it means "always revalidate".
 * Unchanged HTML still comes back as a 304, so this costs one conditional
 * request per navigation and removes the whole failure mode.
 *
 * Deliberately scoped to HTML: hashed assets keep their immutable year.
 */
function withCacheHeaders(response: Response, headers: Headers): void {
  const contentType = headers.get("content-type") ?? response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return;
  headers.set("Cache-Control", "no-cache, must-revalidate");
}

function withSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  withCacheHeaders(response, headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  // Kept alongside the enforced header so that tightening the policy later can
  // be trialled here first, the way this one should have been.
  headers.set("Content-Security-Policy-Report-Only", CONTENT_SECURITY_POLICY);
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
