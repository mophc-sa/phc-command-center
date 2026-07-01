import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
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

type Decision = "approved" | "returned" | "escalated";

function ApprovalsPage() {
  const { t, lang } = useI18n();
  const { hasAnyRole } = useAuth();
  const canDecide = hasAnyRole(["ceo", "sales_manager"]);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "recent">("pending");
  const [decideFor, setDecideFor] = useState<{
    id: string;
    oppId: string;
    kind: Decision;
  } | null>(null);

  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["approvals", filter],
    queryFn: async () => {
      const q = supabase
        .from("approvals")
        .select("*, opportunities(id, project_name, client)")
        .order("created_at", { ascending: filter === "pending" });
      const { data, error } =
        filter === "pending" ? await q.eq("status", "pending") : await q.limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const dialogCopy: Record<Decision, { title: string; desc: string; label: string; toastKey: any }> = {
    approved: {
      title: t("dialog_approve_title"),
      desc: t("dialog_approve_desc"),
      label: t("action_approve"),
      toastKey: "toast_approve_ok",
    },
    returned: {
      title: t("dialog_return_title"),
      desc: t("dialog_return_desc"),
      label: t("action_return"),
      toastKey: "toast_return_ok",
    },
    escalated: {
      title: t("dialog_escalate_title"),
      desc: t("dialog_escalate_desc"),
      label: t("action_escalate"),
      toastKey: "toast_escalate_ok",
    },
  };

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader title={t("nav_approvals")} count={data.length} />

      <div className="mb-4 flex gap-2 text-xs">
        {(["pending", "recent"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              "rounded-md border px-3 py-1.5 transition-colors " +
              (filter === f
                ? "border-amber/40 bg-amber/10 text-amber-light"
                : "border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground")
            }
          >
            {f === "pending"
              ? lang === "ar"
                ? "قيد الانتظار"
                : "Pending"
              : lang === "ar"
                ? "الأحدث"
                : "Recent"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-sm">
          <div className="text-foreground">{t("approvals_error")}</div>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted"
          >
            {t("retry")}
          </button>
        </div>
      ) : data.length === 0 ? (
        <EmptyState message={t("empty_approvals")} />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          {data.map((a: any) => {
            const pending = a.status === "pending";
            const statusTone =
              a.status === "approved"
                ? "positive"
                : a.status === "returned"
                  ? "danger"
                  : a.status === "escalated"
                    ? "attention"
                    : "attention";
            return (
              <div
                key={a.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border/70 px-4 py-3 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={statusTone}>{humanize(a.status)}</StatusPill>
                    <StatusPill tone="muted">{humanize(a.approval_type)}</StatusPill>
                    {a.recommendation ? (
                      <StatusPill tone="neutral">{humanize(a.recommendation)}</StatusPill>
                    ) : null}
                  </div>
                  {a.opportunities?.project_name ? (
                    <Link
                      to="/opportunities/$id"
                      params={{ id: a.opportunities.id }}
                      className="mt-1 block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {a.opportunities.project_name}
                    </Link>
                  ) : null}
                  {a.decision_notes ? (
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {a.decision_notes}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-2 text-xs">
                  {pending ? (
                    <>
                      <button
                        className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-amber-light hover:bg-amber/20"
                        onClick={() =>
                          setDecideFor({ id: a.id, oppId: a.related_opportunity_id, kind: "approved" })
                        }
                      >
                        {t("action_approve")}
                      </button>
                      <button
                        className="rounded-md border border-border bg-surface px-3 py-1.5 text-foreground hover:bg-muted"
                        onClick={() =>
                          setDecideFor({ id: a.id, oppId: a.related_opportunity_id, kind: "returned" })
                        }
                      >
                        {t("action_return")}
                      </button>
                      <button
                        className="rounded-md border border-border bg-surface px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() =>
                          setDecideFor({ id: a.id, oppId: a.related_opportunity_id, kind: "escalated" })
                        }
                      >
                        {t("action_escalate_short")}
                      </button>
                    </>
                  ) : (
                    <Link
                      to="/opportunities/$id"
                      params={{ id: a.related_opportunity_id }}
                      className="rounded-md border border-border bg-surface px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {t("action_review")}
                    </Link>
                  )}
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
        fields={[
          {
            key: "notes",
            type: "textarea",
            label: t("field_notes"),
            required: decideFor?.kind !== "approved",
          },
        ]}
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
            qc.invalidateQueries({ queryKey: ["cc-metrics"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
