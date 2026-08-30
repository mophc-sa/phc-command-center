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

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Info, AlertTriangle, ArrowUpRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";
import { formatMessage } from "@/lib/messages";
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

/**
 * The four accents a tile may wear, and what each one means.
 *
 * Colour is applied to the ICON and the LEFT EDGE only — never to the page, the
 * card surface or the label. That is the whole constraint: the reference
 * dashboards this borrows from are colourful because their *cards* are, not
 * because their canvas is, and this app's warm-neutral ground is its identity.
 *
 * The mapping is semantic, not decorative, and it reuses the vocabulary the app
 * already has: money is amber, an outcome already banked is green, a count or
 * a rate is blue, and anything measuring exposure or loss is red. A reader who
 * learns it on one row reads it on every other.
 */
export type KpiAccent = "money" | "won" | "count" | "risk";

const ACCENT: Record<KpiAccent, { chip: string; bar: string }> = {
  money: { chip: "bg-amber/[0.12] text-amber-light", bar: "bg-amber/70" },
  won: { chip: "bg-won/[0.10] text-won", bar: "bg-won/70" },
  count: { chip: "bg-info/[0.10] text-info", bar: "bg-info/70" },
  risk: { chip: "bg-destructive/[0.09] text-destructive", bar: "bg-destructive/70" },
};

export function KpiTile({
  kpi,
  label,
  hint,
  accent,
  icon,
  delta,
  onOpen,
}: {
  kpi: Kpi;
  label: string;
  hint?: string;
  /** Semantic colour for the icon and edge. See KpiAccent. */
  accent?: KpiAccent;
  /** A Lucide glyph, sized by this component. Omit and no chip is drawn. */
  icon?: ReactNode;
  /** Rendered under the value. Pass a <DeltaPill/>; it draws nothing when
   *  there is no honest comparison to make. */
  delta?: ReactNode;
  /**
   * Opens an in-page drill-down instead of navigating.
   *
   * It lives here rather than at the call site because a caller that wraps
   * <KpiTile> in its own <button> produces <button><a></a></button> — invalid
   * markup where the anchor swallows the click. That is exactly what shipped:
   * on 2026-08-26 the SAR 63,407,478 tile did nothing when clicked, because
   * the tile had already rendered a Link for its "add opportunity value" fix.
   * One interactive element per tile, chosen here.
   */
  onOpen?: () => void;
}) {
  const { t, lang, dir } = useI18n();
  const clickable = kpi.drilldown !== null && kpi.recordCount > 0;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {icon && accent ? (
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${ACCENT[accent].chip}`}
              aria-hidden="true"
            >
              {icon}
            </span>
          ) : null}
          <span className="truncate text-xs font-medium tracking-[0.02em] text-muted-foreground">{label}</span>
        </span>
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                // The explanation is keyboard reachable, not hover-only.
                aria-label={lang === "ar" ? `كيف حُسب ${label}` : `How ${label} is calculated`}
                // Sits above the tile's click layer (see `shell` below), so
                // the explanation is reachable without also drilling down.
                className="pointer-events-auto relative z-10 mt-0.5 shrink-0 text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                onClick={(e) => e.preventDefault()}
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side={dir === "rtl" ? "left" : "right"} className="max-w-[19rem] space-y-1.5 text-xs">
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
                {lang === "ar" ? `${formatNumber(kpi.recordCount, lang)} سجل` : `${kpi.recordCount} record${kpi.recordCount === 1 ? "" : "s"}`}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div
        className={
          metricStateOf(kpi) === "ok"
            ? "num mt-1.5 text-[22px] font-semibold leading-none text-foreground"
            : "mt-1.5 text-md font-medium leading-tight text-muted-foreground"
        }
        data-tabular={metricStateOf(kpi) === "ok" ? "true" : undefined}
      >
        {renderValue(kpi, lang)}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
        <span>
          {lang === "ar" ? `${formatNumber(kpi.recordCount, lang)} سجل` : `${kpi.recordCount} record${kpi.recordCount === 1 ? "" : "s"}`}
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

      {delta ? <div className="mt-1.5">{delta}</div> : null}

      {hint ? <div className="mt-1 text-2xs text-muted-foreground/70">{hint}</div> : null}

      {/* A caveat is part of the number's meaning, so it is always visible —
          not tucked into the tooltip where it can be missed. */}
      {kpi.caveat ? (
        <div className="mt-1.5 flex items-start gap-1 text-2xs text-amber-light">
          <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          {/* Translated here, not in the engine: the engine knows the fact,
              this knows the language. Numbers go through formatNumber so
              Arabic gets Arabic-Indic digits rather than String(n). */}
          <span>{formatMessage(kpi.caveat, (k) => t(k as never), (v) => (typeof v === "number" ? formatNumber(v, lang) : String(v)))}</span>
        </div>
      ) : null}

      {/* An empty state that only describes itself is a dead end, and four of
          them side by side read as a broken page. This is the way out, scoped
          to the exact records that are missing the input. */}
      {kpi.fix ? (
        <div className="mt-1.5 text-2xs font-medium text-amber-light underline-offset-2 hover:underline">
          {t(kpi.fix.labelKey as never)} →
        </div>
      ) : null}
    </>
  );

  // The tile's click target is a LAYER, not a wrapper.
  //
  // Wrapping `body` in <button> or <Link> put the tooltip's own <button> inside
  // an interactive element: invalid HTML, a React hydration error on every
  // render, and — the user-visible half — asking "how is this calculated"
  // also fired the drill-down, so the explanation was unreadable on a tile
  // that navigates away. An absolutely positioned layer keeps exactly one
  // interactive element per purpose and nests neither inside the other.
  const shell =
    "relative overflow-hidden rounded-xl border border-border/70 bg-surface/60 px-4 py-3 transition-colors";
  const layer =
    "absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const interactive = "hover:border-border-strong hover:bg-surface-2/40";
  // Content ignores pointers so the layer beneath receives the click; the info
  // trigger opts back in above.
  const content = <div className="pointer-events-none">{body}</div>;
  const openLabel = lang === "ar" ? `افتح ${label}` : `Open ${label}`;

  // One link per tile — a fix link nested inside a drilldown link is invalid
  // markup and the inner one never fires. When a metric cannot be computed the
  // fix takes the tile, because drilling into records that cannot answer the
  // question is not the action the reader needs.
  // An explicit in-page handler wins: it is the more specific intent, and it
  // keeps the reader on the dashboard rather than navigating away.
  if (onOpen) {
    return (
      <div className={`${shell} ${interactive}`}>
        <button type="button" onClick={onOpen} aria-label={openLabel} className={layer} />
        {content}
      </div>
    );
  }

  const target = kpi.fix
    ? { to: kpi.fix.to, search: kpi.fix.search }
    : clickable
      ? { to: kpi.drilldown!.to, search: kpi.drilldown!.search }
      : null;

  // A 3px edge, INSIDE the card. The reference dashboards carry their colour on
  // the cards; this app's warm-neutral canvas is its identity and stays put.
  // `start-0` rather than `left-0`, so it flips with the Arabic layout.
  const edge = accent ? (
    <span className={`absolute inset-y-0 start-0 w-[3px] ${ACCENT[accent].bar}`} aria-hidden="true" />
  ) : null;

  if (!target)
    return (
      <div className={shell}>
        {edge}
        {content}
      </div>
    );

  return (
    <div className={`${shell} ${interactive}`}>
      {edge}
      <Link
        to={target.to as never}
        search={target.search as never}
        aria-label={openLabel}
        className={layer}
      />
      {content}
    </div>
  );
}
