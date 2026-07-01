import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
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

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [{ title: "Team & Permissions — PHC" }, { name: "robots", content: "noindex" }],
  }),
  component: TeamPage,
});

function roleLabel(t: (k: any) => string, r: AppRole): string {
  const key = `role_${r}` as const;
  return t(key as any);
}

function roleTone(r: AppRole): "attention" | "positive" | "neutral" | "muted" {
  if (r === "ceo" || r === "sales_manager") return "attention";
  if (r === "bd_manager") return "positive";
  return "muted";
}

function TeamPage() {
  const { t, lang } = useI18n();
  const { user, hasAnyRole } = useAuth();
  const canManage = hasAnyRole(["ceo", "sales_manager"]);
  const qc = useQueryClient();

  const { data = [], isLoading, isError, refetch } = useQuery({
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

  return (
    <div className="mx-auto max-w-5xl">
      <SectionHeader title={t("nav_team")} count={data.length} />
      <p className="mb-4 text-sm text-muted-foreground">{t("team_intro")}</p>

      {!canManage ? (
        <div className="mb-4 rounded-md border border-border bg-surface px-4 py-3 text-xs text-muted-foreground">
          {t("team_forbidden")}
        </div>
      ) : null}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : isError ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-sm">
          <div className="text-foreground">{t("error_generic")}</div>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted"
          >
            {t("retry")}
          </button>
        </div>
      ) : data.length === 0 ? (
        <EmptyState message={t("empty_team")} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] gap-4 border-b border-border/70 px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <div>{t("team_col_member")}</div>
            <div>{t("team_col_roles")}</div>
            <div className="text-right rtl:text-left">{t("team_col_manage")}</div>
          </div>
          {data.map((m) => {
            const isSelf = m.id === user?.id;
            return (
              <div
                key={m.id}
                className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] items-center gap-4 border-t border-border/60 px-4 py-3 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {m.full_name || (lang === "ar" ? "بدون اسم" : "Unnamed")}
                    {isSelf ? (
                      <span className="ms-2 text-[11px] text-muted-foreground">
                        {lang === "ar" ? "(أنت)" : "(you)"}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {m.roles.length === 0 ? (
                    <StatusPill tone="muted">{roleLabel(t, "viewer")}</StatusPill>
                  ) : (
                    m.roles.map((r) => (
                      <StatusPill key={r} tone={roleTone(r)}>
                        {roleLabel(t, r)}
                      </StatusPill>
                    ))
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-1.5 rtl:justify-start">
                  {ALL_ROLES.map((role) => {
                    const has = m.roles.includes(role);
                    const isManagerRole = role === "ceo" || role === "sales_manager";
                    const guardSelf = isSelf && has && isManagerRole;
                    const disabled = !canManage || guardSelf;
                    return (
                      <button
                        key={role}
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
                        {has ? "− " : "+ "}
                        {roleLabel(t, role)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
