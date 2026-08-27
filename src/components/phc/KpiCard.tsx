import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export type KpiTrend = "up" | "down" | "flat";

export function KpiCard({
  label,
  value,
  hint,
  trend,
  delta,
  icon,
  footer,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  trend?: KpiTrend;
  delta?: string;
  icon?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const pillColor =
    trend === "up"
      ? "bg-won-surface text-won"
      : trend === "down"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  const TrendIcon =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;

  // A long formatted-currency value (e.g. "2,000,000 SAR" / "٢٬٠٠٠٬٠٠٠ ر.س")
  // at the same fixed size as a short count ("3", "45%") overwhelms the card
  // and crowds out the label above it — shrink it instead of truncating,
  // since clipping a currency figure would misrepresent the amount.
  //
  // An ABSENT value is the third case, and it was being rendered as the first.
  // "—" set at 40px is a solid black bar the width of a thumb: on screen it
  // read as a redaction, not as "nothing to show", and it carried more visual
  // weight than the largest real number on the page. An absence should be the
  // quietest thing in the card, not the loudest.
  const valueText = typeof value === "string" ? value : "";
  const isAbsent = /^[—–-]$/.test(valueText.trim());
  const valueSizeClass = isAbsent
    ? "text-[22px] text-muted-foreground/70"
    : valueText.length > 9
      ? "text-[26px]"
      : "text-[40px]";

  return (
    // One boundary per card, not two. A hairline border and a filled surface
    // already separate a card from the page; the resting shadow underneath was
    // a second, weaker statement of the same thing, and repeated across a grid
    // of four it read as clutter. The shadow now appears only on hover, where
    // it means something — this card is the one under your cursor.
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border border-border bg-surface p-5 transition-shadow duration-200 hover:shadow-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="section-label">{label}</span>
        {icon ? (
          // The icon sat in a filled circle, which made it a second focal point
          // competing with the number for the eye. It is an aid to scanning a
          // grid, not a subject: no chip, lower contrast, out of the way.
          <span className="shrink-0 text-muted-foreground/50">{icon}</span>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <span
          className={cn("font-semibold leading-none tracking-[-0.03em] text-foreground num", valueSizeClass)}
          data-tabular="true"
        >
          {value}
        </span>
        {delta ? (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-xs font-medium", pillColor)}>
            <TrendIcon className="h-3 w-3" strokeWidth={2.25} />
            {delta}
          </span>
        ) : null}
      </div>
      {hint ? (
        <div className="mt-1.5 text-sm text-muted-foreground">{hint}</div>
      ) : null}
      {footer ? <div className="mt-4 border-t border-border pt-3">{footer}</div> : null}
    </div>
  );
}
