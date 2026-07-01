import type { ReactNode } from "react";
import { StatusPill } from "./StatusPill";
import { ChevronRight } from "lucide-react";

export function PriorityItem({
  title,
  subtitle,
  reason,
  owner,
  due,
  tier,
  value,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  reason: string;
  owner?: string;
  due?: string;
  tier?: "A" | "B" | "C";
  value?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border/70 px-1 py-4 first:border-t-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {tier ? (
            <StatusPill tone={tier === "A" ? "attention" : "neutral"}>Tier {tier}</StatusPill>
          ) : null}
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
        </div>
        {subtitle ? (
          <div className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-amber-light">{reason}</span>
          {value ? (
            <span className="text-muted-foreground num" data-tabular="true">
              {value}
            </span>
          ) : null}
          {owner ? <span className="text-muted-foreground">Owner: {owner}</span> : null}
          {due ? <span className="text-muted-foreground">Due: {due}</span> : null}
        </div>
      </div>
      {actionLabel ? (
        <button
          onClick={onAction}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          {actionLabel}
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </button>
      ) : null}
    </div>
  );
}
