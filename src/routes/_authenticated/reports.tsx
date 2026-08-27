import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { TrendingUp, Wallet, AlertCircle, XCircle, Bot, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { ChartFrame } from "@/components/phc/ChartFrame";
import { groupByCanonicalStage, canonicalStageLabelKey } from "@/lib/stage-canonical";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonChart } from "@/components/phc/Skeleton";
import { useI18n, formatCurrency, formatNumber, localeFor } from "@/lib/i18n";
import { computeQuotationWinRatePct } from "@/lib/dashboard-helpers";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canManageSalesPipeline, canReviewAiOutput } from "@/lib/roles";
import { getLatestAgentOutput, reviewAgentOutput, type AiAgentOutputRow } from "@/lib/ai-review-actions";
import { AGGREGATE_ENTITY_ID, runAiAgent } from "@/lib/ai-orchestrator-actions";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ReportsPage,
});

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
          .select("id, stage, sales_stage, quotation_value, estimated_value_max")
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

  // Canonical stage — the real PHC pipeline, not the legacy CRM buckets.
  // Reading `stage` here put a verbally-awarded deal under "Quotation", because
  // the two columns are only synchronised at won/lost.
  const stageRows = useMemo(
    () =>
      groupByCanonicalStage(opps as unknown as Parameters<typeof groupByCanonicalStage>[0])
        .buckets.map((b) => ({
          key: b.stage,
          label: t(canonicalStageLabelKey(b.stage)),
          count: b.count,
          value: b.value,
        }))
        .filter((r) => r.count > 0),
    [opps, t],
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
                            // The chart now shows active canonical stages only,
                            // so won/lost never appear here. Colour by proximity
                            // to award instead: the near-award stages read green.
                            fill={
                              r.key === "verbally_awarded" ||
                              r.key === "contract_received" ||
                              r.key === "contract_signed"
                                ? CHART.emerald
                                : CHART.amber
                            }
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

          <SalesReportInsightsPanel lang={lang} />

          {weeklyReport ? (
            <ChartFrame
              title={lang === "ar" ? "التقرير الأسبوعي للذكاء الاصطناعي" : "AI Weekly Report"}
              subtitle={weeklyReport.timestamp ? new Date(weeklyReport.timestamp).toLocaleDateString(localeFor(lang), { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : undefined}
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Bot className="h-3.5 w-3.5 shrink-0" />
                <span>{lang === "ar" ? "ملخص مُولَّد تلقائياً — يُحدَّث كل أحد الساعة 06:00 بتوقيت الخليج" : "Auto-generated summary — updated every Sunday 06:00 GST"}</span>
              </div>
              {weeklyReport.after_value && typeof weeklyReport.after_value === "object" ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Object.entries(weeklyReport.after_value as Record<string, unknown>).map(([key, val]) => (
                    <div key={key} className="rounded-lg border border-border bg-surface/60 px-3 py-2">
                      <div className="text-2xs uppercase tracking-wider text-muted-foreground">
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

// sales_report_insights AI agent (2026-08-04) — narrative summary of this
// page's own aggregates (win rate, pipeline by stage, quotation funnel,
// lost reasons). No single record — the nil UUID below is a deliberate
// "no specific entity" sentinel (entity_id is a uuid-typed column; see the
// comment on the project_radar call in agent-activity.tsx for the bug this
// pattern replaces — a non-UUID placeholder string silently failed schema
// validation on every call).
const REPORTS_ENTITY_ID = AGGREGATE_ENTITY_ID;

function SalesReportInsightsPanel({ lang }: { lang: "en" | "ar" }) {
  const { roles } = useAuth();
  const canRun = canManageSalesPipeline(roles);
  const canReview = canReviewAiOutput(roles);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const outputQ = useQuery({
    queryKey: ["ai-output", "reports", REPORTS_ENTITY_ID, "sales_report_insights"],
    queryFn: () => getLatestAgentOutput("reports", REPORTS_ENTITY_ID, "sales_report_insights"),
    enabled: canRun,
  });

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const result = await runAiAgent({ agent: "sales_report_insights", entityType: "reports", entityId: REPORTS_ENTITY_ID });
      if (!result.ok) throw new Error(result.message);
      outputQ.refetch();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleDecide(output: AiAgentOutputRow, decision: "accepted" | "rejected") {
    setReviewingId(output.id);
    try {
      await reviewAgentOutput({ outputId: output.id, decision });
      outputQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setReviewingId(null);
    }
  }

  if (!canRun) return null;

  const output = outputQ.data;
  const display = output?.structured_output as any;

  return (
    <ChartFrame
      title={lang === "ar" ? "رؤى الذكاء الاصطناعي" : "AI Insights"}
      subtitle={lang === "ar" ? "تحليل عند الطلب لأرقام هذه الصفحة" : "On-demand analysis of this page's own numbers"}
    >
      <div className="space-y-3">
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-2.5 py-1 text-xs font-medium text-amber-light transition-colors hover:bg-amber/20 disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" />
          {running ? (lang === "ar" ? "جارٍ التحليل…" : "Analyzing…") : (lang === "ar" ? "تحليل الآن" : "Analyze now")}
        </button>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
        )}

        {display && (
          <div className="space-y-3 text-sm">
            {display.headline && <div className="font-medium text-foreground">{display.headline}</div>}
            {display.key_insights?.length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "ملاحظات رئيسية" : "Key Insights"}</div>
                <ul className="space-y-1">
                  {display.key_insights.map((s: string, i: number) => (
                    <li key={i} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted-foreground">{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {display.risks?.length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "مخاطر" : "Risks"}</div>
                <ul className="space-y-1">
                  {display.risks.map((s: string, i: number) => (
                    <li key={i} className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive/90">{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {display.recommended_actions?.length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "إجراءات موصى بها" : "Recommended Actions"}</div>
                <ul className="space-y-1">
                  {display.recommended_actions.map((s: string, i: number) => (
                    <li key={i} className="rounded-md border border-won/30 bg-won/10 px-2.5 py-1.5 text-xs text-won">{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {display.disclaimer && <div className="text-xs italic text-muted-foreground">{display.disclaimer}</div>}

            {output && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-xs">
                <span className="text-muted-foreground">
                  {output.status === "pending_review"
                    ? (lang === "ar" ? "بانتظار المراجعة" : "Pending review")
                    : output.status === "accepted"
                    ? (lang === "ar" ? "تم القبول" : "Accepted")
                    : (lang === "ar" ? "تم الرفض" : "Rejected")}
                </span>
                {output.status === "pending_review" && canReview ? (
                  <>
                    <button
                      type="button"
                      disabled={reviewingId === output.id}
                      onClick={() => handleDecide(output, "accepted")}
                      className="rounded-md border border-won/40 bg-won/10 px-2.5 py-1 text-xs font-medium text-won transition-colors hover:bg-won/[0.16] disabled:opacity-50"
                    >
                      {lang === "ar" ? "قبول" : "Accept"}
                    </button>
                    <button
                      type="button"
                      disabled={reviewingId === output.id}
                      onClick={() => handleDecide(output, "rejected")}
                      className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive/90 transition-colors hover:bg-destructive/[0.16] disabled:opacity-50"
                    >
                      {lang === "ar" ? "رفض" : "Reject"}
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
