// =============================================================================
// A KPI that explains itself (Phase 5 §42).
//
// The value, the formula, the filters and the drilldown all come from the SAME
// `Kpi` object. That is the point: a dashboard where the tooltip is written by
// hand drifts from the number within a release or two, and then it is worse
// than no tooltip because it is confidently wrong.
//
// An unknown value never renders as 0. "No target set" and "target met at 0%"
// are different facts and must not look the same — Phase 5.1 §14 splits the
// unknown side further into no data / not calculated / setup required / not
// applicable, because "we cannot compute this" and "nobody has set this up"
// need different actions from the reader.
// =============================================================================

import { Link } from "@tanstack/react-router";
import { Info, AlertTriangle, ArrowUpRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";
import { metricStateOf, type Kpi, type MetricState } from "@/lib/sales-kpis";

// Phase 5.1 §14. A dash says "no number" and stops there; these say WHY there
// is no number, which is the difference between a dashboard a manager distrusts
// and one they can act on. A real zero is still rendered as a zero — knowing a
// figure is zero is knowledge, and hiding it here would be the opposite error.
const EMPTY_LABEL: Record<Exclude<MetricState, "ok">, { en: string; ar: string }> = {
  no_data: { en: "No data yet", ar: "لا بيانات بعد" },
  not_calculated: { en: "Not calculated", ar: "غير محتسَب" },
  not_configured: { en: "Setup required", ar: "يحتاج إعدادًا" },
  not_applicable: { en: "Not applicable", ar: "لا ينطبق" },
};

/** Exported for test: this is the guarantee, so it is asserted directly
 *  rather than by grepping the component for a string literal. */
export function renderValue(k: Kpi, lang: "en" | "ar"): string {
  const state = metricStateOf(k);
  if (state !== "ok" || k.value === null) return EMPTY_LABEL[state === "ok" ? "no_data" : state][lang];
  if (k.kind === "currency") return formatCurrency(k.value, lang);
  if (k.kind === "percent") return `${formatNumber(k.value, lang)}%`;
  return formatNumber(k.value, lang);
}

export function KpiTile({ kpi, label, hint }: { kpi: Kpi; label: string; hint?: string }) {
  const { t, lang, dir } = useI18n();
  const clickable = kpi.drilldown !== null && kpi.recordCount > 0;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                // The explanation is keyboard reachable, not hover-only.
                aria-label={lang === "ar" ? `كيف حُسب ${label}` : `How ${label} is calculated`}
                className="mt-0.5 shrink-0 text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                onClick={(e) => e.preventDefault()}
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side={dir === "rtl" ? "left" : "right"} className="max-w-[19rem] space-y-1.5 text-[11px]">
              <p className="font-medium text-foreground">{kpi.formula}</p>
              <p className="text-muted-foreground">
                <span className="text-amber-light">{lang === "ar" ? "المصدر" : "Source"}:</span> {kpi.source}
              </p>
              {kpi.dateField ? (
                <p className="text-muted-foreground">
                  <span className="text-amber-light">{lang === "ar" ? "التاريخ" : "Date"}:</span> {kpi.dateField}
                </p>
              ) : null}
              {kpi.filters.length > 0 ? (
                <ul className="list-disc space-y-0.5 ps-4 text-muted-foreground">
                  {kpi.filters.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : null}
              <p className="text-muted-foreground/70">
                {lang === "ar" ? `${kpi.recordCount} سجل` : `${kpi.recordCount} record${kpi.recordCount === 1 ? "" : "s"}`}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div
        className={
          metricStateOf(kpi) === "ok"
            ? "num mt-1.5 text-[22px] font-semibold leading-none text-foreground"
            : "mt-1.5 text-[15px] font-medium leading-tight text-muted-foreground"
        }
        data-tabular={metricStateOf(kpi) === "ok" ? "true" : undefined}
      >
        {renderValue(kpi, lang)}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>
          {lang === "ar" ? `${kpi.recordCount} سجل` : `${kpi.recordCount} record${kpi.recordCount === 1 ? "" : "s"}`}
        </span>
        {clickable ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-0.5 text-amber-light">
              {lang === "ar" ? "افتح" : "Open"}
              <ArrowUpRight className="h-2.5 w-2.5 rtl:rotate-[-90deg]" />
            </span>
          </>
        ) : null}
      </div>

      {hint ? <div className="mt-1 text-[10px] text-muted-foreground/70">{hint}</div> : null}

      {/* A caveat is part of the number's meaning, so it is always visible —
          not tucked into the tooltip where it can be missed. */}
      {kpi.caveat ? (
        <div className="mt-1.5 flex items-start gap-1 text-[10px] text-amber-light">
          <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          <span>{kpi.caveat}</span>
        </div>
      ) : null}

      {/* An empty state that only describes itself is a dead end, and four of
          them side by side read as a broken page. This is the way out, scoped
          to the exact records that are missing the input. */}
      {kpi.fix ? (
        <div className="mt-1.5 text-[10px] font-medium text-amber-light underline-offset-2 hover:underline">
          {t(kpi.fix.labelKey as never)} →
        </div>
      ) : null}
    </>
  );

  const shell =
    "rounded-xl border border-border/70 bg-surface/60 px-4 py-3 transition-colors";

  // One link per tile — a fix link nested inside a drilldown link is invalid
  // markup and the inner one never fires. When a metric cannot be computed the
  // fix takes the tile, because drilling into records that cannot answer the
  // question is not the action the reader needs.
  const target = kpi.fix
    ? { to: kpi.fix.to, search: kpi.fix.search }
    : clickable
      ? { to: kpi.drilldown!.to, search: kpi.drilldown!.search }
      : null;

  if (!target) return <div className={shell}>{body}</div>;

  return (
    <Link
      to={target.to as never}
      search={target.search as never}
      className={`${shell} block hover:border-border-strong hover:bg-surface-2/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
    >
      {body}
    </Link>
  );
}
