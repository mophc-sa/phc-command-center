import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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

export const Route = createFileRoute("/_authenticated/command-center")({
  head: () => ({
    meta: [
      { title: "Command Center — PHC Sales Agent" },
      { name: "description", content: "Executive operating view: pipeline, follow-ups, RFQ activity, and priority work." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CommandCenter,
});

const CLOSED = ["won", "lost", "archived"];
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
        supabase.from("opportunities").select("id, project_name, stage, tier, pipeline_step, estimated_value_min, estimated_value_max, quotation_value, currency, owner_id, last_activity_at, next_action, next_action_due, client, main_contractor").order("last_activity_at", { ascending: false, nullsFirst: false }).limit(200),
        supabase.from("follow_ups").select("id, opportunity_id, due_date, status, channel, cadence_tier, owner_id").neq("status", "completed").order("due_date", { ascending: true }).limit(100),
        supabase.from("approvals").select("*").eq("status", "pending"),
        supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(6),
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

  const opps = data?.opportunities ?? [];
  const followUps = data?.followUps ?? [];
  const approvals = data?.approvals ?? [];
  const agentRuns = data?.agentRuns ?? [];
  const activities = data?.activities ?? [];
  const rfqs = data?.rfqs ?? [];

  const openOpps = opps.filter((o) => !CLOSED.includes(o.stage));
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

  const newlyQualified = opps.filter((o) => o.stage === "qualification").length;

  // Pipeline by stage
  const pipelineByStage = useMemo(() => {
    const order = ["discovery", "qualification", "preparation", "quotation", "follow_up"];
    const map = new Map<string, { count: number; value: number }>();
    order.forEach((s) => map.set(s, { count: 0, value: 0 }));
    for (const o of openOpps) {
      const cur = map.get(o.stage) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min ?? 0;
      map.set(o.stage, cur);
    }
    return Array.from(map.entries()).map(([stage, v]) => ({
      stage: humanize(stage),
      count: v.count,
      value: v.value,
    }));
  }, [openOpps]);

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

      {/* KPI row */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
          subtitle={lang === "ar" ? "الفرص المفتوحة فقط" : "Open opportunities only"}
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
                    formatter={(v: number, name) => name === "value" ? formatCurrency(v, lang) : formatNumber(v, lang)}
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
                    {r.status === "error" ? (
                      <Activity className="h-3.5 w-3.5 text-amber" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-[12px] text-foreground">{r.loop_name ?? r.agent_name}</div>
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
