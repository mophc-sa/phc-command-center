/**
 * Production-safe error reporting with scrubbing.
 *
 * Attaches: route, language, release, role name, browser/runtime metadata,
 * request/correlation ID, error category.
 *
 * Scrubs (never sent): auth tokens, cookies, passwords, attachments,
 * raw customer messages, raw form data, phone numbers, full emails.
 *
 * Environment separation: dev/preview log to console only; production forwards
 * to a configurable reporting endpoint when available. No vendor-specific SDK
 * or secrets are wired in this phase — plug in Sentry, Axiom, etc. in Phase B.
 */

type Env = "development" | "preview" | "production";
type Severity = "error" | "warning" | "info";
type Category =
  | "hydration"
  | "ssr"
  | "loader"
  | "runtime"
  | "supabase"
  | "unhandled_rejection"
  | "manual";

type ReportContext = {
  category?: Category;
  route?: string;
  role?: string | null;
  requestId?: string;
  extra?: Record<string, unknown>;
  severity?: Severity;
};

declare global {
  interface Window {
    __phcRole?: string | null;
    __phcRequestId?: string;
  }
}

// ---------- Scrubbing ---------------------------------------------------

const TOKEN_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "apikey",
  "api_key",
  "password",
  "pass",
  "pwd",
  "secret",
  "session",
  "attachment",
  "attachments",
  "file",
  "files",
  "raw_message",
  "message_body",
  "customer_message",
  "form",
  "form_data",
  "body",
  "email",
  "phone",
  "phone_number",
]);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// International-ish phone: 7+ digits with optional separators/plus
const PHONE_RE = /(?<!\d)(\+?\d[\d\s().-]{6,}\d)(?!\d)/g;
// Long opaque tokens (JWT-ish, bearer-ish)
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;

export function scrubString(input: string): string {
  return input
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(JWT_RE, "[redacted-jwt]")
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(PHONE_RE, "[redacted-phone]");
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[redacted-depth]";
  if (value == null) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (TOKEN_KEYS.has(k.toLowerCase())) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = scrubValue(v, depth + 1);
    }
    return out;
  }
  return "[unserializable]";
}

// ---------- Env / role plumbing -----------------------------------------

function currentEnv(): Env {
  if (typeof import.meta !== "undefined" && (import.meta as { env?: { MODE?: string } }).env) {
    const mode = (import.meta as { env: { MODE?: string } }).env.MODE;
    if (mode === "production") return "production";
    if (mode === "preview") return "preview";
  }
  return "development";
}

function release(): string {
  const meta = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  return meta.VITE_APP_RELEASE ?? meta.VITE_APP_VERSION ?? "dev";
}

function browserMeta(): Record<string, unknown> {
  if (typeof navigator === "undefined") return { runtime: "server" };
  return {
    userAgent: navigator.userAgent?.slice(0, 200) ?? null,
    language: typeof document !== "undefined" ? document.documentElement.lang || null : null,
    dir: typeof document !== "undefined" ? document.documentElement.dir || null : null,
    viewport:
      typeof window !== "undefined"
        ? { w: window.innerWidth, h: window.innerHeight }
        : null,
    runtime: "browser",
  };
}

export function setReportingRole(role: string | null) {
  if (typeof window !== "undefined") window.__phcRole = role;
}

function currentRoute(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (typeof window !== "undefined") return window.location.pathname;
  return undefined;
}

function currentLanguage(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.documentElement.lang || undefined;
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getRequestId(): string {
  if (typeof window === "undefined") return newRequestId();
  if (!window.__phcRequestId) window.__phcRequestId = newRequestId();
  return window.__phcRequestId;
}

// ---------- Dispatch (fire-and-forget HTTP) ---------------------------------

// Primary endpoint: the error-ingest Supabase Edge Function.
// Override with VITE_ERROR_REPORTING_ENDPOINT (e.g. Axiom, custom webhook).
function ingestUrl(): string | null {
  const meta = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  if (meta.VITE_ERROR_REPORTING_ENDPOINT) return meta.VITE_ERROR_REPORTING_ENDPOINT;
  const base = meta.VITE_SUPABASE_URL;
  if (base) return `${base}/functions/v1/error-ingest`;
  return null;
}

function ingestHeaders(): Record<string, string> {
  const meta = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const key = meta.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  // anon key header lets the Supabase gateway pass the request through
  return {
    "Content-Type": "application/json",
    ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}),
  };
}

function dispatch(payload: Record<string, unknown>): void {
  const url = ingestUrl();
  if (!url) return; // no endpoint configured — console fallback below suffices
  try {
    fetch(url, {
      method: "POST",
      headers: ingestHeaders(),
      body: JSON.stringify(payload),
      keepalive: true, // survives page unload (same guarantee as sendBeacon)
    }).catch(() => {
      // Swallow network errors — error reporting must never throw.
    });
  } catch {
    // fetch unavailable (e.g. server-side SSR context) — silently skip.
  }
}

// ---------- Public API --------------------------------------------------

function errorPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: scrubString(error.message || ""),
      stack: error.stack ? scrubString(error.stack).slice(0, 4000) : undefined,
    };
  }
  return { name: "NonError", message: scrubString(String(error)).slice(0, 500) };
}

export function reportError(error: unknown, context: ReportContext = {}) {
  const env = currentEnv();
  const payload = {
    env,
    release: release(),
    category: context.category ?? "runtime",
    route: currentRoute(context.route),
    language: currentLanguage(),
    role: context.role ?? (typeof window !== "undefined" ? window.__phcRole ?? null : null),
    requestId: context.requestId ?? getRequestId(),
    browser: browserMeta(),
    severity: context.severity ?? "error",
    error: errorPayload(error),
    extra: context.extra ? (scrubValue(context.extra) as Record<string, unknown>) : undefined,
  };

  if (env !== "production") {
    // Dev/preview: console only — never forward to production reporting.
    // eslint-disable-next-line no-console
    console.error("[error-report]", payload);
    return;
  }

  // Production: forward to error-ingest edge function (fire-and-forget).
  // Also log to console so errors surface in browser dev tools / server logs.
  dispatch(payload);
  // eslint-disable-next-line no-console
  console.error("[error-report]", payload);
}

let installed = false;
export function installGlobalErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, { category: "runtime" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, { category: "unhandled_rejection" });
  });
}
