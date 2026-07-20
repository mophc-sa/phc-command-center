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

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition-all duration-200 hover:shadow-elevated",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {icon ? (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <span
          className="text-[40px] font-semibold leading-none tracking-[-0.03em] text-foreground num"
          data-tabular="true"
        >
          {value}
        </span>
        {delta ? (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[11px] font-medium", pillColor)}>
            <TrendIcon className="h-3 w-3" strokeWidth={2.25} />
            {delta}
          </span>
        ) : null}
      </div>
      {hint ? (
        <div className="mt-1.5 text-[12px] text-muted-foreground">{hint}</div>
      ) : null}
      {footer ? <div className="mt-4 border-t border-border pt-3">{footer}</div> : null}
    </div>
  );
}
