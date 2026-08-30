// =============================================================================
// The green-or-red pill from every analytics dashboard — with one difference.
//
// It renders nothing when there is nothing to compare to. `monthOverMonth`
// returns null when neither month holds a record, and returns a null ratio when
// the previous month was empty: going from 0 to 5 is a start, not "+500%".
// Both cases produce no pill rather than a confident-looking zero.
//
// **Up is not good.** The arrow says which way the number moved; the colour
// says whether that is welcome, and only the caller knows. More opportunities
// created is good; more deals lost is not, and the same green arrow on both
// would be worse than no colour at all. `goodDirection` makes the caller say.
// =============================================================================

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatNumber, useI18n } from "@/lib/i18n";
import type { Delta } from "@/lib/period-delta";

export function DeltaPill({
  delta,
  goodDirection = "up",
  className = "",
}: {
  delta: Delta | null;
  /** Which way is welcome for THIS metric. Losses rising is not good news. */
  goodDirection?: "up" | "down";
  className?: string;
}) {
  const { lang } = useI18n();
  if (!delta || delta.ratio === null) return null;

  const good = delta.direction === "flat" ? null : delta.direction === goodDirection;
  const Icon = delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  const tone =
    good === null
      ? "border-border bg-surface-2/70 text-muted-foreground"
      : good
        ? "border-won/25 bg-won/[0.08] text-won-on-tint"
        : "border-destructive/25 bg-destructive/[0.08] text-destructive-on-tint";

  const pct = Math.abs(delta.ratio) * 100;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span
        className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-2xs font-semibold ${tone}`}
      >
        {/* The arrow is the direction, not the verdict — see the header. It is
            decorative because the sign is already in the number beside it. */}
        <Icon className="h-2.5 w-2.5 rtl:-scale-x-100" aria-hidden="true" strokeWidth={2.5} />
        <span className="num" data-tabular="true">
          {formatNumber(pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct), lang)}%
        </span>
      </span>
      <span className="text-2xs text-muted-foreground">
        {lang === "ar" ? "عن الشهر الماضي" : "since last month"}
      </span>
    </span>
  );
}
