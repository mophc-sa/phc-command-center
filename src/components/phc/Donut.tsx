// =============================================================================
// A donut, for the one job a donut is actually good at.
//
// Part-to-whole with a small number of categories, where the reader wants the
// shape of the split more than the exact figures — and the exact figures are
// written in the legend beside it anyway.
//
// It caps at five slices and says so, because past that the arcs get too close
// in length to tell apart and a donut becomes a decorative circle. The stacked
// bar in PipelineComposition handles the seven-stage case for exactly that
// reason; this is not a replacement for it.
//
// Drawn as SVG rather than pulled from the chart library: it is one path per
// slice, it needs no axes, tooltip layer or responsive container, and a
// hand-drawn ring is a tenth of the code and none of the runtime.
// =============================================================================

import { useI18n } from "@/lib/i18n";
import { formatNumber } from "@/lib/i18n";

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  /** A CSS colour — pass a token, e.g. `var(--color-won)`. */
  color: string;
};

/** Past five, arc lengths stop being comparable. See the file header. */
export const DONUT_MAX_SLICES = 5;

const TAU = Math.PI * 2;
const R = 42;
const STROKE = 16;
const C = TAU * R;

export function Donut({
  slices,
  total,
  caption,
  size = 132,
  onSelect,
}: {
  slices: DonutSlice[];
  /** Written in the hole. Defaults to the sum. */
  total?: number;
  caption?: string;
  size?: number;
  /**
   * Open the records behind a slice.
   *
   * The LEGEND row is the control, not the arc. A 16px band is a poor target
   * with a mouse and an impossible one with a thumb, and the legend already
   * exists as this chart's accessible table -- so the reachable thing and the
   * readable thing are the same thing. The arc follows along for whoever aims
   * at it, but nothing depends on hitting it.
   *
   * Omitted, the donut stays exactly what it was: a picture. A chart that
   * names a problem and cannot be opened is a dead end, but not every chart
   * has records behind it to open.
   */
  onSelect?: (key: string) => void;
}) {
  const { lang } = useI18n();
  const sum = slices.reduce((a, s) => a + s.value, 0);

  if (sum <= 0) {
    return (
      <p className="text-2xs text-muted-foreground">
        {lang === "ar" ? "لا بيانات لهذا التقسيم بعد." : "Nothing to divide up yet."}
      </p>
    );
  }

  // Offsets accumulate so each arc starts where the last one ended. Drawn from
  // twelve o'clock, clockwise, in the order given — which the caller keeps
  // meaningful (largest first, or pipeline order).
  let offset = 0;
  const arcs = slices.map((s) => {
    const frac = s.value / sum;
    const arc = { ...s, frac, dash: frac * C, offset };
    offset += frac * C;
    return arc;
  });

  const shown = total ?? sum;

  return (
    <div className="flex items-center gap-4">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="shrink-0 -rotate-90"
        role="img"
        aria-label={slices.map((s) => `${s.label}: ${formatNumber(s.value, lang)}`).join(" · ")}
      >
        {/* The track, so a mostly-empty ring still reads as a ring. */}
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--color-muted)" strokeWidth={STROKE} />
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth={STROKE}
            strokeDasharray={`${a.dash} ${C - a.dash}`}
            strokeDashoffset={-a.offset}
            className={onSelect ? "cursor-pointer" : undefined}
            onClick={onSelect ? () => onSelect(a.key) : undefined}
          >
            <title>{`${a.label} — ${formatNumber(a.value, lang)} (${Math.round(a.frac * 100)}%)`}</title>
          </circle>
        ))}
        {/* Counter-rotated so the figure in the hole reads upright. */}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          transform="rotate(90 50 50)"
          className="num fill-foreground text-[19px] font-semibold"
        >
          {formatNumber(shown, lang)}
        </text>
      </svg>

      {/* The legend is the chart's accessible table: label, figure and share in
          words, so nothing here is carried by colour alone. */}
      <ul className="min-w-0 flex-1 space-y-1.5">
        {arcs.map((a) => {
          const row = (
            <>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: a.color }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-start text-foreground">{a.label}</span>
              <span className="num shrink-0 font-semibold text-foreground" data-tabular="true">
                {formatNumber(a.value, lang)}
              </span>
              <span className="num w-9 shrink-0 text-end text-muted-foreground" data-tabular="true">
                {Math.round(a.frac * 100)}%
              </span>
            </>
          );
          return (
          <li key={a.key} className="text-2xs">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(a.key)}
                className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-2xs transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {row}
              </button>
            ) : (
              <span className="flex items-center gap-2 px-1 py-0.5">{row}</span>
            )}
          </li>
          );
        })}
        {caption ? <li className="pt-0.5 text-2xs text-muted-foreground">{caption}</li> : null}
      </ul>
    </div>
  );
}
