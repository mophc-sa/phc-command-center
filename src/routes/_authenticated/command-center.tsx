import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KpiTile } from "@/components/phc/KpiTile";
import {
  MANAGEMENT_BUCKETS,
  bucketKpi,
  executiveKpis,
  forecastVsTarget,
  thisMonth,
  type ManagementBucketKey,
  type OppRow,
} from "@/lib/sales-kpis";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { ChartFrame } from "@/components/phc/ChartFrame";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { PriorityItem } from "@/components/phc/PriorityItem";
import { StatusPill } from "@/components/phc/StatusPill";
import type { OpportunityRow } from "@/components/phc/OpportunityCard";
import { humanize } from "@/lib/utils";
import {
  resolveCanonicalStage,
  groupByCanonicalStage,
  canonicalStageLabelKey,
  CANONICAL_ACTIVE_STAGES,
} from "@/lib/stage-canonical";
import { isSalesperson, canManageSalesPipeline, isSystemAdmin, isFinanceManager, type AppRole } from "@/lib/roles";

// ── Route guard ───────────────────────────────────────────────────────────────
// This is an aggregate, all-reps management view. Client spec (2026-07-27):
// a salesperson must only ever see their own personal dashboard — this
// guard catches direct URL navigation, since the RLS-level isolation
// (opportunities/RFQs/etc. filtered to owner_id) alone wouldn't stop them
// from *landing* on the management page, just from seeing much data on it.
// Scoped to salesperson specifically (not a broader "not a manager" check)
// so it doesn't disturb the existing "viewer" landing contract in
// src/routes/index.tsx, which deliberately sends viewer here too.
export const Route = createFileRoute("/_authenticated/command-center")({
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
    // Roles are additive (a user may hold several) — only redirect a
    // salesperson who holds no elevated role at all, not e.g. a manager
    // who also happens to carry the salesperson role.
    const hasElevatedRole = canManageSalesPipeline(roles) || isSystemAdmin(roles) || isFinanceManager(roles);
    if (isSalesperson(roles) && !hasElevatedRole) {
      throw redirect({ to: "/my-workspace" });
    }
  },
  head: () => ({
    meta: [
      { title: "Command Center — PHC Sales Agent" },
      { name: "description", content: "Executive operating view: pipeline, follow-ups, RFQ activity, and priority work." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CommandCenter,
});

/** Read chart colours from CSS variables so they stay in sync with the design token system. */
function getCssVar(name: string) {
  if (typeof getComputedStyle === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
const CHART_COLORS = {
  get primary() { return getCssVar("--chart-primary") || "oklch(0.20 0.010 253)"; },
  get primaryDim() { return getCssVar("--chart-primary-dim") || "oklch(0.55 0.010 253)"; },
  get amber() { return getCssVar("--chart-amber") || "oklch(0.62 0.135 65)"; },
  get amberDim() { return getCssVar("--chart-amber-dim") || "oklch(0.75 0.09 65)"; },
  get muted() { return getCssVar("--chart-muted") || "oklch(0.90 0.006 90)"; },
  get grid() { return getCssVar("--chart-grid") || "oklch(0.60 0.010 253 / 0.14)"; },
  get surface() { return getCssVar("--color-surface") || "oklch(1 0 0)"; },
  get border() { return getCssVar("--color-border") || "oklch(0.20 0.010 253 / 0.09)"; },
};

const CHART_H = "h-[240px]";
const CHART_H_SM = "h-[160px]";

function CommandCenter() {
  const { t, lang } = useI18n();
  const nav = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["cc-core"],
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 29);
      const sinceIso = since.toISOString();

      const [opps, followUps, approvals, agentRuns, activities, rfqs] = await Promise.all([
        supabase.from("opportunities").select("id, project_name, stage, sales_stage, tier, pipeline_step, estimated_value_min, estimated_value_max, quotation_value, contract_value, currency, owner_id, last_activity_at, next_action, next_action_due, client, main_contractor, human_win_probability, score, loss_reason, lost_at_stage, lost_to_competitor, expected_contract_date, updated_at, created_at").order("last_activity_at", { ascending: false, nullsFirst: false }).limit(200),
        supabase.from("follow_ups").select("id, opportunity_id, due_date, status, channel, cadence_tier, owner_id").neq("status", "completed").order("due_date", { ascending: true }).limit(100),
        supabase.from("approvals").select("*").eq("status", "pending"),
        supabase.from("ai_agent_runs").select("*").order("started_at", { ascending: false }).limit(6),
        supabase.from("activities").select("id, occurred_at").gte("occurred_at", sinceIso),
        supabase.from("rfqs").select("id, status, estimated_value").limit(200),
      ]);
      return {
        opportunities: (opps.data ?? []) as unknown as OpportunityRow[],
        followUps: followUps.data ?? [],
        approvals: approvals.data ?? [],
        agentRuns: agentRuns.data ?? [],
        activities: activities.data ?? [],
        rfqs: rfqs.data ?? [],
      };
    },
  });

  // Phase 3 (system-redesign request): managers land here and should see the
  // team's aggregated target, not just their own — mirrors my-workspace.tsx's
  // per-user annual-then-monthly-fallback pattern, summed across every rep
  // instead of scoped to one user_id.
  const { data: teamTarget } = useQuery({
    queryKey: ["cc-team-target"],
    staleTime: 60_000,
    queryFn: async () => {
      const annYear = `${new Date().getFullYear()}-01-01`;
      const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
      const [annual, monthly] = await Promise.all([
        supabase.from("sales_targets").select("sales_target").eq("period_type", "annual").eq("period_start", annYear),
        supabase.from("sales_targets").select("sales_target").eq("period_type", "monthly").eq("period_start", monthStart),
      ]);
      const annualSum = (annual.data ?? []).reduce((s, r) => s + Number(r.sales_target ?? 0), 0);
      const monthlySum = (monthly.data ?? []).reduce((s, r) => s + Number(r.sales_target ?? 0), 0);
      return {
        total: annualSum > 0 ? annualSum : monthlySum,
        periodType: annualSum > 0 ? ("annual" as const) : ("monthly" as const),
      };
    },
  });

  const opps = data?.opportunities ?? [];
  const followUps = data?.followUps ?? [];
  const approvals = data?.approvals ?? [];
  const agentRuns = data?.agentRuns ?? [];
  const activities = data?.activities ?? [];
  const rfqs = data?.rfqs ?? [];

  // Canonical stage, not the legacy CRM one. `stage` and `sales_stage` are only
  // synchronised at won/lost, so reading `stage` mid-pipeline filed a
  // verbally-awarded deal under "Quotation" on this page while My Workspace
  // showed it correctly. Live cross-tab, 2026-08-05, made that concrete.
  const canonicalOf = (o: OpportunityRow) => resolveCanonicalStage(o).stage;
  const openOpps = opps.filter((o) => {
    const s = canonicalOf(o);
    return s !== null && (CANONICAL_ACTIVE_STAGES as readonly string[]).includes(s);
  });
  const openPipelineValue = openOpps.reduce(
    (s, o) => s + (o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min ?? 0),
    0,
  );

  const today = new Date().toISOString().slice(0, 10);
  const overdue = followUps.filter((f: any) => f.status === "overdue" || (f.due_date && f.due_date < today));
  const overdueValue = overdue.reduce((s: number, f: any) => {
    const o = opps.find((x) => x.id === f.opportunity_id);
    return s + (o?.quotation_value ?? o?.estimated_value_max ?? o?.estimated_value_min ?? 0);
  }, 0);

  const newlyQualified = opps.filter((o) => canonicalOf(o) === "jih").length;

  // Pipeline by stage — the real PHC flow (rfq_received → … → contract_signed),
  // not the generic CRM buckets this used to show.
  const pipelineByStage = useMemo(() => {
    const grouped = groupByCanonicalStage(opps as unknown as Parameters<typeof groupByCanonicalStage>[0]);
    return grouped.buckets.map((b) => ({
      stage: t(canonicalStageLabelKey(b.stage)),
      count: b.count,
      value: b.value,
    }));
  }, [opps, t]);

  // How much of the chart above rests on rows with no sales_stage, where the
  // position had to be inferred. Surfaced rather than averaged in silently —
  // a number built from guesses is not the same quality as one built from data.
  const inferredCount = useMemo(
    () => groupByCanonicalStage(opps as unknown as Parameters<typeof groupByCanonicalStage>[0]).inferredCount,
    [opps],
  );

  // Activity trend (last 30 days)
  const activityTrend = useMemo(() => {
    const days: { date: string; label: string; count: number }[] = [];
    const map = new Map<string, number>();
    for (const a of activities) {
      const d = (a.occurred_at ?? "").slice(0, 10);
      if (!d) continue;
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      days.push({
        date: iso,
        label: d.toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric" }),
        count: map.get(iso) ?? 0,
      });
    }
    return days;
  }, [activities, lang]);

  // Follow-ups status distribution
  const followUpsStatus = useMemo(() => {
    let overdueC = 0, dueToday = 0, upcoming = 0, scheduled = 0;
    for (const f of followUps as any[]) {
      const dd = f.due_date as string | null;
      if (f.status === "overdue" || (dd && dd < today)) overdueC++;
      else if (dd === today) dueToday++;
      else if (f.status === "due") upcoming++;
      else scheduled++;
    }
    return [
      { key: "overdue", label: lang === "ar" ? "متأخر" : "Overdue", value: overdueC, color: CHART_COLORS.amber },
      { key: "today", label: lang === "ar" ? "اليوم" : "Today", value: dueToday, color: CHART_COLORS.primary },
      { key: "due", label: lang === "ar" ? "مستحق" : "Due", value: upcoming, color: CHART_COLORS.primaryDim },
      { key: "scheduled", label: lang === "ar" ? "مجدول" : "Scheduled", value: scheduled, color: CHART_COLORS.muted },
    ];
  }, [followUps, today, lang]);

  // RFQ status distribution
  const rfqStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rfqs as any[]) {
      const k = (r.status as string) ?? "unknown";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    const palette = [CHART_COLORS.primary, CHART_COLORS.amber, CHART_COLORS.primaryDim, CHART_COLORS.muted];
    return Array.from(map.entries()).map(([k, v], i) => ({
      key: k,
      label: humanize(k),
      value: v,
      color: palette[i % palette.length],
    }));
  }, [rfqs]);
  const rfqTotal = rfqs.length;

  const attention = [
    ...overdue.slice(0, 3).map((f: any) => {
      const o = opps.find((x) => x.id === f.opportunity_id);
      return {
        key: `fu-${f.id}`,
        title: o?.project_name ?? "—",
        subtitle: o?.main_contractor ?? undefined,
        reason: lang === "ar" ? "متابعة متأخرة" : "Follow-up overdue",
        due: f.due_date,
        tier: (o?.tier ?? "B") as "A" | "B" | "C",
        value: o ? formatCurrency(o.quotation_value ?? o.estimated_value_max, lang, o.currency) : undefined,
        oppId: o?.id,
      };
    }),
    ...approvals.slice(0, 2).map((a: any) => {
      const o = opps.find((x) => x.id === a.related_opportunity_id);
      return {
        key: `ap-${a.id}`,
        title: o?.project_name ?? "—",
        subtitle: o?.client ?? undefined,
        reason: lang === "ar" ? "بانتظار الاعتماد" : "Awaiting approval",
        due: undefined as string | undefined,
        tier: (o?.tier ?? "A") as "A" | "B" | "C",
        value: o ? formatCurrency(o.estimated_value_max, lang, o.currency) : undefined,
        oppId: o?.id,
      };
    }),
  ].slice(0, 5);

  // Canonical Phase 5 KPIs. `today` is derived once so every tile shares one
  // period boundary and they cannot disagree about what "this month" means.
  const execKpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return executiveKpis((data?.opportunities ?? []) as unknown as OppRow[], {
      today,
      period: thisMonth(today),
    });
  }, [data]);

  // Phase 5.1 §1/§4/§5. Same rows, same period boundary as execKpis — one
  // `today` for the whole page so two tiles cannot disagree about the month.
  const { forecast, buckets } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = (data?.opportunities ?? []) as unknown as OppRow[];
    const ctx = { today, period: thisMonth(today) };
    return {
      forecast: forecastVsTarget(rows, ctx, teamTarget?.total && teamTarget.total > 0 ? teamTarget.total : null),
      buckets: Object.fromEntries(
        MANAGEMENT_BUCKETS.map((b) => [b.key, bucketKpi(rows, ctx, b.key)]),
      ) as Record<ManagementBucketKey, ReturnType<typeof bucketKpi>>,
    };
  }, [data, teamTarget]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={lang === "ar" ? "نظرة تنفيذية" : "Executive Overview"}
        title={t("nav_command_center")}
        description={
          lang === "ar"
            ? "خط الأنابيب، المتابعات، وأولويات القرار في مكان واحد."
            : "Pipeline, follow-ups, and decision-ready priorities in a single view."
        }
      />

      {/* ── Sales Management (Phase 5) ──────────────────────────────────────
          Canonical KPIs from src/lib/sales-kpis.ts. Every tile carries its own
          formula, source, active filters and record ids, and links to exactly
          the records behind the number — the tooltip cannot drift from the
          value because both are read off the same object. */}
      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-foreground">
            {lang === "ar" ? "مؤشرات المبيعات" : "Sales performance"}
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {lang === "ar" ? "هذا الشهر · اضغط أي رقم لفتح سجلاته" : "This month · click any number to open its records"}
          </span>
        </div>
        {/* Phase 5.1 §5 — the six numbers the month is run on, first and
            together. Forecast is the WEIGHTED pipeline: a forecast that ignores
            probability is the pipeline again under a more confident name. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiTile kpi={execKpis.openPipeline}     label={t("mgmt_open_pipeline" as never)} />
          <KpiTile kpi={forecast.forecast}         label={t("kpi_forecast" as never)} />
          <KpiTile kpi={forecast.target}           label={t("kpi_target_sales" as never)} />
          <KpiTile kpi={forecast.won}              label={lang === "ar" ? "المحقق (Won فقط)" : "Won (official)"} />
          <KpiTile kpi={forecast.achievement}      label={t("kpi_achievement" as never)} />
          <KpiTile kpi={forecast.coverage}         label={t("kpi_coverage" as never)} />
        </div>

        {/* Phase 5.1 §1 — the commercial ladder. Mutually exclusive by
            construction, so these add up; on_hold and lost sit outside it. */}
        <h3 className="mb-2 mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {lang === "ar" ? "خط الأنابيب حسب الموقع التجاري" : "Pipeline by commercial position"}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {MANAGEMENT_BUCKETS.map((b) => (
            <KpiTile key={b.key} kpi={buckets[b.key]} label={t(`mgmt_${b.key}` as never)} />
          ))}
        </div>

        <h3 className="mb-2 mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {lang === "ar" ? "النتائج" : "Outcomes"}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <KpiTile kpi={execKpis.lateStageExposure} label={lang === "ar" ? "تعرض المراحل المتأخرة" : "Late-stage exposure"} />
          <KpiTile kpi={execKpis.winRate}           label={lang === "ar" ? "معدل الفوز" : "Win rate"} />
          <KpiTile kpi={execKpis.lossRate}          label={lang === "ar" ? "معدل الخسارة" : "Loss rate"} />
          <KpiTile kpi={execKpis.lostValue}         label={lang === "ar" ? "قيمة الخسائر" : "Lost value"} />
        </div>
      </section>

      {/* KPI row */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label={lang === "ar" ? "الهدف الإجمالي للفريق" : "Team Target"}
          value={teamTarget && teamTarget.total > 0 ? formatCurrency(teamTarget.total, lang, "SAR") : "—"}
          hint={
            teamTarget?.periodType === "annual"
              ? (lang === "ar" ? "هدف سنوي" : "Annual target")
              : (lang === "ar" ? "هدف شهري" : "Monthly target")
          }
          icon={<Target className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label={t("metric_pipeline_value")}
          value={formatCurrency(openPipelineValue, lang)}
          hint={`${formatNumber(openOpps.length, lang)} ${lang === "ar" ? "فرصة مفتوحة" : "open opportunities"}`}
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label={t("metric_follow_up_value")}
          value={formatCurrency(overdueValue, lang)}
          hint={`${formatNumber(overdue.length, lang)} ${lang === "ar" ? "متأخرة" : "overdue"}`}
          trend={overdue.length > 0 ? "down" : "flat"}
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label={t("metric_awaiting_approval")}
          value={formatNumber(approvals.length, lang)}
          hint={approvals.length > 0 ? (lang === "ar" ? "بحاجة قرار" : "Awaiting decision") : (lang === "ar" ? "لا يوجد" : "All clear")}
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label={t("metric_newly_qualified")}
          value={formatNumber(newlyQualified, lang)}
          hint={lang === "ar" ? "قيد التأهيل" : "In qualification"}
          icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />}
        />
      </section>

      {/* Charts row 1 */}
      <section className="mt-6 grid gap-3 lg:grid-cols-2">
        <ChartFrame
          title={lang === "ar" ? "قيمة خط الأنابيب حسب المرحلة" : "Pipeline value by stage"}
          subtitle={
            <>
              {lang === "ar" ? "الفرص المفتوحة فقط" : "Open opportunities only"}
              {/* The disclosure this number was computed for. `inferredCount`
                  had been calculated on every render and never rendered, so a
                  bar built partly from guessed stage positions looked exactly
                  as solid as one built from recorded ones. */}
              {inferredCount > 0 && (
                <span className="ms-2 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-[10px] font-medium text-amber-light">
                  {lang === "ar"
                    ? `${formatNumber(inferredCount, lang)} استُنتجت مرحلتها`
                    : `${formatNumber(inferredCount, lang)} inferred`}
                </span>
              )}
            </>
          }
        >
          {openOpps.length === 0 ? (
            <EmptyChart label={lang === "ar" ? "لا توجد فرص مفتوحة" : "No open opportunities yet"} />
          ) : (
            <div className={CHART_H}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pipelineByStage} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="stage" tick={{ fill: CHART_COLORS.primaryDim, fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fill: CHART_COLORS.primaryDim, fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(v))}
                  />
                  <Tooltip
                    contentStyle={{ background: CHART_COLORS.surface, border: `1px solid ${CHART_COLORS.border}`, borderRadius: 8, fontSize: 12, color: CHART_COLORS.primary }}
                    // v3 types the value as ValueType (number | string | array),
                    // so the old `v: number` annotation no longer matches. The bars
                    // are numeric; coerce rather than assert.
                    formatter={(v, name) => {
                      const n = typeof v === "number" ? v : Number(v);
                      return name === "value" ? formatCurrency(n, lang) : formatNumber(n, lang);
                    }}
                    cursor={{ fill: CHART_COLORS.muted }}
                  />
                  <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartFrame>

        <ChartFrame
          title={lang === "ar" ? "نشاط الفريق (30 يوم)" : "Team activity (30 days)"}
          subtitle={lang === "ar" ? "الأنشطة المسجلة يومياً" : "Logged activities per day"}
        >
          {activities.length === 0 ? (
            <EmptyChart label={lang === "ar" ? "لا يوجد نشاط بعد" : "No activity logged yet"} />
          ) : (
            <div className={CHART_H}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activityTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: CHART_COLORS.primaryDim, fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
                  <YAxis tick={{ fill: CHART_COLORS.primaryDim, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: CHART_COLORS.surface, border: `1px solid ${CHART_COLORS.border}`, borderRadius: 8, fontSize: 12, color: CHART_COLORS.primary }}
                    cursor={{ stroke: CHART_COLORS.grid }}
                  />
                  <Line type="monotone" dataKey="count" stroke={CHART_COLORS.primary} strokeWidth={1.75} dot={false} activeDot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartFrame>
      </section>

      {/* Charts row 2 */}
      <section className="mt-3 grid gap-3 lg:grid-cols-2">
        <ChartFrame
          title={lang === "ar" ? "حالة المتابعات" : "Follow-ups by status"}
          subtitle={lang === "ar" ? "توزيع المتابعات النشطة" : "Distribution of active follow-ups"}
        >
          {followUps.length === 0 ? (
            <EmptyChart label={lang === "ar" ? "لا توجد متابعات نشطة" : "No active follow-ups"} />
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-6">
              <div className="space-y-2.5">
                {followUpsStatus.map((s) => {
                  const total = followUpsStatus.reduce((a, b) => a + b.value, 0) || 1;
                  const pct = Math.round((s.value / total) * 100);
                  return (
                    <div key={s.key}>
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                          {s.label}
                        </span>
                        <span className="num text-foreground" data-tabular="true">{formatNumber(s.value, lang)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={CHART_H_SM}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={followUpsStatus} dataKey="value" nameKey="label" innerRadius={44} outerRadius={64} paddingAngle={2} stroke="none">
                      {followUpsStatus.map((s) => (
                        <Cell key={s.key} fill={s.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </ChartFrame>

        <ChartFrame
          title={lang === "ar" ? "توزيع طلبات عروض الأسعار" : "RFQ status distribution"}
          subtitle={lang === "ar" ? `${rfqTotal} طلب` : `${rfqTotal} RFQs total`}
        >
          {rfqTotal === 0 ? (
            <EmptyChart label={lang === "ar" ? "لا توجد طلبات بعد" : "No RFQs yet"} />
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-6">
              <div className="space-y-2.5">
                {rfqStatus.map((s) => {
                  const pct = Math.round((s.value / rfqTotal) * 100);
                  return (
                    <div key={s.key}>
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                          {s.label}
                        </span>
                        <span className="num text-foreground" data-tabular="true">{formatNumber(s.value, lang)} · {pct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={CHART_H_SM}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={rfqStatus} dataKey="value" nameKey="label" innerRadius={44} outerRadius={64} paddingAngle={2} stroke="none">
                      {rfqStatus.map((s) => (
                        <Cell key={s.key} fill={s.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </ChartFrame>
      </section>

      {/* Needs Attention + Agent Activity */}
      <section className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartFrame
          title={t("needs_attention")}
          subtitle={lang === "ar" ? "أولوية للقرار الآن" : "Prioritized for decision now"}
          action={
            <button
              onClick={() => nav({ to: "/action-center" })}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/70 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {lang === "ar" ? "الكل" : "View all"} <ArrowRight className="h-3 w-3" />
            </button>
          }
          padded={false}
          bodyClassName="p-2"
        >
          {isLoading ? (
            <SkeletonTable rows={3} />
          ) : attention.length === 0 ? (
            <div className="px-3 py-6"><EmptyState message={t("empty_needs_attention")} /></div>
          ) : (
            attention.map((a) => (
              <PriorityItem
                key={a.key}
                title={a.title}
                subtitle={a.subtitle}
                reason={a.reason}
                tier={a.tier}
                due={a.due ?? undefined}
                value={a.value}
                actionLabel={t("action_review")}
                onAction={() => a.oppId && nav({ to: "/opportunities/$id", params: { id: a.oppId } })}
              />
            ))
          )}
        </ChartFrame>

        <ChartFrame
          title={t("agent_activity")}
          action={<StatusPill tone="positive"><Sparkles className="h-3 w-3" /> {t("agent_status_running")}</StatusPill>}
          padded={false}
        >
          {agentRuns.length === 0 ? (
            <div className="px-5 py-6"><EmptyState message={t("empty_agent_runs")} /></div>
          ) : (
            <ol>
              {agentRuns.map((r: any) => (
                <li key={r.id} className="flex items-start gap-3 border-t border-border/60 px-5 py-3 first:border-t-0">
                  <div className="mt-0.5">
                    {r.status === "failed" || r.status === "error" ? (
                      <Activity className="h-3.5 w-3.5 text-amber" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-[12px] text-foreground">{r.agent_key}</div>
                      <span className="num shrink-0 text-[10px] text-muted-foreground" data-tabular="true">
                        {new Date(r.started_at).toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {r.summary ? (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{r.summary}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </ChartFrame>
      </section>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className={`flex ${CHART_H} flex-col items-center justify-center gap-2 text-center`}>
      <div className="grid h-9 w-9 place-items-center rounded-full border border-border/60 bg-surface-2/50 text-muted-foreground">
        <Sparkles className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="text-[12px] text-muted-foreground">{label}</div>
    </div>
  );
}
