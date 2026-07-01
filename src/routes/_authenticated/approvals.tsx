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

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({ meta: [{ title: "Approvals — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ApprovalsPage,
});

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ApprovalsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [decideFor, setDecideFor] = useState<{
    id: string;
    oppId: string;
    kind: "approved" | "returned";
  } | null>(null);

  const { data = [] } = useQuery({
    queryKey: ["approvals"],
    queryFn: async () =>
      (
        await supabase
          .from("approvals")
          .select("*, opportunities(id, project_name, client)")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
      ).data ?? [],
  });

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader title={t("nav_approvals")} count={data.length} />
      {data.length === 0 ? (
        <EmptyState message={t("empty_approvals")} />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          {data.map((a: any) => (
            <div
              key={a.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border/70 px-4 py-3 first:border-t-0"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="attention">{humanize(a.approval_type)}</StatusPill>
                  {a.recommendation ? (
                    <StatusPill tone="muted">{humanize(a.recommendation)}</StatusPill>
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
              </div>
            </div>
          ))}
        </div>
      )}

      <ActionDialog
        open={!!decideFor}
        onOpenChange={(v) => !v && setDecideFor(null)}
        title={
          decideFor?.kind === "approved" ? t("dialog_approve_title") : t("dialog_return_title")
        }
        description={
          decideFor?.kind === "approved" ? t("dialog_approve_desc") : t("dialog_return_desc")
        }
        submitLabel={
          decideFor?.kind === "approved" ? t("action_approve") : t("action_return")
        }
        destructive={decideFor?.kind === "returned"}
        fields={[
          {
            key: "notes",
            type: "textarea",
            label: t("field_notes"),
            required: decideFor?.kind === "returned",
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
            toast.success(
              t(decideFor!.kind === "approved" ? "toast_approve_ok" : "toast_return_ok"),
            );
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
