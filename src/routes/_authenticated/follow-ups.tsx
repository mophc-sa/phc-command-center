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
import { completeFollowUp } from "@/lib/opportunity-actions";

export const Route = createFileRoute("/_authenticated/follow-ups")({
  head: () => ({ meta: [{ title: "Follow-ups — PHC" }, { name: "robots", content: "noindex" }] }),
  component: FollowUpsPage,
});

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function FollowUpsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [completeFor, setCompleteFor] = useState<{ id: string; oppId: string } | null>(null);

  const { data = [] } = useQuery({
    queryKey: ["all-followups"],
    queryFn: async () =>
      (
        await supabase
          .from("follow_ups")
          .select("*, opportunities(id, project_name)")
          .neq("status", "completed")
          .order("due_date", { ascending: true })
      ).data ?? [],
  });

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader title={t("nav_follow_ups")} count={data.length} />
      {data.length === 0 ? (
        <EmptyState message={t("empty_follow_ups")} />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          {data.map((f: any) => {
            const overdue =
              f.due_date && f.status !== "completed" && new Date(f.due_date) < new Date();
            return (
              <div
                key={f.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border/70 px-4 py-3 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={overdue ? "attention" : "neutral"}>
                      {overdue ? "Overdue" : humanize(f.status)}
                    </StatusPill>
                    <span className="text-xs text-muted-foreground">
                      {humanize(f.channel)} · {t("label_tier")} {f.cadence_tier}
                    </span>
                  </div>
                  {f.opportunities?.project_name ? (
                    <Link
                      to="/opportunities/$id"
                      params={{ id: f.opportunities.id }}
                      className="mt-1 block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {f.opportunities.project_name}
                    </Link>
                  ) : null}
                  {f.notes ? (
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {f.notes}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <div className="num text-right text-xs text-muted-foreground" data-tabular="true">
                    {f.due_date}
                  </div>
                  <button
                    onClick={() => setCompleteFor({ id: f.id, oppId: f.opportunity_id })}
                    className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20"
                  >
                    {t("action_complete")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ActionDialog
        open={!!completeFor}
        onOpenChange={(v) => !v && setCompleteFor(null)}
        title={t("dialog_complete_title")}
        description={t("dialog_complete_desc")}
        submitLabel={t("action_complete")}
        fields={[{ key: "outcome", type: "textarea", label: t("field_outcome"), required: true }]}
        onSubmit={async (v) => {
          try {
            await completeFollowUp({
              followUpId: completeFor!.id,
              opportunityId: completeFor!.oppId,
              outcome: v.outcome,
            });
            toast.success(t("toast_complete_ok"));
            qc.invalidateQueries({ queryKey: ["all-followups"] });
            qc.invalidateQueries({ queryKey: ["cc-metrics"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
