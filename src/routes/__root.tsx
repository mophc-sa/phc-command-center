import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { installGlobalErrorReporting, reportError } from "../lib/error-reporting";
import { isStaleChunkError, shouldAutoReload, RELOAD_MARKER_KEY } from "@/lib/chunk-reload";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { AuthProvider } from "@/hooks/useSupabaseAuth";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">PHC · 404</div>
        <h1 className="mt-4 text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  // Every route is a hash-named lazy chunk, so a tab left open across a deploy
  // asks for a filename that no longer exists. That is not a server fault and
  // retrying cannot fix it: the dead URL is baked into the JS already running,
  // so router.invalidate() + reset() re-requests the same 404 forever. Only a
  // reload fetches the new index.html and the new hashes.
  const stale = isStaleChunkError(error);

  useEffect(() => {
    if (!stale || typeof window === "undefined") return;
    const marker = window.sessionStorage.getItem(RELOAD_MARKER_KEY);
    if (!shouldAutoReload(Date.now(), marker)) return;
    window.sessionStorage.setItem(RELOAD_MARKER_KEY, String(Date.now()));
    window.location.reload();
  }, [stale]);

  useEffect(() => {
    // A stale chunk is a deploy, not an incident. Reporting it would fill
    // client_errors with one row per open tab per release.
    if (stale) return;
    reportError(error, { category: "runtime", extra: { boundary: "tanstack_root_error_component" } });
  }, [error, stale]);

  // The boundary cannot rely on the i18n provider: it renders when the tree
  // below has already failed. localStorage is the same source the provider
  // reads, so the message stays in the user's language either way.
  const ar =
    typeof window !== "undefined" && window.localStorage.getItem("phc-lang") === "ar";

  const copy = stale
    ? {
        eyebrow: ar ? "تحديث" : "Update",
        title: ar ? "صدر إصدار جديد" : "A new version was released",
        body: ar
          ? "هذه الصفحة كانت مفتوحة قبل التحديث. أعِد التحميل للمتابعة من حيث كنت."
          : "This tab was open before the update. Reload to carry on where you were.",
        action: ar ? "إعادة التحميل" : "Reload",
      }
    : {
        eyebrow: ar ? "تنبيه" : "Attention",
        title: ar ? "تعذّر تحميل الصفحة" : "This page didn't load",
        body: ar
          ? "حدث خطأ من جانبنا. جرّب مرة أخرى أو عُد إلى الرئيسية."
          : "Something went wrong on our end. You can try again or head back home.",
        action: ar ? "حاول مرة أخرى" : "Try again",
      };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <div className="text-xs uppercase tracking-[0.2em] text-amber">{copy.eyebrow}</div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
          {copy.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              // Retrying a dead chunk URL just fails again — reload instead.
              if (stale) { window.location.reload(); return; }
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90"
          >
            {copy.action}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            {ar ? "الرئيسية" : "Go home"}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "PHC Command Center — Sales Agent" },
      {
        name: "description",
        content:
          "PHC Wayfinding Signs — internal bilingual command center for the Sales Agent: pipeline decisions, follow-ups, approvals, and evidence.",
      },
      { name: "theme-color", content: "#F4F4F3" },
      { property: "og:title", content: "PHC Command Center" },
      { property: "og:description", content: "Internal sales decision system for PHC Wayfinding Signs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Almarai:wght@300;400;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Toasts anchor to the side opposite the brand mark. The position was pinned
 * to "top-right" regardless of direction, so in Arabic (RTL) — where the PHC
 * logo sits top-right — an error toast landed straight on top of the logo
 * (QA 2026-08-10 ISSUE-009).
 */
function DirectionAwareToaster() {
  const { lang } = useI18n();
  return (
    <Toaster
      richColors
      position={lang === "ar" ? "top-left" : "top-right"}
      theme="light"
    />
  );
}

/** Syncs <html dir> and <html lang> to the active i18n language. */
function HtmlDirSync() {
  const { lang } = useI18n();
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    installGlobalErrorReporting();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <HtmlDirSync />
        <AuthProvider>
          <Outlet />
          <DirectionAwareToaster />
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
