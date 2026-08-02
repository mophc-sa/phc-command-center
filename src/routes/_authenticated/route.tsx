import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/phc/AppShell";
import { requiresMfa, type AppRole } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } as never });
    }

    // Check account status — only active users may access the app.
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", data.user.id)
      .single();

    if (!profile || profile.status === "pending_approval") {
      throw redirect({ to: "/pending-approval" });
    }
    if (profile.status === "suspended" || profile.status === "deleted") {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth", search: { next: "" } as never });
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
        throw redirect({ to: "/mfa-setup" });
      }
      if (aal?.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
        throw redirect({ to: "/mfa-verify" });
      }
    }

    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
