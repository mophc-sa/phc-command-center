import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target as TargetIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { upsertSalesTarget } from "@/lib/sales-actions";
import { cn } from "@/lib/utils";
import { canApproveCommercialAction } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/targets")({
  head: () => ({
    meta: [{ title: "Targets & Performance — PHC" }, { name: "robots", content: "noindex" }],
  }),
  component: TargetsPage,
});

function monthStart(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function ProgressRow({
  label,
  actual,
  target,
  money,
  lang,
}: {
  label: string;
  actual: number;
  target: number;
  money?: boolean;
  lang: "en" | "ar";
}) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  const fmt = (n: number) => (money ? formatCurrency(n, lang) : formatNumber(n, lang));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="num text-foreground" data-tabular="true">
          {fmt(actual)} <span className="text-muted-foreground">/ {fmt(target)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-emerald-400/80" : "bg-amber/80")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TargetsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { roles } = useAuth();
  const isManager = canApproveCommercialAction(roles);
  const [setOpen, setSetOpen] = useState(false);
  const period = monthStart();

  const { data: targets = [], isLoading } = useQuery({
    queryKey: ["targets", period],
    queryFn: async () =>
      (
        await supabase
          .from("sales_targets")
          .select("*")
          .eq("period_type", "monthly")
          .eq("period_start", period)
      ).data ?? [],
  });

  const { data: members = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: async () =>
      (
        await supabase
          .from("profiles")
          .select("id, full_name, email")
          .order("full_name", { ascending: true, nullsFirst: false })
      ).data ?? [],
  });

  const { data: opps = [] } = useQuery({
    queryKey: ["opps-for-targets"],
    queryFn: async () =>
      (
        await supabase
          .from("opportunities")
          .select("id, owner_id, stage, quotation_value, estimated_value_max, updated_at")
      ).data ?? [],
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ["quotes-for-targets"],
    queryFn: async () =>
      (
        await supabase
          .from("quotations")
          .select("id, owner_id, status, value, updated_at")
      ).data ?? [],
  });

  const { data: followUps = [] } = useQuery({
    queryKey: ["fu-for-targets"],
    queryFn: async () =>
      (
        await supabase
          .from("follow_ups")
          .select("id, owner_id, status, last_contact_at")
          .eq("status", "completed")
      ).data ?? [],
  });

  const rows = useMemo(() => {
    const periodDate = new Date(period);
    const inPeriod = (iso: string | null) => iso && new Date(iso) >= periodDate;
    return targets.map((tg: any) => {
      const member = members.find((m: any) => m.id === tg.user_id);
      const mine = (arr: any[], key = "owner_id") => arr.filter((r) => r[key] === tg.user_id);
      const won = mine(opps)
        .filter((o: any) => o.stage === "won" && inPeriod(o.updated_at))
        .reduce((s: number, o: any) => s + (o.quotation_value ?? o.estimated_value_max ?? 0), 0);
      const pipeline = mine(opps)
        .filter((o: any) => !["won", "lost", "archived"].includes(o.stage))
        .reduce((s: number, o: any) => s + (o.quotation_value ?? o.estimated_value_max ?? 0), 0);
      const submitted = mine(quotes).filter(
        (q: any) => !["draft", "under_internal_review"].includes(q.status) && inPeriod(q.updated_at),
      ).length;
      const activities = mine(followUps).filter((f: any) => inPeriod(f.last_contact_at)).length;
      return { target: tg, member, actuals: { won, pipeline, submitted, activities } };
    });
  }, [targets, members, opps, quotes, followUps, period]);

  const teamKpis = useMemo(() => {
    const teamSalesTarget = rows.reduce((s: number, r: any) => s + Number(r.target.sales_target ?? 0), 0);
    const teamSalesActual = rows.reduce((s: number, r: any) => s + r.actuals.won, 0);
    const teamPipelineTarget = rows.reduce((s: number, r: any) => s + Number(r.target.pipeline_target ?? 0), 0);
    const teamPipelineActual = rows.reduce((s: number, r: any) => s + r.actuals.pipeline, 0);
    const teamQuotesTarget = rows.reduce((s: number, r: any) => s + Number(r.target.quotation_target ?? 0), 0);
    const teamQuotesActual = rows.reduce((s: number, r: any) => s + r.actuals.submitted, 0);
    const attain = teamSalesTarget > 0 ? Math.round((teamSalesActual / teamSalesTarget) * 100) : 0;
    return { teamSalesTarget, teamSalesActual, teamPipelineTarget, teamPipelineActual, teamQuotesTarget, teamQuotesActual, attain };
  }, [rows]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={t("nav_performance" as never) || "Performance"}
        title={t("nav_targets")}
        description={t("targets_intro")}
        actions={
          isManager ? (
            <button
              onClick={() => setSetOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("action_set_target")}
            </button>
          ) : undefined
        }
      />

      {rows.length > 0 ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label={t("target_sales")}
            value={formatCurrency(teamKpis.teamSalesActual, lang)}
            hint={`${lang === "ar" ? "الهدف" : "Target"}: ${formatCurrency(teamKpis.teamSalesTarget, lang)}`}
            icon={<TargetIcon className="h-3.5 w-3.5" />}
          />
          <KpiCard
            label={lang === "ar" ? "نسبة التحقق" : "Attainment"}
            value={`${teamKpis.attain}%`}
            trend={teamKpis.attain >= 100 ? "up" : teamKpis.attain >= 60 ? "flat" : "down"}
          />
          <KpiCard
            label={t("target_pipeline")}
            value={formatCurrency(teamKpis.teamPipelineActual, lang)}
            hint={`${lang === "ar" ? "الهدف" : "Target"}: ${formatCurrency(teamKpis.teamPipelineTarget, lang)}`}
          />
          <KpiCard
            label={t("target_quotations")}
            value={teamKpis.teamQuotesActual}
            hint={`${lang === "ar" ? "الهدف" : "Target"}: ${teamKpis.teamQuotesTarget}`}
          />
        </div>
      ) : null}

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : rows.length === 0 ? (
        <EmptyState message={t("empty_targets")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(({ target: tg, member, actuals }) => {
            const attain = Number(tg.sales_target) > 0 ? Math.round((actuals.won / Number(tg.sales_target)) * 100) : 0;
            return (
              <div key={tg.id} className="rounded-xl border border-border/70 bg-surface/60 p-5">
                <div className="mb-4 flex items-baseline justify-between gap-2">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {member?.full_name ?? member?.email ?? "—"}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "num rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      attain >= 100 ? "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200"
                        : attain >= 60 ? "border-amber/35 bg-amber/[0.08] text-amber-light"
                        : "border-border/60 text-muted-foreground",
                    )} data-tabular="true">{attain}%</span>
                    <span className="num text-[11px] text-muted-foreground" data-tabular="true">{tg.period_start}</span>
                  </div>
                </div>
                <div className="space-y-3.5">
                  <ProgressRow label={t("target_sales")} actual={actuals.won} target={Number(tg.sales_target)} money lang={lang} />
                  <ProgressRow label={t("target_pipeline")} actual={actuals.pipeline} target={Number(tg.pipeline_target)} money lang={lang} />
                  <ProgressRow label={t("target_quotations")} actual={actuals.submitted} target={tg.quotation_target} lang={lang} />
                  <ProgressRow label={t("target_activities")} actual={actuals.activities} target={tg.activity_target} lang={lang} />
                </div>
                {tg.notes ? (
                  <div className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">{tg.notes}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <ActionDialog
        open={setOpen}
        onOpenChange={setSetOpen}
        title={t("dialog_set_target_title")}
        description={t("dialog_set_target_desc")}
        submitLabel={t("action_set_target")}
        fields={[
          {
            key: "userId",
            type: "select",
            label: t("field_member"),
            required: true,
            options: members.map((m: any) => ({
              value: m.id,
              label: m.full_name ?? m.email ?? m.id,
            })),
          },
          {
            key: "periodStart",
            type: "date",
            label: t("field_period_start"),
            required: true,
            defaultValue: period,
          },
          { key: "salesTarget", type: "text", label: t("field_sales_target"), required: true },
          { key: "pipelineTarget", type: "text", label: t("field_pipeline_target"), required: true },
          { key: "quotationTarget", type: "text", label: t("field_quotation_target"), required: true },
          { key: "activityTarget", type: "text", label: t("field_activity_target"), required: true },
          { key: "notes", type: "textarea", label: t("field_notes") },
        ]}
        onSubmit={async (v) => {
          try {
            await upsertSalesTarget({
              userId: v.userId,
              periodType: "monthly",
              periodStart: v.periodStart,
              salesTarget: Number(v.salesTarget) || 0,
              pipelineTarget: Number(v.pipelineTarget) || 0,
              quotationTarget: Number(v.quotationTarget) || 0,
              activityTarget: Number(v.activityTarget) || 0,
              notes: v.notes || undefined,
            });
            toast.success(t("toast_target_saved"));
            qc.invalidateQueries({ queryKey: ["targets", period] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
