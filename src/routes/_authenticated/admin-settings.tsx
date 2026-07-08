import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { EmptyState } from "@/components/phc/EmptyState";
import { GitSyncStatus } from "@/components/phc/GitSyncStatus";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import {
  ALL_ROLES,
  grantRole,
  listTeam,
  revokeRole,
  type AppRole,
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

export const Route = createFileRoute("/_authenticated/admin-settings")({
  head: () => ({
    meta: [
      { title: "Admin Settings — PHC" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminSettingsPage,
});

// Capability matrix — single source of truth for what each role can do.
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

// Each capability's `allowed` predicate is derived from the canonical helpers in
// src/lib/roles.ts, so this matrix always reflects the real authority model.
const CAPABILITIES: { key: CapKey; allowed: (r: AppRole) => boolean }[] = [
  { key: "cap_manage_roles", allowed: (r) => canManageTeam(r) },
  { key: "cap_approve_decisions", allowed: (r) => canApproveCommercialAction(r) },
  { key: "cap_escalate", allowed: (r) => canApproveCommercialAction(r) },
  { key: "cap_manage_opps", allowed: (r) => canManageSalesPipeline(r) },
  { key: "cap_assign_owner", allowed: (r) => canAssignOwner(r) },
  { key: "cap_schedule_followups", allowed: (r) => canManageSalesPipeline(r) },
  { key: "cap_view_audit", allowed: (r) => canViewSalesAdmin(r) },
  // Read-only surfaces: everyone but a pure salesperson sees reports; all roles
  // can read the opportunity list (RLS SELECT is open to authenticated).
  { key: "cap_view_reports", allowed: (r) => r !== "salesperson" },
  { key: "cap_view_opps", allowed: () => true },
];

function roleTone(r: AppRole): "attention" | "positive" | "neutral" | "muted" {
  if (isExecutive(r) || isSalesManager(r)) return "attention";
  if (isBdOrSalesOps(r)) return "positive";
  if (r === "system_admin") return "neutral";
  return "muted";
}

function AdminSettingsPage() {
  const { t, lang } = useI18n();
  const { user, roles } = useAuth();
  const canManage = canManageTeam(roles);
  const qc = useQueryClient();

  const { data: team = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["team-full"],
    queryFn: listTeam,
  });

  async function toggle(member: TeamMember, role: AppRole, has: boolean) {
    try {
      if (has) {
        await revokeRole(member.id, role);
        toast.success(t("toast_role_revoked"));
      } else {
        await grantRole(member.id, role);
        toast.success(t("toast_role_granted"));
      }
      qc.invalidateQueries({ queryKey: ["team-full"] });
      qc.invalidateQueries({ queryKey: ["roles", member.id] });
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

      {!canManage ? (
        <div className="rounded-md border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber-light">
          {t("admin_settings_forbidden")}
        </div>
      ) : null}

      {/* Capabilities Matrix */}
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
                          <Check className="mx-auto h-4 w-4 text-emerald-400" aria-label="allowed" />
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

      {/* Holders by Role */}
      <Panel title={t("admin_section_holders")}>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("loading")}</div>
        ) : isError ? (
          <div className="text-sm">
            <div>{t("error_generic")}</div>
            <button
              onClick={() => refetch()}
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

      {/* Assign Roles (CEO only writes) */}
      <Panel title={t("admin_section_assign")}>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("loading")}</div>
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
                              onClick={() => toggle(m, role, has)}
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
