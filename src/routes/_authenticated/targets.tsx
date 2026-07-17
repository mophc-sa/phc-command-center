import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target as TargetIcon, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { upsertSalesTarget } from "@/lib/sales-actions";
import { cn } from "@/lib/utils";
import { canApproveCommercialAction } from "@/lib/roles";
import {
  computeSalespersonMetrics,
  computeManagerMetrics,
  validateConversionTarget,
  normalizePeriodStart,
  type SalesTargetRow,
  type OpportunityRow,
  type RfqRow,
  type TenderRow,
  type QuotationRow,
  type FollowUpRow,
  type ActionFlagRow,
} from "@/lib/targets-metrics";

export const Route = createFileRoute("/_authenticated/targets")({
  head: () => ({
    meta: [{ title: "Targets & Performance — PHC" }, { name: "robots", content: "noindex" }],
  }),
  component: TargetsPage,
});

function monthStart(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Month selector options for the Set Target dialog (Required Fix 3): a
// curated dropdown of already-normalized YYYY-MM-01 values, so a manager can
// never pick a mid-month date that would create a target row no query ever
// looks up again. Covers 2 months back (catch-up) through 11 months forward.
function monthOptions(lang: "en" | "ar") {
  const now = new Date();
  const opts: { value: string; label: string }[] = [];
  for (let i = -2; i <= 11; i++) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const label = d.toLocaleDateString(lang === "ar" ? "ar" : "en", { month: "long", year: "numeric", timeZone: "UTC" });
    opts.push({ value, label });
  }
  return opts;
}

function ProgressRow({
  label,
  actual,
  target,
  money,
  suffix,
  lang,
}: {
  label: string;
  actual: number;
  target: number;
  money?: boolean;
  suffix?: string;
  lang: "en" | "ar";
}) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  const fmt = (n: number) => (money ? formatCurrency(n, lang) : `${formatNumber(n, lang)}${suffix ?? ""}`);
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
          className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-won/80" : "bg-amber/80")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatRow({ label, value, lang: _lang }: { label: string; value: string | number; lang: "en" | "ar" }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="num text-foreground" data-tabular="true">
        {value}
      </span>
    </div>
  );
}

function TargetsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const isManager = canApproveCommercialAction(roles);
  const [setOpen, setSetOpen] = useState(false);
  const [tab, setTab] = useState<"mine" | "team">("mine");
  const period = monthStart();
  const today = todayIso();

  const { data: targets = [], isLoading } = useQuery({
    queryKey: ["targets", period],
    queryFn: async () =>
      (
        (await supabase.from("sales_targets").select("*").eq("period_type", "monthly").eq("period_start", period))
          .data ?? []
      ) as SalesTargetRow[],
  });

  const { data: members = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: async () =>
      (
        await supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true, nullsFirst: false })
      ).data ?? [],
  });

  const { data: opportunities = [] } = useQuery({
    queryKey: ["opps-for-targets"],
    queryFn: async () =>
      (
        (await supabase
          .from("opportunities")
          .select("id, owner_id, stage, tier, estimated_value_max, quotation_value, win_confidence, updated_at")) as {
          data: OpportunityRow[] | null;
        }
      ).data ?? [],
  });

  const { data: quotations = [] } = useQuery({
    queryKey: ["quotes-for-targets"],
    queryFn: async () =>
      (
        (await supabase.from("quotations").select("id, owner_id, status, value, updated_at")) as {
          data: QuotationRow[] | null;
        }
      ).data ?? [],
  });

  const { data: followUps = [] } = useQuery({
    queryKey: ["fu-for-targets"],
    queryFn: async () =>
      (
        (await supabase.from("follow_ups").select("id, owner_id, status, last_contact_at")) as {
          data: FollowUpRow[] | null;
        }
      ).data ?? [],
  });

  const { data: rfqs = [] } = useQuery({
    queryKey: ["rfqs-for-targets"],
    queryFn: async () =>
      (
        (await supabase.from("rfqs").select("id, sales_owner_id, status, updated_at")) as { data: RfqRow[] | null }
      ).data ?? [],
  });

  const { data: tenders = [] } = useQuery({
    queryKey: ["tenders-for-targets"],
    queryFn: async () =>
      (
        (await supabase.from("tenders").select("id, tender_owner_id, tender_stage, updated_at")) as {
          data: TenderRow[] | null;
        }
      ).data ?? [],
  });

  const { data: actionFlags = [] } = useQuery({
    queryKey: ["flags-for-targets"],
    queryFn: async () =>
      (
        (await supabase
          .from("opportunity_flags")
          .select("id, action_owner_id, status, due_date")
          .eq("flag_kind", "action_required")) as { data: ActionFlagRow[] | null }
      ).data ?? [],
    enabled: isManager,
  });

  const memberName = (id: string) => {
    const m = members.find((mm: any) => mm.id === id);
    return m?.full_name ?? m?.email ?? "—";
  };

  const rowData = { opportunities, rfqs, tenders, quotations, followUps };

  const myTarget = useMemo(() => targets.find((t) => t.user_id === user?.id), [targets, user]);
  const myMetrics = useMemo(() => (myTarget ? computeSalespersonMetrics(myTarget, rowData) : null), [myTarget, opportunities, rfqs, tenders, quotations, followUps]);

  const perSalesperson = useMemo(
    () => targets.map((tg) => computeSalespersonMetrics(tg, rowData)),
    [targets, opportunities, rfqs, tenders, quotations, followUps],
  );

  const teamMetrics = useMemo(
    () => (isManager ? computeManagerMetrics(targets, { opportunities, rfqs, tenders, quotations, actionFlags }, today) : null),
    [isManager, targets, opportunities, rfqs, tenders, quotations, actionFlags, today],
  );

  const pipelineByOwnerRows = useMemo(() => {
    if (!teamMetrics) return [];
    return Object.entries(teamMetrics.pipelineByOwner)
      .map(([ownerId, value]) => ({ ownerId, name: memberName(ownerId), value }))
      .sort((a, b) => b.value - a.value);
  }, [teamMetrics, members]);

  const overdueByOwnerRows = useMemo(() => {
    if (!teamMetrics) return [];
    return Object.entries(teamMetrics.overdueActionsByOwner)
      .map(([ownerId, count]) => ({ ownerId, name: memberName(ownerId), count }))
      .sort((a, b) => b.count - a.count);
  }, [teamMetrics, members]);

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

      {isManager ? (
        <div className="mb-6 flex gap-1.5">
          <button
            onClick={() => setTab("mine")}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs",
              tab === "mine" ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t("targets_tab_mine")}
          </button>
          <button
            onClick={() => setTab("team")}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs",
              tab === "team" ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <Users className="me-1 inline h-3 w-3" />
            {t("targets_tab_team")}
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <SkeletonTable rows={5} />
      ) : tab === "mine" ? (
        !myMetrics ? (
          <EmptyState message={t("empty_targets")} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-surface/60 p-5">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-foreground">{t("targets_section_target")}</div>
                <span
                  className={cn(
                    "num rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    myMetrics.achievement >= 100
                      ? "border-won/25 bg-won/[0.07] text-won"
                      : myMetrics.achievement >= 60
                        ? "border-amber/35 bg-amber/[0.08] text-amber-light"
                        : "border-border/60 text-muted-foreground",
                  )}
                  data-tabular="true"
                >
                  {myMetrics.achievement}%
                </span>
              </div>
              <div className="mb-5 grid grid-cols-2 gap-3">
                <KpiCard label={t("target_won")} value={formatCurrency(myMetrics.wonValue, lang)} icon={<TargetIcon className="h-3.5 w-3.5" />} />
                <KpiCard label={t("target_remaining")} value={formatCurrency(myMetrics.remaining, lang)} />
              </div>
              <div className="space-y-3.5">
                <ProgressRow label={t("target_sales")} actual={myMetrics.wonValue} target={Number(myTarget!.sales_target)} money lang={lang} />
                <ProgressRow label={t("target_pipeline")} actual={myMetrics.openPipeline} target={Number(myTarget!.pipeline_target)} money lang={lang} />
                <ProgressRow label={t("target_quotations")} actual={myMetrics.quotationsSent} target={Number(myTarget!.quotation_target)} lang={lang} />
                <ProgressRow label={t("target_activities")} actual={myMetrics.completedFollowUps} target={Number(myTarget!.activity_target)} lang={lang} />
                <ProgressRow label={t("target_conversion")} actual={myMetrics.conversionRate} target={Number(myTarget!.conversion_target)} suffix="%" lang={lang} />
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-surface/60 p-5">
              <div className="mb-4 text-sm font-semibold text-foreground">{t("targets_section_activity")}</div>
              <StatRow label={t("target_open_pipeline")} value={formatCurrency(myMetrics.openPipeline, lang)} lang={lang} />
              <StatRow label={t("target_followups_completed")} value={formatNumber(myMetrics.completedFollowUps, lang)} lang={lang} />
              <StatRow label={t("target_rfqs_reviewed")} value={formatNumber(myMetrics.rfqsReviewed, lang)} lang={lang} />
              <StatRow label={t("target_tenders_followed")} value={formatNumber(myMetrics.tendersFollowed, lang)} lang={lang} />
              <StatRow label={t("target_quotations_sent")} value={formatNumber(myMetrics.quotationsSent, lang)} lang={lang} />
              <StatRow label={t("target_conversion_rate")} value={`${myMetrics.conversionRate}%`} lang={lang} />
            </div>
          </div>
        )
      ) : teamMetrics ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={t("mgr_team_target")}
              value={formatCurrency(teamMetrics.teamActual, lang)}
              hint={`${lang === "ar" ? "الهدف" : "Target"}: ${formatCurrency(teamMetrics.teamTarget, lang)}`}
              icon={<TargetIcon className="h-3.5 w-3.5" />}
            />
            <KpiCard
              label={lang === "ar" ? "نسبة التحقق" : "Attainment"}
              value={`${teamMetrics.teamAchievement}%`}
              trend={teamMetrics.teamAchievement >= 100 ? "up" : teamMetrics.teamAchievement >= 60 ? "flat" : "down"}
            />
            <KpiCard label={t("mgr_tier_a")} value={formatNumber(teamMetrics.tierAOpenCount, lang)} hint={formatCurrency(teamMetrics.tierAOpenValue, lang)} />
            <KpiCard label={t("mgr_forecast")} value={formatCurrency(teamMetrics.forecast, lang)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <KpiCard label={t("mgr_rfq_conversion")} value={`${teamMetrics.rfqConversionPct}%`} />
            <KpiCard label={t("mgr_tender_conversion")} value={`${teamMetrics.tenderConversionPct}%`} />
            <KpiCard label={t("mgr_quotation_win_rate")} value={`${teamMetrics.quotationWinRatePct}%`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-surface/60 p-5">
              <div className="mb-3 text-sm font-semibold text-foreground">{t("mgr_pipeline_by_owner")}</div>
              {pipelineByOwnerRows.length === 0 ? (
                <div className="text-xs text-muted-foreground">{t("empty_targets")}</div>
              ) : (
                pipelineByOwnerRows.map((r) => <StatRow key={r.ownerId} label={r.name} value={formatCurrency(r.value, lang)} lang={lang} />)
              )}
            </div>
            <div className="rounded-xl border border-border/70 bg-surface/60 p-5">
              <div className="mb-3 text-sm font-semibold text-foreground">{t("mgr_overdue_by_owner")}</div>
              {overdueByOwnerRows.length === 0 ? (
                <div className="text-xs text-muted-foreground">{t("mgr_no_overdue")}</div>
              ) : (
                overdueByOwnerRows.map((r) => <StatRow key={r.ownerId} label={r.name} value={formatNumber(r.count, lang)} lang={lang} />)
              )}
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-foreground">{t("mgr_target_by_salesperson")}</div>
            {perSalesperson.length === 0 ? (
              <EmptyState message={t("empty_targets")} />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {perSalesperson.map((m) => (
                  <div key={m.target.id} className="rounded-xl border border-border/70 bg-surface/60 p-5">
                    <div className="mb-4 flex items-baseline justify-between gap-2">
                      <div className="truncate text-sm font-semibold text-foreground">{memberName(m.userId)}</div>
                      <span
                        className={cn(
                          "num rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          m.achievement >= 100
                            ? "border-won/25 bg-won/[0.07] text-won"
                            : m.achievement >= 60
                              ? "border-amber/35 bg-amber/[0.08] text-amber-light"
                              : "border-border/60 text-muted-foreground",
                        )}
                        data-tabular="true"
                      >
                        {m.achievement}%
                      </span>
                    </div>
                    <div className="space-y-3.5">
                      <ProgressRow label={t("target_sales")} actual={m.wonValue} target={Number(m.target.sales_target)} money lang={lang} />
                      <ProgressRow label={t("target_pipeline")} actual={m.openPipeline} target={Number(m.target.pipeline_target)} money lang={lang} />
                      <ProgressRow label={t("target_quotations")} actual={m.quotationsSent} target={Number(m.target.quotation_target)} lang={lang} />
                      <ProgressRow label={t("target_activities")} actual={m.completedFollowUps} target={Number(m.target.activity_target)} lang={lang} />
                    </div>
                    {m.target.notes ? <div className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">{m.target.notes}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

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
            type: "select",
            label: t("field_period_start"),
            required: true,
            defaultValue: period,
            options: monthOptions(lang),
          },
          { key: "salesTarget", type: "text", label: t("field_sales_target"), required: true },
          { key: "pipelineTarget", type: "text", label: t("field_pipeline_target"), required: true },
          { key: "quotationTarget", type: "text", label: t("field_quotation_target"), required: true },
          { key: "activityTarget", type: "text", label: t("field_activity_target"), required: true },
          { key: "conversionTarget", type: "text", label: t("field_conversion_target"), required: true },
          { key: "notes", type: "textarea", label: t("field_notes") },
        ]}
        onSubmit={async (v) => {
          // Client-side validation (Required Fix 2 / Fix 3): reject clearly
          // rather than silently coercing bad input to 0, and never send an
          // un-normalized period_start. sales-actions.ts re-validates both
          // independently as defense in depth, and the DB CHECK constraint
          // re-validates conversion_target independently of both.
          const conversionCheck = validateConversionTarget(v.conversionTarget);
          if (!conversionCheck.ok) {
            toast.error(conversionCheck.error);
            return;
          }
          const normalizedPeriod = normalizePeriodStart("monthly", v.periodStart);
          if (!normalizedPeriod.ok) {
            toast.error(normalizedPeriod.error);
            return;
          }
          try {
            await upsertSalesTarget({
              userId: v.userId,
              periodType: "monthly",
              periodStart: normalizedPeriod.value,
              salesTarget: Number(v.salesTarget) || 0,
              pipelineTarget: Number(v.pipelineTarget) || 0,
              quotationTarget: Number(v.quotationTarget) || 0,
              activityTarget: Number(v.activityTarget) || 0,
              conversionTarget: conversionCheck.value,
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
