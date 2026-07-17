import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Panel/card wrapper used to group related content.
 * Consistent surface, border, padding, and optional header row.
 * Replaces ad-hoc `rounded-lg border border-border bg-surface p-4` blocks.
 */
export function ChartFrame({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-border/70 bg-surface/60 transition-shadow duration-200 hover:shadow-card",
        className,
      )}
    >
      {(title || action) ? (
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            {title ? (
              <div className="text-[13px] font-semibold text-foreground">{title}</div>
            ) : null}
            {subtitle ? (
              <div className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn(padded ? "p-5" : "", bodyClassName)}>{children}</div>
    </div>
  );
}
