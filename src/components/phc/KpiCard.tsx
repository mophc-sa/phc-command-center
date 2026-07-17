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
  const trendColor =
    trend === "up"
      ? "text-won"
      : trend === "down"
        ? "text-destructive/80"
        : "text-muted-foreground";
  const TrendIcon =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border border-border/70 bg-surface/60 p-5 transition-all duration-200 hover:border-border-strong/70 hover:bg-surface hover:shadow-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {icon ? <span className="text-muted-foreground/80">{icon}</span> : null}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span
          className="text-[28px] font-semibold tracking-[-0.02em] text-foreground num"
          data-tabular="true"
        >
          {value}
        </span>
        {delta ? (
          <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", trendColor)}>
            <TrendIcon className="h-3 w-3" strokeWidth={2.25} />
            {delta}
          </span>
        ) : null}
      </div>
      {hint ? (
        <div className="mt-1.5 text-[12px] text-muted-foreground">{hint}</div>
      ) : null}
      {footer ? <div className="mt-4 border-t border-border/60 pt-3">{footer}</div> : null}
    </div>
  );
}
