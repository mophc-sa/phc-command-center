import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Minus, Clock, UserCheck, UserX, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { GitSyncStatus } from "@/components/phc/GitSyncStatus";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import {
  ALL_ROLES,
  approveUser,
  rejectUser,
  suspendUser,
  activateUser,
  grantRole,
  listPendingUsers,
  listTeam,
  revokeRole,
  type AppRole,
  type PendingUser,
  type TeamMember,
} from "@/lib/team-actions";
import {
  canApproveCommercialAction,
  canAssignOwner,
  canManageSalesPipeline,
  canManageTeam,
  canViewSalesAdmin,
  isExecutive,
  isSalesManager,
  isBdOrSalesOps,
} from "@/lib/roles";

// ── Route guard ───────────────────────────────────────────────────────────────
// Any authenticated user could previously navigate to this URL directly.
// This beforeLoad check blocks non-managers at the route level.
export const Route = createFileRoute("/_authenticated/admin-settings")({
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return; // parent _authenticated guard handles the redirect

    const { data: rolesRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (rolesRows ?? []).map((r) => r.role as AppRole);
    if (!canManageTeam(roles)) {
      throw redirect({ to: "/command-center" });
    }
  },
  head: () => ({
    meta: [
      { title: "Admin Settings — PHC" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminSettingsPage,
});

// ── Capability matrix ─────────────────────────────────────────────────────────
type CapKey =
  | "cap_manage_roles"
  | "cap_approve_decisions"
  | "cap_escalate"
  | "cap_manage_opps"
  | "cap_assign_owner"
  | "cap_schedule_followups"
  | "cap_view_reports"
  | "cap_view_opps"
  | "cap_view_audit";

const CAPABILITIES: { key: CapKey; allowed: (r: AppRole) => boolean }[] = [
  { key: "cap_manage_roles", allowed: (r) => canManageTeam(r) },
  { key: "cap_approve_decisions", allowed: (r) => canApproveCommercialAction(r) },
  { key: "cap_escalate", allowed: (r) => canApproveCommercialAction(r) },
  { key: "cap_manage_opps", allowed: (r) => canManageSalesPipeline(r) },
  { key: "cap_assign_owner", allowed: (r) => canAssignOwner(r) },
  { key: "cap_schedule_followups", allowed: (r) => canManageSalesPipeline(r) },
  { key: "cap_view_audit", allowed: (r) => canViewSalesAdmin(r) },
  { key: "cap_view_reports", allowed: (r) => r !== "salesperson" },
  { key: "cap_view_opps", allowed: () => true },
];

function roleTone(r: AppRole): "attention" | "positive" | "neutral" | "muted" {
  if (isExecutive(r) || isSalesManager(r)) return "attention";
  if (isBdOrSalesOps(r)) return "positive";
  if (r === "system_admin") return "neutral";
  return "muted";
}

// ── Page component ────────────────────────────────────────────────────────────
function AdminSettingsPage() {
  const { t, lang } = useI18n();
  const { user, roles } = useAuth();
  const canManage = canManageTeam(roles);
  const qc = useQueryClient();

  // Pending registrations state
  const [approveRoles, setApproveRoles] = useState<Record<string, AppRole>>({});
  const [pendingBusy, setPendingBusy] = useState<Record<string, boolean>>({});

  const {
    data: pending = [],
    isLoading: pendingLoading,
  } = useQuery({
    queryKey: ["pending-users"],
    queryFn: listPendingUsers,
    enabled: canManage,
  });

  const {
    data: team = [],
    isLoading: teamLoading,
    isError: teamError,
    refetch: refetchTeam,
  } = useQuery({
    queryKey: ["team-full"],
    queryFn: listTeam,
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["team-full"] });
    qc.invalidateQueries({ queryKey: ["pending-users"] });
  }

  async function handleApprove(p: PendingUser) {
    const role = approveRoles[p.id] ?? "viewer";
    setPendingBusy((b) => ({ ...b, [p.id]: true }));
    try {
      await approveUser(p.id, role);
      toast.success(t("toast_user_approved"));
      invalidateAll();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setPendingBusy((b) => ({ ...b, [p.id]: false }));
    }
  }

  async function handleReject(p: PendingUser) {
    setPendingBusy((b) => ({ ...b, [p.id]: true }));
    try {
      await rejectUser(p.id);
      toast.success(t("toast_user_rejected"));
      invalidateAll();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setPendingBusy((b) => ({ ...b, [p.id]: false }));
    }
  }

  async function handleSuspend(member: TeamMember) {
    try {
      await suspendUser(member.id);
      toast.success(t("toast_user_suspended"));
      invalidateAll();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }

  async function handleActivate(member: TeamMember) {
    try {
      await activateUser(member.id);
      toast.success(t("toast_user_activated"));
      invalidateAll();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }

  async function toggleRole(member: TeamMember, role: AppRole, has: boolean) {
    try {
      if (has) {
        await revokeRole(member.id, role);
        toast.success(t("toast_role_revoked"));
      } else {
        await grantRole(member.id, role);
        toast.success(t("toast_role_granted"));
      }
      invalidateAll();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }

  const holders = (role: AppRole) => team.filter((m) => m.roles.includes(role));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Administration"
        title={t("admin_settings_title")}
        description={t("admin_settings_intro")}
      />

      <GitSyncStatus />

      {/* ── Pending Registrations ── */}
      {canManage && (
        <Panel
          title={t("admin_section_pending")}
          // Badge shows count when there are pending users
          action={
            pending.length > 0 ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber/20 text-[11px] font-semibold text-amber-light">
                {pending.length}
              </span>
            ) : undefined
          }
        >
          {pendingLoading ? (
            <SkeletonTable rows={2} />
          ) : pending.length === 0 ? (
            <EmptyState message={t("admin_pending_empty")} />
          ) : (
            <ul className="divide-y divide-border/60">
              {pending.map((p) => {
                const busy = !!pendingBusy[p.id];
                const selectedRole = approveRoles[p.id] ?? "viewer";
                const registeredAt = new Date(p.created_at).toLocaleDateString(
                  lang === "ar" ? "ar-SA" : "en-GB",
                  { day: "numeric", month: "short", year: "numeric" },
                );
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber/30 bg-amber/10">
                        <Clock className="h-4 w-4 text-amber-light" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {p.full_name || (lang === "ar" ? "بدون اسم" : "Unnamed")}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {p.email}
                          <span className="mx-1.5 opacity-40">·</span>
                          {t("admin_pending_registered")} {registeredAt}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* Role selector */}
                      <label className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">
                          {t("admin_pending_role_label")}
                        </span>
                        <select
                          value={selectedRole}
                          disabled={busy}
                          onChange={(e) =>
                            setApproveRoles((prev) => ({
                              ...prev,
                              [p.id]: e.target.value as AppRole,
                            }))
                          }
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground focus:border-amber/60 focus:outline-none focus:ring-1 focus:ring-amber/40 disabled:opacity-50"
                        >
                          {ALL_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {t(`role_${r}` as never)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {/* Approve */}
                      <button
                        disabled={busy}
                        onClick={() => handleApprove(p)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-won/30 bg-won/10 px-2.5 py-1.5 text-xs font-medium text-won transition-colors hover:bg-won/[0.15] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        {t("admin_pending_approve")}
                      </button>
                      {/* Reject */}
                      <button
                        disabled={busy}
                        onClick={() => handleReject(p)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <UserX className="h-3.5 w-3.5" />
                        {t("admin_pending_reject")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {/* ── Capabilities Matrix ── */}
      <Panel title={t("admin_section_matrix")}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="py-2 pe-4 text-start font-medium">{t("admin_col_capability")}</th>
                {ALL_ROLES.map((r) => (
                  <th key={r} className="px-2 py-2 text-center font-medium">
                    {t(`role_${r}` as never)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => (
                <tr key={cap.key} className="border-t border-border/60">
                  <td className="py-2.5 pe-4 text-foreground">{t(cap.key)}</td>
                  {ALL_ROLES.map((r) => {
                    const allowed = cap.allowed(r);
                    return (
                      <td key={r} className="px-2 py-2.5 text-center">
                        {allowed ? (
                          <Check className="mx-auto h-4 w-4 text-won" aria-label="allowed" />
                        ) : (
                          <Minus className="mx-auto h-4 w-4 text-muted-foreground/50" aria-label="not allowed" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Members by Role ── */}
      <Panel title={t("admin_section_holders")}>
        {teamLoading ? (
          <SkeletonTable rows={4} />
        ) : teamError ? (
          <div className="text-sm">
            <div>{t("error_generic")}</div>
            <button
              onClick={() => refetchTeam()}
              className="mt-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted"
            >
              {t("retry")}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {ALL_ROLES.map((r) => {
              const list = holders(r);
              return (
                <div key={r} className="rounded-lg border border-border/60 bg-background/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <StatusPill tone={roleTone(r)}>{t(`role_${r}` as never)}</StatusPill>
                    <span className="text-[11px] text-muted-foreground">{list.length}</span>
                  </div>
                  {list.length === 0 ? (
                    <div className="text-xs text-muted-foreground">{t("admin_no_holders")}</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {list.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate text-foreground">
                            {m.full_name || (lang === "ar" ? "بدون اسم" : "Unnamed")}
                          </span>
                          <span className="min-w-0 truncate text-xs text-muted-foreground">
                            {m.email}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ── Assign Roles + Suspend/Activate ── */}
      <Panel title={t("admin_section_assign")}>
        {teamLoading ? (
          <SkeletonTable rows={4} />
        ) : team.length === 0 ? (
          <EmptyState message={t("empty_team")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pe-4 text-start font-medium">{t("team_col_member")}</th>
                  {ALL_ROLES.map((r) => (
                    <th key={r} className="px-2 py-2 text-center font-medium">
                      {t(`role_${r}` as never)}
                    </th>
                  ))}
                  {canManage && (
                    <th className="px-2 py-2 text-center font-medium">{t("admin_col_status")}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {team.map((m) => {
                  const isSelf = m.id === user?.id;
                  return (
                    <tr key={m.id} className="border-t border-border/60">
                      <td className="py-2.5 pe-4">
                        <div className="truncate text-foreground">
                          {m.full_name || (lang === "ar" ? "بدون اسم" : "Unnamed")}
                          {isSelf ? (
                            <span className="ms-2 text-[11px] text-muted-foreground">
                              {lang === "ar" ? "(أنت)" : "(you)"}
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                      </td>
                      {ALL_ROLES.map((role) => {
                        const has = m.roles.includes(role);
                        const isManagerRole = isExecutive(role) || isSalesManager(role);
                        const guardSelf = isSelf && has && isManagerRole;
                        const disabled = !canManage || guardSelf;
                        return (
                          <td key={role} className="px-2 py-2 text-center">
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => toggleRole(m, role, has)}
                              title={
                                guardSelf
                                  ? lang === "ar"
                                    ? "لا يمكنك سحب دور الإدارة الخاص بك"
                                    : "You cannot revoke your own manager role"
                                  : undefined
                              }
                              className={
                                "rounded-md border px-2.5 py-1 text-[11px] transition-colors " +
                                (has
                                  ? "border-amber/40 bg-amber/10 text-amber-light hover:bg-amber/20"
                                  : "border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground") +
                                (disabled ? " cursor-not-allowed opacity-50 hover:bg-transparent" : "")
                              }
                            >
                              {has ? "✓" : "+"}
                            </button>
                          </td>
                        );
                      })}
                      {canManage && (
                        <td className="px-2 py-2 text-center">
                          {isSelf ? (
                            <span className="text-[11px] text-muted-foreground/50">—</span>
                          ) : m.status === "active" ? (
                            <button
                              type="button"
                              onClick={() => handleSuspend(m)}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                            >
                              <ShieldOff className="h-3 w-3" />
                              {t("admin_user_suspend")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleActivate(m)}
                              className="inline-flex items-center gap-1 rounded-md border border-won/30 bg-won/10 px-2 py-1 text-[11px] text-won transition-colors hover:bg-won/[0.15]"
                            >
                              <ShieldCheck className="h-3 w-3" />
                              {t("admin_user_activate")}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
