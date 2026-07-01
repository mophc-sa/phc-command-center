import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function MetricTile({
  label,
  value,
  delta,
  hint,
  onAction,
  actionLabel,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  hint?: string;
  onAction?: () => void;
  actionLabel?: string;
  tone?: "neutral" | "attention";
}) {
  return (
    <div
      className={cn(
        "flex min-h-[136px] flex-col justify-between rounded-lg border bg-surface p-5",
        tone === "attention" ? "border-amber/40" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        {tone === "attention" ? (
          <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
        ) : null}
      </div>
      <div className="mt-4">
        <div className="text-3xl font-semibold text-foreground num" data-tabular="true">
          {value}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {delta ? <span>{delta}</span> : null}
          {hint ? <span className="truncate">{hint}</span> : null}
        </div>
      </div>
      {onAction && actionLabel ? (
        <button
          onClick={onAction}
          className="mt-4 self-start text-xs font-medium text-amber-light underline-offset-4 hover:underline"
        >
          {actionLabel} →
        </button>
      ) : null}
    </div>
  );
}
