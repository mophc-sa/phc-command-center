import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { decideApproval } from "@/lib/opportunity-actions";
import { useAuth } from "@/hooks/useSupabaseAuth";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({ meta: [{ title: "Approvals — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ApprovalsPage,
});

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ageDays(d?: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - dt.getTime()) / 86400000));
}

type Decision = "approved" | "returned" | "escalated";

function ApprovalsPage() {
  const { t, lang } = useI18n();
  const { hasAnyRole } = useAuth();
  const canDecide = hasAnyRole(["ceo", "sales_manager"]);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "recent">("pending");
  const [decideFor, setDecideFor] = useState<{ id: string; oppId: string; kind: Decision } | null>(null);

  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["approvals", filter],
    queryFn: async () => {
      const q = supabase
        .from("approvals")
        .select("*, opportunities(id, project_name, client)")
        .order("created_at", { ascending: filter === "pending" });
      const { data, error } = filter === "pending" ? await q.eq("status", "pending") : await q.limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Broader stats independent of active filter.
  const { data: allApprovals = [] } = useQuery({
    queryKey: ["approvals-stats"],
    queryFn: async () => (await supabase.from("approvals").select("status, created_at, decided_at").limit(500)).data ?? [],
  });

  const kpis = useMemo(() => {
    const pending = allApprovals.filter((a: any) => a.status === "pending");
    const oldest = pending.reduce<number>((m, a: any) => {
      const d = ageDays(a.created_at); return d != null && d > m ? d : m;
    }, 0);
    const approved = allApprovals.filter((a: any) => a.status === "approved").length;
    const escalated = allApprovals.filter((a: any) => a.status === "escalated").length;
    return { pending: pending.length, oldest, approved, escalated };
  }, [allApprovals]);

  const dialogCopy: Record<Decision, { title: string; desc: string; label: string; toastKey: any }> = {
    approved: { title: t("dialog_approve_title"), desc: t("dialog_approve_desc"), label: t("action_approve"), toastKey: "toast_approve_ok" },
    returned: { title: t("dialog_return_title"), desc: t("dialog_return_desc"), label: t("action_return"), toastKey: "toast_return_ok" },
    escalated: { title: t("dialog_escalate_title"), desc: t("dialog_escalate_desc"), label: t("action_escalate"), toastKey: "toast_escalate_ok" },
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Governance"
        title={t("nav_approvals")}
        description="Decision queue for owner grants, tender conversions, and workflow overrides."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pending" value={kpis.pending} icon={<Clock className="h-3.5 w-3.5" />} />
        <KpiCard label="Oldest waiting" value={`${kpis.oldest}d`} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <KpiCard label="Approved (recent)" value={kpis.approved} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
        <KpiCard label="Escalated" value={kpis.escalated} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
      </div>

      {!canDecide ? (
        <div className="mb-4 rounded-md border border-border bg-surface/60 px-4 py-3 text-xs text-muted-foreground">
          {t("approvals_forbidden")}
        </div>
      ) : null}

      <div className="mb-4 flex gap-1.5 text-xs">
        {(["pending", "recent"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 transition-colors ${filter === f ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {f === "pending"
              ? (lang === "ar" ? "قيد الانتظار" : "Pending")
              : (lang === "ar" ? "الأحدث" : "Recent")}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border/70 bg-surface/60 p-6 text-sm text-muted-foreground">{t("loading")}</div>
      ) : isError ? (
        <div className="rounded-xl border border-border/70 bg-surface/60 p-6 text-sm">
          <div className="text-foreground">{t("approvals_error")}</div>
          <button onClick={() => refetch()} className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted">
            {t("retry")}
          </button>
        </div>
      ) : data.length === 0 ? (
        <EmptyState message={t("empty_approvals")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          {data.map((a: any) => {
            const pending = a.status === "pending";
            const age = ageDays(a.created_at);
            const urgent = age != null && age >= 3;
            const statusTone =
              a.status === "approved" ? "positive"
              : a.status === "returned" ? "danger"
              : a.status === "escalated" ? "attention"
              : "attention";
            return (
              <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border/60 px-5 py-4 first:border-t-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={statusTone}>{humanize(a.status)}</StatusPill>
                    <StatusPill tone="muted">{humanize(a.approval_type)}</StatusPill>
                    {a.recommendation ? <StatusPill tone="neutral">{humanize(a.recommendation)}</StatusPill> : null}
                    {pending && age != null ? (
                      <span className={`text-[11px] num ${urgent ? "text-red-300" : "text-muted-foreground"}`} data-tabular="true">
                        {age}d waiting
                      </span>
                    ) : null}
                  </div>
                  {a.opportunities?.project_name ? (
                    <Link to="/opportunities/$id" params={{ id: a.opportunities.id }} className="mt-1.5 block truncate text-sm font-medium text-foreground hover:underline">
                      {a.opportunities.project_name}
                    </Link>
                  ) : null}
                  {a.opportunities?.client ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{a.opportunities.client}</div>
                  ) : null}
                  {a.decision_notes ? (
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.decision_notes}</div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {pending && canDecide ? (
                    <>
                      <button
                        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-medium text-emerald-200 hover:bg-emerald-500/20"
                        onClick={() => setDecideFor({ id: a.id, oppId: a.related_opportunity_id, kind: "approved" })}
                      >
                        {t("action_approve")}
                      </button>
                      <button
                        className="rounded-md border border-border bg-surface px-3 py-1.5 text-foreground hover:bg-muted"
                        onClick={() => setDecideFor({ id: a.id, oppId: a.related_opportunity_id, kind: "returned" })}
                      >
                        {t("action_return")}
                      </button>
                      <button
                        className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-amber-light hover:bg-amber/20"
                        onClick={() => setDecideFor({ id: a.id, oppId: a.related_opportunity_id, kind: "escalated" })}
                      >
                        {t("action_escalate_short")}
                      </button>
                    </>
                  ) : a.related_opportunity_id ? (
                    <Link
                      to="/opportunities/$id"
                      params={{ id: a.related_opportunity_id }}
                      className="rounded-md border border-border bg-surface px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {t("action_review")}
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ActionDialog
        open={!!decideFor}
        onOpenChange={(v) => !v && setDecideFor(null)}
        title={decideFor ? dialogCopy[decideFor.kind].title : ""}
        description={decideFor ? dialogCopy[decideFor.kind].desc : ""}
        submitLabel={decideFor ? dialogCopy[decideFor.kind].label : ""}
        destructive={decideFor?.kind === "returned" || decideFor?.kind === "escalated"}
        fields={[{ key: "notes", type: "textarea", label: t("field_notes"), required: decideFor?.kind !== "approved" }]}
        onSubmit={async (v) => {
          try {
            await decideApproval({
              approvalId: decideFor!.id,
              opportunityId: decideFor!.oppId,
              decision: decideFor!.kind,
              notes: v.notes,
            });
            toast.success(t(dialogCopy[decideFor!.kind].toastKey));
            qc.invalidateQueries({ queryKey: ["approvals"] });
            qc.invalidateQueries({ queryKey: ["approvals-stats"] });
            qc.invalidateQueries({ queryKey: ["cc-metrics"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
