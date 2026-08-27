import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/phc/AppShell";
import { requiresMfa, type AppRole } from "@/lib/roles";

/**
 * Where beforeLoad decided this request should go instead.
 *
 * Carried as data rather than thrown — see the note in `beforeLoad`. Each
 * shape is exactly the argument its `navigate()` call needs, so the component
 * does no re-derivation and cannot drift from the decision.
 */
type Redirect =
  | { to: "/auth"; search: { next: string } }
  | { to: "/pending-approval" }
  | { to: "/mfa-setup" }
  | { to: "/mfa-verify" };

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }): Promise<{ user: unknown; redirectTo: Redirect | null }> => {
    // ── Why these are RETURNED and not thrown ────────────────────────────────
    //
    // A Supabase session lives in the browser, so the server cannot know
    // whether you are signed in. That is why this route is `ssr: false`: the
    // server streams an unresolved Suspense boundary for every protected route
    // and leaves the decision here.
    //
    // `throw redirect(...)` then resolves DURING hydration, which substitutes a
    // different route match under a boundary the server has already written.
    // React finds one tree where it wrote another and discards the page —
    // error #418, seen by the user as a flash on the ordinary way into this
    // app with an expired session: a stale bookmark, a link in a message, a tab
    // left open overnight. React's own diff, captured from the dev build:
    //
    //     <OutletImpl>
    //       <Suspense fallback={null}>
    //   -     <Suspense>        ← the server's boundary for THIS route
    //   +     <div dir="ltr">   ← the sign-in form, from /auth
    //
    // `routes/index.tsx` never showed this, and it is the proof of the rule: it
    // is also `ssr: false`, it also ends up at /auth, but it navigates from an
    // effect. The match the client hydrates is the match the server rendered,
    // and the redirect is an ordinary re-render afterwards. Content differing
    // inside an `ssr: false` boundary is fine; the MATCH changing underneath
    // one is not.
    //
    // Two things that look like fixes and are not — both tried, both measured:
    //   · `ssr: false` on /auth. It only stops the SERVER rendering; the
    //     hydration pass is itself a client render, so the form still appeared.
    //   · Gating /auth's content on mount. The client then rendered nothing
    //     where the server had a <Suspense>, which is still a mismatch.
    //
    // The gate itself is unchanged in strength. Every check below still runs
    // before any child loader, and the component refuses to render <Outlet/>
    // while a redirect is pending, so no protected screen is reachable for a
    // frame. The database is the real boundary in any case: RLS answers an
    // unauthenticated reader with nothing.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      const next = location.pathname + location.searchStr;
      return { user: null, redirectTo: { to: "/auth", search: { next } } };
    }

    // Check account status — only active users may access the app.
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", data.user.id)
      .single();

    if (!profile || profile.status === "pending_approval") {
      return { user: null, redirectTo: { to: "/pending-approval" } };
    }
    if (profile.status === "suspended" || profile.status === "deleted") {
      await supabase.auth.signOut();
      return { user: null, redirectTo: { to: "/auth", search: { next: "" } } };
    }

    // Mandatory MFA for sensitive roles (2026-08-02 security hardening).
    // getAuthenticatorAssuranceLevel().nextLevel reflects the AAL the user
    // *could* reach given enrolled factors — aal1 means no verified TOTP
    // factor exists yet (force enrollment); aal2 with currentLevel still
    // aal1 means a factor exists but this session hasn't stepped up yet
    // (force the verify challenge).
    const { data: rolesRows } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    const roleList = (rolesRows ?? []).map((r) => r.role as AppRole);
    if (requiresMfa(roleList)) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === "aal1") {
        return { user: null, redirectTo: { to: "/mfa-setup" } };
      }
      if (aal?.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
        return { user: null, redirectTo: { to: "/mfa-verify" } };
      }
    }

    return { user: data.user, redirectTo: null };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { redirectTo } = Route.useRouteContext();
  const navigate = useNavigate();

  // In an effect, so it runs after hydration has committed rather than during
  // it. `replace` keeps the protected URL out of history: pressing Back from
  // the sign-in screen should not bounce the user through the page that just
  // turned them away.
  useEffect(() => {
    if (redirectTo) void navigate({ ...redirectTo, replace: true } as never);
  }, [redirectTo, navigate]);

  // Nothing of the app renders while a redirect is pending — not the shell,
  // not the navigation, not the child route. A spinner is the honest state
  // here: the answer is known, the browser is simply on its way.
  if (redirectTo) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div
          className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
