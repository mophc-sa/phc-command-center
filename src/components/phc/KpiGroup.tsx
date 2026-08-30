// =============================================================================
// A row of KPIs where the ones that have no number take up the room they
// deserve, which is a line — not a card.
//
// Measured on production, 2026-08-30: the Command Center rendered nineteen KPI
// cards above the fold and **fifteen of them said "no data yet" or "needs
// setup"**. Each empty one cost a full card, an amber caveat and a call to
// action, and the single real figure — SAR 63,407,478 — appeared twice,
// identically, in two different rows. The seven charts on that page sat below
// all of it, so a manager scrolled through a wall of absences to reach the
// first thing that was actually drawn.
//
// KpiTile's own source already named this: "An empty state that only describes
// itself is a dead end, and four of them side by side read as a broken page."
// There are fifteen.
//
// **Nothing is hidden.** This codebase is explicit that a dash and a zero are
// different facts, and that "we cannot compute this" and "nobody has set this
// up" need different actions from the reader. All of that survives: every
// unavailable metric is named, grouped by the reason it is unavailable, and
// carries its fix. What changes is proportion — an absence gets a line, a
// number gets a card.
//
// The grouping is what makes it shorter than the sum of its parts. Five tiles
// saying "no target has been set for this period" are one sentence and one
// link, said once.
// =============================================================================

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { KpiTile } from "@/components/phc/KpiTile";
import { useI18n } from "@/lib/i18n";
import { metricStateOf, type Kpi, type MetricState } from "@/lib/sales-kpis";

export type KpiEntry = {
  kpi: Kpi;
  label: string;
  hint?: string;
  onOpen?: () => void;
};

/**
 * Why a metric has no number, in the reader's language.
 *
 * One entry per state the engine can report. `ok` is absent by construction —
 * a metric in that state has a number and never reaches this map.
 */
const REASON: Record<Exclude<MetricState, "ok">, { en: string; ar: string }> = {
  not_configured: {
    en: "Waiting on a setting nobody has entered yet",
    ar: "بانتظار إعداد لم يُدخله أحد بعد",
  },
  no_data: {
    en: "No records fall in this period yet",
    ar: "لا سجلات تقع في هذه الفترة بعد",
  },
  not_calculated: {
    en: "The records exist but lack an input the formula needs",
    ar: "السجلات موجودة لكنها تنقصها مدخلات تحتاجها المعادلة",
  },
  not_applicable: {
    en: "Does not apply to this view",
    ar: "لا ينطبق على هذه الشاشة",
  },
};

const ORDER: Array<Exclude<MetricState, "ok">> = [
  "not_configured",
  "not_calculated",
  "no_data",
  "not_applicable",
];

export function KpiGroup({
  title,
  subtitle,
  entries,
  columns = "lg:grid-cols-3 xl:grid-cols-6",
}: {
  title: string;
  subtitle?: string;
  entries: KpiEntry[];
  className?: string;
  columns?: string;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);

  const live = entries.filter((e) => metricStateOf(e.kpi) === "ok");
  const blank = entries.filter((e) => metricStateOf(e.kpi) !== "ok");

  // Grouped by reason, so five metrics waiting on the same missing target are
  // one sentence rather than five cards repeating it.
  const byReason = new Map<Exclude<MetricState, "ok">, KpiEntry[]>();
  for (const e of blank) {
    const s = metricStateOf(e.kpi) as Exclude<MetricState, "ok">;
    byReason.set(s, [...(byReason.get(s) ?? []), e]);
  }

  // One link per distinct destination. The same "set the sales target" fix was
  // repeating on every tile that depended on it.
  const fixes = new Map<string, { to: string; label: string }>();
  for (const e of blank) {
    if (!e.kpi.fix) continue;
    const to = e.kpi.fix.to;
    if (!fixes.has(to)) fixes.set(to, { to, label: t(e.kpi.fix.labelKey as never) });
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {subtitle ? <span className="section-label">{subtitle}</span> : null}
      </div>

      {live.length > 0 ? (
        <div className={`grid gap-3 sm:grid-cols-2 ${columns}`}>
          {live.map((e) => (
            <KpiTile key={e.label} kpi={e.kpi} label={e.label} hint={e.hint} onOpen={e.onOpen} />
          ))}
        </div>
      ) : null}

      {blank.length > 0 ? (
        <div className={`rounded-xl border border-border/60 bg-surface/50 px-4 py-3 ${live.length > 0 ? "mt-3" : ""}`}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={`kpi-blank-${title}`}
            className="flex w-full items-center justify-between gap-3 text-start"
          >
            <span className="text-sm text-muted-foreground">
              {lang === "ar"
                ? `${blank.length} من ${entries.length} مؤشرًا لا يمكن حسابها بعد`
                : `${blank.length} of ${entries.length} metrics cannot be calculated yet`}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>

          {/* Collapsed by default and never summarised away: the count is on
              the button, so the reader knows the size of what they have not
              been shown before deciding to look. */}
          {open ? (
            <div id={`kpi-blank-${title}`} className="mt-3 space-y-3 border-t border-border/60 pt-3">
              {ORDER.filter((s) => byReason.has(s)).map((state) => (
                <div key={state}>
                  <p className="section-label mb-1">{REASON[state][lang]}</p>
                  <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-foreground">
                    {byReason.get(state)!.map((e) => (
                      <li key={e.label} className="after:ms-3 after:text-border after:content-['·'] last:after:content-['']">
                        {e.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {fixes.size > 0 ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-3">
                  {[...fixes.values()].map((f) => (
                    <Link
                      key={f.to}
                      to={f.to}
                      className="text-2xs font-medium text-amber-light underline-offset-2 hover:underline"
                    >
                      {f.label} →
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
