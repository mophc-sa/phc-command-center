import type { ReactNode } from "react";

export function SectionHeader({
  title,
  count,
  hint,
  action,
}: {
  title: string;
  count?: number;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <h2 className="truncate text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
            {title}
          </h2>
          {typeof count === "number" ? (
            <span className="text-xs text-muted-foreground num" data-tabular="true">
              {count}
            </span>
          ) : null}
        </div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {action}
    </div>
  );
}
