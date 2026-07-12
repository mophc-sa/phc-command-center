import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { isExecutive, isSalesManager, isBdOrSalesOps, type AppRole } from "@/lib/roles";

export const Route = createFileRoute("/")({
  ssr: false,
  component: LandingRedirect,
});

// Role-based landing redirect.
// Runs client-side so it has access to the authenticated user's roles.
// Uses the same queryKey as useAuth so TanStack Query shares the cache —
// no duplicate network request when the user is already logged in.
function LandingRedirect() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

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

    // Wait for roles query
    if (rolesLoading) return;

    const r: AppRole[] = roles ?? [];

    if (isExecutive(r) || isSalesManager(r)) {
      void navigate({ to: "/command-center", replace: true });
    } else if (isBdOrSalesOps(r)) {
      void navigate({ to: "/lead-tender-inbox", replace: true });
    } else {
      // salesperson, system_admin, viewer, or no roles yet
      void navigate({ to: "/my-workspace", replace: true });
    }
  }, [user, authLoading, roles, rolesLoading, navigate]);

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
