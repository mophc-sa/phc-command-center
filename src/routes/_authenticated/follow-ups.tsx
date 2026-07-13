import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatNumber } from "@/lib/i18n";
import { completeFollowUp, rescheduleFollowUp } from "@/lib/opportunity-actions";
import { EmailComposeButton } from "@/components/phc/EmailComposeButton";
import { humanize } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/follow-ups")({
  head: () => ({ meta: [{ title: "Follow-ups — PHC" }, { name: "robots", content: "noindex" }] }),
  component: FollowUpsPage,
});

type Bucket = "overdue" | "today" | "upcoming";

function FollowUpsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [completeFor, setCompleteFor] = useState<{ id: string; oppId: string } | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<{ id: string; oppId: string; currentDate: string } | null>(null);
  const [bucket, setBucket] = useState<Bucket | "all">("all");

  const today = new Date().toISOString().slice(0, 10);

  const { data = [] } = useQuery({
    queryKey: ["all-followups"],
    queryFn: async () =>
      (await supabase
        .from("follow_ups")
        .select("*, opportunities(id, project_name, main_contractor, tier, owner_id)")
        .neq("status", "completed")
        .order("due_date", { ascending: true })
      ).data ?? [],
  });

  const grouped = useMemo(() => {
    const g = { overdue: [] as any[], today: [] as any[], upcoming: [] as any[] };
    for (const f of data as any[]) {
      const dd = f.due_date as string | null;
      if (f.status === "overdue" || (dd && dd < today)) g.overdue.push(f);
      else if (dd === today) g.today.push(f);
      else g.upcoming.push(f);
    }
    return g;
  }, [data, today]);

  const visible = bucket === "all" ? [...grouped.overdue, ...grouped.today, ...grouped.upcoming] : grouped[bucket];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={lang === "ar" ? "المتابعات" : "Cadence"}
        title={t("nav_follow_ups")}
        description={lang === "ar" ? "المتابعات المستحقة والمتأخرة والمجدولة عبر خط الأنابيب." : "Due, overdue, and scheduled follow-ups across the pipeline."}
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <KpiCard label={lang === "ar" ? "متأخر" : "Overdue"} value={formatNumber(grouped.overdue.length, lang)} hint={lang === "ar" ? "تجاوزت الاستحقاق" : "Past due date"} trend={grouped.overdue.length > 0 ? "down" : "flat"} />
        <KpiCard label={lang === "ar" ? "اليوم" : "Today"} value={formatNumber(grouped.today.length, lang)} hint={lang === "ar" ? "مستحق الآن" : "Due today"} />
        <KpiCard label={lang === "ar" ? "قادم" : "Upcoming"} value={formatNumber(grouped.upcoming.length, lang)} hint={lang === "ar" ? "مجدول لاحقاً" : "Scheduled later"} />
      </section>

      <div className="mb-4 flex gap-1.5">
        {(["all", "overdue", "today", "upcoming"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setBucket(k)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
              bucket === k
                ? "border-amber/40 bg-amber/10 text-amber-light"
                : "border-border/70 bg-surface/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {k === "all" ? (lang === "ar" ? "الكل" : "All") : humanize(k)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-surface/60 py-10">
          <EmptyState message={t("empty_follow_ups")} />
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          {visible.map((f: any) => {
            const dd = f.due_date as string | null;
            const isOverdue = f.status === "overdue" || (dd && dd < today);
            const isToday = dd === today;
            const opp = f.opportunities;
            return (
              <li key={f.id} className="border-t border-border/60 first:border-t-0">
                <div className="grid grid-cols-[3px_minmax(0,1fr)_auto] items-stretch">
                  <div className={isOverdue ? "bg-amber/70" : isToday ? "bg-foreground/40" : "bg-transparent"} />
                  <div className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={isOverdue ? "attention" : isToday ? "neutral" : "muted"}>
                        {isOverdue ? (lang === "ar" ? "متأخر" : "Overdue") : isToday ? (lang === "ar" ? "اليوم" : "Today") : humanize(f.status)}
                      </StatusPill>
                      {opp?.tier ? <StatusPill tone={opp.tier === "A" ? "attention" : "muted"}>{t("label_tier")} {opp.tier}</StatusPill> : null}
                      <span className="text-[11px] text-muted-foreground">{humanize(f.channel)}</span>
                      {f.cadence_tier ? <span className="text-[11px] text-muted-foreground">· {t("label_tier")} {f.cadence_tier}</span> : null}
                    </div>
                    {opp?.project_name ? (
                      <Link to="/opportunities/$id" params={{ id: opp.id }} className="mt-1.5 block truncate text-[13px] font-medium text-foreground hover:underline">
                        {opp.project_name}
                      </Link>
                    ) : null}
                    {opp?.main_contractor ? (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{opp.main_contractor}</div>
                    ) : null}
                    {f.notes ? (
                      <div className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{f.notes}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 pe-4">
                    <div className="num text-right text-[11px] text-muted-foreground tabular-nums" data-tabular="true">
                      {dd ?? "—"}
                    </div>
                    <EmailComposeButton
                      size="xs"
                      variant="ghost"
                      template="opportunity_follow_up"
                      context={{
                        projectName: opp?.project_name ?? null,
                        opportunityName: opp?.project_name ?? null,
                        companyName: opp?.main_contractor ?? null,
                        nextAction: f.notes ?? null,
                      }}
                      linked={
                        opp
                          ? {
                              type: "follow_up",
                              id: f.id,
                              label: opp.project_name,
                              opportunityId: opp.id,
                            }
                          : null
                      }
                    />
                    <button
                      onClick={() => setRescheduleFor({ id: f.id, oppId: f.opportunity_id, currentDate: dd ?? "" })}
                      title={lang === "ar" ? "إعادة الجدولة" : "Reschedule"}
                      className="grid h-7 w-7 place-items-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setCompleteFor({ id: f.id, oppId: f.opportunity_id })}
                      title={lang === "ar" ? "تمت" : "Mark complete"}
                      className="grid h-7 w-7 place-items-center rounded-md border border-amber/40 bg-amber/10 text-amber-light transition-colors hover:bg-amber/20"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
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
            qc.invalidateQueries({ queryKey: ["cc-core"] });
            qc.invalidateQueries({ queryKey: ["workspace"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={!!rescheduleFor}
        onOpenChange={(v) => !v && setRescheduleFor(null)}
        title={lang === "ar" ? "إعادة جدولة المتابعة" : "Reschedule Follow-up"}
        description={lang === "ar" ? "اختر تاريخاً جديداً للمتابعة." : "Pick a new due date for this follow-up."}
        submitLabel={lang === "ar" ? "إعادة الجدولة" : "Reschedule"}
        fields={[
          {
            key: "dueDate",
            type: "date",
            label: lang === "ar" ? "التاريخ الجديد" : "New date",
            required: true,
            defaultValue: rescheduleFor?.currentDate ?? "",
          },
          { key: "notes", type: "textarea", label: lang === "ar" ? "ملاحظات (اختياري)" : "Notes (optional)" },
        ]}
        onSubmit={async (v) => {
          try {
            await rescheduleFollowUp({
              followUpId: rescheduleFor!.id,
              opportunityId: rescheduleFor!.oppId,
              dueDate: v.dueDate,
              notes: v.notes || undefined,
            });
            toast.success(lang === "ar" ? "تمت إعادة الجدولة." : "Follow-up rescheduled.");
            qc.invalidateQueries({ queryKey: ["all-followups"] });
            qc.invalidateQueries({ queryKey: ["cc-core"] });
            qc.invalidateQueries({ queryKey: ["workspace"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
