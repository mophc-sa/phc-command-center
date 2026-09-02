import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { isSystemAdmin, isExecutive, isSalesManager, isBdOrSalesOps, isSalesperson, type AppRole } from "@/lib/roles";

export const Route = createFileRoute("/")({
  ssr: false,
  component: LandingRedirect,
});

// Role-based landing redirect.
// Runs client-side so it has access to the authenticated user's roles.
// Uses the same queryKey as useAuth so TanStack Query shares the cache —
// no duplicate network request when the user is already logged in.
//
// Landing contract (Sprint 1D, revised Phase 3 — system-redesign request:
// "management dashboard" vs "sales dashboard"):
//   system_admin            → /admin-settings
//   executive | sales_mgr  → /command-center (org-wide, incl. team target)
//   bd | sales_ops         → /lead-tender-inbox
//   salesperson            → /my-workspace (personal target/pipeline)
//   viewer                  → /command-center
//   no roles               → /pending-approval
function LandingRedirect() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // A screen, not a person. Asked for on 2026-09-02, when info@phc-sa.com was
  // created to drive the board in the sales manager's office: it should open on
  // the board and stay there.
  //
  // Read from the profile rather than inferred from roles, because the roles it
  // needs are the roles the board's data needs -- and any of them would also
  // land a real person somewhere else entirely.
  const { data: display, isLoading: displayLoading } = useQuery({
    queryKey: ["display-account", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("is_display_account")
        .eq("id", user!.id)
        .maybeSingle();
      return (data as { is_display_account?: boolean } | null)?.is_display_account === true;
    },
  });

  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ["roles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      return (data ?? []).map((r) => r.role as AppRole);
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    // Wait for auth session to resolve
    if (authLoading) return;

    // No session → send to login
    if (!user) {
      void navigate({ to: "/auth", search: { next: "" } as never, replace: true });
      return;
    }

    // Before roles are consulted at all: a display account has exactly one
    // destination, and asking its roles would send it wherever a BD manager
    // goes instead.
    if (displayLoading) return;
    if (display) {
      void navigate({ to: "/board", replace: true });
      return;
    }

    // Wait for roles query
    if (rolesLoading) return;

    const r: AppRole[] = roles ?? [];

    if (isSystemAdmin(r)) {
      void navigate({ to: "/admin-settings", replace: true });
    } else if (isExecutive(r) || isSalesManager(r)) {
      void navigate({ to: "/command-center", replace: true });
    } else if (isBdOrSalesOps(r)) {
      void navigate({ to: "/lead-tender-inbox", replace: true });
    } else if (isSalesperson(r)) {
      void navigate({ to: "/my-workspace", replace: true });
    } else if (r.length === 0) {
      // No roles assigned — account is pending or quarantined
      void navigate({ to: "/pending-approval", replace: true });
    } else {
      // viewer
      void navigate({ to: "/command-center", replace: true });
    }
  }, [user, authLoading, roles, rolesLoading, display, displayLoading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
