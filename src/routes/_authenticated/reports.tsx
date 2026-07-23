import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp, Wallet, AlertCircle, XCircle, Bot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { ChartFrame } from "@/components/phc/ChartFrame";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonChart } from "@/components/phc/Skeleton";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { computeQuotationWinRatePct } from "@/lib/dashboard-helpers";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ReportsPage,
});

const STAGE_ORDER = [
  "discovery",
  "qualification",
  "preparation",
  "quotation",
  "follow_up",
  "won",
  "lost",
  "archived",
] as const;

const QUOTE_ORDER = [
  "draft",
  "under_internal_review",
  "approved_for_submission",
  "submitted",
  "follow_up",
  "negotiation",
  "revised",
  "won",
  "lost",
  "expired",
] as const;

const CHART = {
  primary: "var(--chart-primary)",
  amber: "var(--color-amber)",
  emerald: "var(--color-won)",
  red: "var(--color-destructive)",
  muted: "var(--color-muted-foreground)",
  grid: "var(--chart-grid)",
};

function humanize(s: string) {
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ReportsPage() {
  const { t, lang } = useI18n();

  const { data: opps = [], isLoading: l1 } = useQuery({
    queryKey: ["report-opps"],
    queryFn: async () =>
      (
        await supabase
          .from("opportunities")
          .select("id, stage, quotation_value, estimated_value_max")
      ).data ?? [],
  });

  const { data: quotes = [], isLoading: l2 } = useQuery({
    queryKey: ["report-quotes"],
    queryFn: async () =>
      (await supabase.from("quotations").select("id, status, value, win_loss_reason")).data ?? [],
  });

  // Latest AI weekly report — stored as an audit log entry (action = 'ai.weekly_report')
  const { data: weeklyReport } = useQuery({
    queryKey: ["ai-weekly-report-latest"],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("after_value, timestamp")
        .eq("action", "ai.weekly_report")
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
    staleTime: 60_000,
  });

  const stageRows = useMemo(
    () =>
      STAGE_ORDER.map((s) => {
        const list = opps.filter((o: any) => o.stage === s);
        return {
          key: s,
          label: humanize(s),
          count: list.length,
          value: list.reduce(
            (sum: number, o: any) => sum + (o.quotation_value ?? o.estimated_value_max ?? 0),
            0,
          ),
        };
      }).filter((r) => r.count > 0),
    [opps],
  );

  const quoteRows = useMemo(
    () =>
      QUOTE_ORDER.map((s) => {
        const list = quotes.filter((q: any) => q.status === s);
        return {
          key: s,
          label: t(`quote_status_${s}` as never),
          count: list.length,
          value: list.reduce((sum: number, q: any) => sum + (q.value ?? 0), 0),
        };
      }).filter((r) => r.count > 0),
    [quotes, t],
  );

  const wonQuotes = quotes.filter((q: any) => q.status === "won");
  const lostQuotes = quotes.filter((q: any) => q.status === "lost");
  const closed = wonQuotes.length + lostQuotes.length;
  const winRate = computeQuotationWinRatePct(quotes, null);
  const wonValue = wonQuotes.reduce((s: number, q: any) => s + (q.value ?? 0), 0);
  const openQuotesValue = quotes
    .filter((q: any) => !["won", "lost", "expired"].includes(q.status))
    .reduce((s: number, q: any) => s + (q.value ?? 0), 0);
  const lostValue = lostQuotes.reduce((s: number, q: any) => s + (q.value ?? 0), 0);
  const lostReasons = lostQuotes
    .map((q: any) => q.win_loss_reason)
    .filter(Boolean) as string[];

  const isLoading = l1 || l2;
  const hasData = stageRows.length > 0 || quoteRows.length > 0;

  const tooltipStyle = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    fontSize: 11,
    color: "var(--color-foreground)",
  } as const;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={lang === "ar" ? "الأداء" : "Performance"}
        title={t("nav_reports")}
        description={lang === "ar" ? "نظرة تنفيذية على خط الأنابيب والعروض والفوز/الخسارة." : "Executive view of pipeline, quotations, and win/loss."}
      />

      {isLoading ? (
        <SkeletonChart kpis={3} charts={2} />
      ) : !hasData ? (
        <EmptyState message={t("empty_report")} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={t("report_win_rate")}
              value={winRate === null ? "—" : `${formatNumber(winRate, lang)}%`}
              hint={closed > 0 ? `${formatNumber(wonQuotes.length, lang)} / ${formatNumber(closed, lang)}` : undefined}
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              trend={winRate !== null ? (winRate >= 50 ? "up" : winRate >= 25 ? "flat" : "down") : undefined}
            />
            <KpiCard label={t("report_won_value")} value={formatCurrency(wonValue, lang)} icon={<Wallet className="h-3.5 w-3.5" />} />
            <KpiCard
              label={t("report_open_quotes_value")}
              value={formatCurrency(openQuotesValue, lang)}
              icon={<AlertCircle className="h-3.5 w-3.5" />}
            />
            <KpiCard label={t("report_lost_value")} value={formatCurrency(lostValue, lang)} icon={<XCircle className="h-3.5 w-3.5" />} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {stageRows.length > 0 ? (
              <ChartFrame
                title={t("report_pipeline_by_stage")}
                subtitle={lang === "ar" ? "قيمة الفرص لكل مرحلة" : "Opportunity value by stage"}
              >
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stageRows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: CHART.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill: CHART.muted, fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        cursor={{ fill: "var(--color-muted)" }}
                        formatter={(v: any, _n, p: any) => [formatCurrency(Number(v), lang), p?.payload?.label]}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {stageRows.map((r) => (
                          <Cell
                            key={r.key}
                            fill={r.key === "won" ? CHART.emerald : r.key === "lost" || r.key === "archived" ? CHART.red : CHART.amber}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartFrame>
            ) : null}

            {quoteRows.length > 0 ? (
              <ChartFrame
                title={t("report_quotation_funnel")}
                subtitle={lang === "ar" ? "عدد وقيمة العروض" : "Quotation count and value by status"}
              >
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={quoteRows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: CHART.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill: CHART.muted, fontSize: 10 }} tickLine={false} axisLine={false} width={36} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        cursor={{ fill: "var(--color-muted)" }}
                        formatter={(v: any, _n, p: any) => [`${formatNumber(Number(v), lang)} · ${formatCurrency(p?.payload?.value ?? 0, lang)}`, p?.payload?.label]}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {quoteRows.map((r) => (
                          <Cell key={r.key} fill={r.key === "won" ? CHART.emerald : r.key === "lost" || r.key === "expired" ? CHART.red : CHART.amber} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartFrame>
            ) : null}
          </div>

          {lostReasons.length > 0 ? (
            <ChartFrame title={t("report_lost_reasons")} subtitle={lang === "ar" ? "أسباب فقدان العروض" : "Why quotations were lost"}>
              <ul className="space-y-2">
                {lostReasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-destructive/70" />
                    <span className="text-foreground/90">{r}</span>
                  </li>
                ))}
              </ul>
            </ChartFrame>
          ) : null}

          {weeklyReport ? (
            <ChartFrame
              title={lang === "ar" ? "التقرير الأسبوعي للذكاء الاصطناعي" : "AI Weekly Report"}
              subtitle={weeklyReport.timestamp ? new Date(weeklyReport.timestamp).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : undefined}
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Bot className="h-3.5 w-3.5 shrink-0" />
                <span>{lang === "ar" ? "ملخص مُولَّد تلقائياً — يُحدَّث كل أحد الساعة 06:00 بتوقيت الخليج" : "Auto-generated summary — updated every Sunday 06:00 GST"}</span>
              </div>
              {weeklyReport.after_value && typeof weeklyReport.after_value === "object" ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Object.entries(weeklyReport.after_value as Record<string, unknown>).map(([key, val]) => (
                    <div key={key} className="rounded-lg border border-border bg-surface/60 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {key.replaceAll("_", " ")}
                      </div>
                      <div className="mt-1 text-lg font-semibold text-foreground num">{String(val ?? "—")}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </ChartFrame>
          ) : null}
        </div>
      )}
    </div>
  );
}
