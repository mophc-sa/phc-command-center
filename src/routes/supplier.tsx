import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import { useI18n } from "@/lib/i18n";
import type { AppRole } from "@/lib/roles";
import { supplierGate, type PortalRedirect } from "@/lib/supplier-portal";
import { pick, type Bi } from "@/lib/pricing-text";
import { SupplierShell } from "@/components/phc/supplier/SupplierShell";

// The supplier portal's layout (pricing loop PR 3). Outside /_authenticated on
// purpose: a supplier never gets the staff shell, and staff never land here.
// Same pattern as /_authenticated: the decision is RETURNED from beforeLoad and
// applied from an effect (see the note in _authenticated/route.tsx on why a
// thrown redirect breaks hydration). The database is the real boundary: every
// portal call checks the supplier session itself.
export const Route = createFileRoute("/supplier")({
  ssr: false,
  head: () => ({ meta: [{ title: "Supplier portal — PHC" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async ({ location }): Promise<{ redirectTo: PortalRedirect | null; notForYou: boolean }> => {
    const { data, error } = await supabase.auth.getUser();
    const signedIn = !error && !!data.user;
    let status: string | null = null;
    let roles: AppRole[] = [];
    let aal: { currentLevel: string | null; nextLevel: string | null } | null = null;
    if (signedIn) {
      const { data: profile } = await supabase.from("profiles").select("status").eq("id", data.user!.id).single();
      status = profile?.status ?? null;
      const { data: rolesRows } = await supabase.from("user_roles").select("role").eq("user_id", data.user!.id);
      roles = (rolesRows ?? []).map((r) => r.role as AppRole);
      const { data: level, error: levelError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      // Fail closed: if the level cannot be read, treat the session as aal1 and send it through MFA.
      aal = !levelError && level ? { currentLevel: level.currentLevel, nextLevel: level.nextLevel } : { currentLevel: "aal1", nextLevel: "aal2" };
    }
    // Staff are not sent away silently: they see a page saying this is not theirs.
    if (signedIn && status === "active" && !roles.includes("supplier")) return { redirectTo: null, notForYou: true };
    const gate = supplierGate({ signedIn, status, roles, aal }, location.pathname);
    if (gate.signOut) await supabase.auth.signOut();
    return { redirectTo: gate.redirect, notForYou: false };
  },
  component: SupplierLayout,
});

const NOT_FOR_YOU = {
  title: { en: "This page is for suppliers", ar: "هذه الصفحة للموردين" },
  body: { en: "The supplier portal is only for supplier accounts. Your staff account works in the main app.", ar: "بوابة الموردين مخصصة لحسابات الموردين فقط. حسابك الداخلي يعمل في التطبيق الرئيسي." },
  back: { en: "Back to the app", ar: "العودة إلى التطبيق" },
} satisfies Record<string, Bi>;

function SupplierLayout() {
  const { redirectTo, notForYou } = Route.useRouteContext();
  const navigate = useNavigate();
  const { lang } = useI18n();
  // A supplier is an MFA account: the same 30-minute idle sign-out as the managers.
  useIdleLogout(redirectTo == null && !notForYou, 30, lang);

  useEffect(() => {
    if (redirectTo) void navigate({ ...redirectTo, replace: true } as never);
  }, [redirectTo, navigate]);

  if (redirectTo) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground" role="status" aria-label="Loading" />
      </div>
    );
  }
  if (notForYou) {
    return (
      <div dir={lang === "ar" ? "rtl" : "ltr"} className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
        <h1 className="text-lg font-semibold">{pick(NOT_FOR_YOU.title, lang)}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{pick(NOT_FOR_YOU.body, lang)}</p>
        <Link to="/" className="text-sm underline-offset-2 hover:underline">{pick(NOT_FOR_YOU.back, lang)}</Link>
      </div>
    );
  }
  return (
    <SupplierShell>
      <Outlet />
    </SupplierShell>
  );
}
