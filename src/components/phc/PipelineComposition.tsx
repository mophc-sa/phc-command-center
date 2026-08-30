// =============================================================================
// Where the money actually is, in one bar.
//
// The Command Center opened with SAR 63,407,478 stated twice, in two rows, as
// two identical cards — and nothing anywhere said how that total was made up.
// A single figure that large is not a finding; it is a question. The finding is
// that a third of it sits in one deal, or that most of it has not reached
// negotiation, and neither was visible without opening the records.
//
// One stacked bar answers it before the reader has scrolled. Colour carries the
// stage boundary the business already uses (see --stage-* in styles.css): slate
// while a deal is being worked, amber once it is committed and can still be
// lost. So the bar answers a second question at the same time — how much of
// this is real — without a second chart.
//
// Deliberately not a pie. Seven slices is past the point where a pie is
// readable, and comparing arc lengths is the least accurate judgement the eye
// makes. A stacked bar is one dimension, read in pipeline order, with every
// figure written out in the legend beneath it.
// =============================================================================

import { Link } from "@tanstack/react-router";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";

export type StageSlice = {
  /** Canonical stage key — used for the colour index and the drilldown. */
  key: string;
  label: string;
  value: number;
  count: number;
  /** 1-7, matching --stage-N. Pipeline order, not enum order. */
  tone: number;
};

/*
 * The percentages live in the legend, not on the bar.
 *
 * Writing them on the segments was the first draft, and measurement killed it:
 * with seven fills that all have to clear 3:1 against the surface, there is no
 * single text colour that clears 4.5:1 on all of them — tone 2 failed against
 * both white (3.95) and near-black (4.19), and so did tone 7. Per-segment text
 * colours would have fixed the arithmetic and left a bar whose labels change
 * colour halfway along for no reason the reader can see.
 *
 * In the legend each figure sits on the surface, where one text colour is
 * legible for all seven, and the legend is where a reader compares numbers
 * anyway. The bar keeps one job: showing proportion.
 */

export function PipelineComposition({
  slices,
  total,
  recordCount,
  unvaluedCount = 0,
  drilldownTo,
  className = "mb-6",
}: {
  slices: StageSlice[];
  total: number;
  recordCount: number;
  /** Records excluded from the total because they carry no value at all. */
  unvaluedCount?: number;
  drilldownTo?: string;
  className?: string;
}) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const sum = slices.reduce((a, s) => a + s.value, 0);

  if (sum <= 0) {
    return (
      <div className="rounded-xl border border-border/70 bg-surface/60 p-5">
        <p className="text-sm text-muted-foreground">
          {ar ? "لا قيمة مسجَّلة على أي فرصة مفتوحة بعد." : "No open opportunity carries a recorded value yet."}
        </p>
      </div>
    );
  }

  const share = (v: number) => v / sum;

  /**
   * A stage holding real money must never round to "0%".
   *
   * SAR 137,000 against a 63M book is 0.2%, and rendering that as 0 says the
   * stage is empty when it is not — the same class of error as a total that
   * silently drops rows.
   *
   * It shows a decimal rather than "<1%", which was the first attempt and is
   * wrong here: `<` is a mirrored character, so in the Arabic layout it renders
   * as `1%>` and a reader has to know the bidi rules to recover the meaning.
   * `0.2%` carries no operator, needs no mirroring, and is more precise anyway.
   */
  const pct = (v: number) => {
    const p = share(v) * 100;
    return p > 0 && p < 1 ? `${formatNumber(Math.max(p, 0.1), lang, { maximumFractionDigits: 1 })}%` : `${formatNumber(Math.round(p), lang)}%`;
  };

  return (
    <section className={`rounded-xl border border-border/70 bg-surface/60 p-5 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="section-label">{ar ? "خط الأنابيب المفتوح" : "Open pipeline"}</p>
          <p
            className="num mt-1 text-[34px] font-semibold leading-none tracking-[-0.03em] text-foreground sm:text-[40px]"
            data-tabular="true"
          >
            {formatCurrency(total, lang)}
          </p>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            {ar
              ? `عبر ${formatNumber(recordCount, lang)} فرصة`
              : `across ${formatNumber(recordCount, lang)} opportunities`}
            {/* Stated on the figure itself, not in a footnote. A total that
                silently omits records is the exact failure this codebase spent
                a week removing from the dashboard. */}
            {unvaluedCount > 0 ? (
              <>
                {" · "}
                <span className="text-amber-light">
                  {ar
                    ? `${formatNumber(unvaluedCount, lang)} بلا قيمة مسجَّلة، غير مشمولة`
                    : `${formatNumber(unvaluedCount, lang)} carry no value and are not included`}
                </span>
              </>
            ) : null}
          </p>
        </div>

        {drilldownTo ? (
          <Link
            to={drilldownTo}
            className="text-2xs font-medium text-amber-light underline-offset-2 hover:underline"
          >
            {ar ? "افتح السجلات" : "Open the records"} →
          </Link>
        ) : null}
      </div>

      {/* The bar. `role="img"` with a written label, because a stacked bar is
          a picture of a fact and a screen reader needs the fact, not the
          geometry — the same breakdown is in the legend below regardless. */}
      <div
        className="mt-4 flex h-9 w-full overflow-hidden rounded-lg"
        role="img"
        aria-label={slices
          .map((s) => `${s.label}: ${formatCurrency(s.value, lang)}`)
          .join(" · ")}
      >
        {slices.map((s) => (
          <div
            key={s.key}
            className="flex items-center justify-center overflow-hidden transition-[flex-grow] duration-300 motion-reduce:transition-none"
            style={{ flexGrow: s.value, background: `var(--stage-${s.tone})` }}
            title={`${s.label} — ${formatCurrency(s.value, lang)} (${pct(s.value)})`}
          />
        ))}
      </div>

      {/* The legend is the accessible table for the bar: every stage present,
          in pipeline order, with its own figure. Colour is never the only
          carrier — the label and the number are always written. */}
      <ul className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-2xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: `var(--stage-${s.tone})` }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
            <span className="num shrink-0 font-semibold text-foreground" data-tabular="true">
              {formatCurrency(s.value, lang)}
            </span>
            <span className="num w-9 shrink-0 text-end font-semibold text-foreground" data-tabular="true">
              {pct(s.value)}
            </span>
            <span className="num w-6 shrink-0 text-end text-muted-foreground" data-tabular="true">
              {formatNumber(s.count, lang)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-border/60 pt-2.5 text-2xs text-muted-foreground">
        {t("pc_key" as never)}
      </p>
    </section>
  );
}
