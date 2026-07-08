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
 * to the Lovable events channel (window.__lovableEvents.captureException) when
 * available. No third-party SDK is wired in this phase.
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

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: {
      mechanism?: string;
      handled?: boolean;
      severity?: Severity;
    },
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
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
    // Dev/preview: console only — do not forward to production reporting.
    // eslint-disable-next-line no-console
    console.error("[error-report]", payload);
    return;
  }

  // Production: forward to Lovable events channel when present.
  if (typeof window !== "undefined" && window.__lovableEvents?.captureException) {
    window.__lovableEvents.captureException(
      error instanceof Error ? error : new Error(payload.error.message),
      payload as unknown as Record<string, unknown>,
      { mechanism: "manual", handled: true, severity: payload.severity },
    );
  } else {
    // eslint-disable-next-line no-console
    console.error("[error-report]", payload);
  }
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
