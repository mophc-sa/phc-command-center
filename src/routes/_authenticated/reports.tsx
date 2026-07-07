import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { MetricTile } from "@/components/phc/MetricTile";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";

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

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-amber" style={{ width: `${pct}%` }} />
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  lang,
  countLabel,
  valueLabel,
}: {
  title: string;
  rows: { key: string; label: string; count: number; value: number }[];
  lang: "en" | "ar";
  countLabel: string;
  valueLabel: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
        {title}
      </h3>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="num text-foreground" data-tabular="true">
                {countLabel}: {formatNumber(r.count, lang)} · {valueLabel}:{" "}
                {formatCurrency(r.value, lang)}
              </span>
            </div>
            <Bar pct={Math.round((r.value / max) * 100)} />
          </div>
        ))}
      </div>
    </div>
  );
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

  const stageRows = useMemo(
    () =>
      STAGE_ORDER.map((s) => {
        const list = opps.filter((o: any) => o.stage === s);
        return {
          key: s,
          label: s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
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
  const winRate = closed > 0 ? Math.round((wonQuotes.length / closed) * 100) : null;
  const wonValue = wonQuotes.reduce((s: number, q: any) => s + (q.value ?? 0), 0);
  const openQuotesValue = quotes
    .filter((q: any) => !["won", "lost", "expired"].includes(q.status))
    .reduce((s: number, q: any) => s + (q.value ?? 0), 0);
  const lostReasons = lostQuotes
    .map((q: any) => q.win_loss_reason)
    .filter(Boolean) as string[];

  const isLoading = l1 || l2;
  const hasData = stageRows.length > 0 || quoteRows.length > 0;

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader title={t("nav_reports")} />
      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : !hasData ? (
        <EmptyState message={t("empty_report")} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label={t("report_win_rate")}
              value={winRate === null ? "—" : `${formatNumber(winRate, lang)}%`}
              hint={
                closed > 0
                  ? `${formatNumber(wonQuotes.length, lang)} / ${formatNumber(closed, lang)}`
                  : undefined
              }
            />
            <MetricTile label={t("report_won_value")} value={formatCurrency(wonValue, lang)} />
            <MetricTile
              label={t("report_open_quotes_value")}
              value={formatCurrency(openQuotesValue, lang)}
              tone="attention"
            />
            <MetricTile
              label={t("report_lost_value")}
              value={formatCurrency(
                lostQuotes.reduce((s: number, q: any) => s + (q.value ?? 0), 0),
                lang,
              )}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {stageRows.length > 0 ? (
              <BreakdownTable
                title={t("report_pipeline_by_stage")}
                rows={stageRows}
                lang={lang}
                countLabel={t("report_count")}
                valueLabel={t("report_value")}
              />
            ) : null}
            {quoteRows.length > 0 ? (
              <BreakdownTable
                title={t("report_quotation_funnel")}
                rows={quoteRows}
                lang={lang}
                countLabel={t("report_count")}
                valueLabel={t("report_value")}
              />
            ) : null}
          </div>

          {lostReasons.length > 0 ? (
            <div className="rounded-lg border border-border bg-surface p-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("report_lost_reasons")}
              </h3>
              <ul className="space-y-2">
                {lostReasons.map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    · {r}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
