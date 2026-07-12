import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Action = { label: string; onClick: () => void; icon?: LucideIcon };

/**
 * EmptyState 2.0 — backward-compatible upgrade.
 *
 * Legacy usage (message only) works unchanged.
 * New usage: pass icon + title + description + primaryAction / secondaryAction.
 *
 * Never pass a loading message here — use Skeleton components for loading states.
 */
export function EmptyState({
  // Legacy compat
  message,
  hint,
  // New optional props
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  variant = "empty",
  compact = false,
  className,
}: {
  message?: string;
  hint?: string;
  icon?: LucideIcon;
  title?: string;
  description?: string;
  primaryAction?: Action;
  secondaryAction?: Action;
  variant?: "empty" | "error" | "no-results";
  compact?: boolean;
  className?: string;
}) {
  const displayTitle = title ?? message;
  const displayDesc = description ?? hint;
  const PrimaryIcon = primaryAction?.icon;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center",
        compact ? "px-4 py-5" : "px-5 py-8",
        variant === "error"
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-surface/40",
        className,
      )}
    >
      {Icon ? (
        <Icon
          className="mb-1 h-7 w-7 text-muted-foreground/50"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      ) : null}
      {displayTitle ? (
        <p className="text-sm font-medium text-foreground">{displayTitle}</p>
      ) : null}
      {displayDesc ? (
        <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">{displayDesc}</p>
      ) : null}
      {primaryAction || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {primaryAction ? (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light transition-colors hover:bg-amber/20"
            >
              {PrimaryIcon ? (
                <PrimaryIcon className="h-3.5 w-3.5" aria-hidden="true" />
              ) : null}
              {primaryAction.label}
            </button>
          ) : null}
          {secondaryAction ? (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
