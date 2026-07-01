import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DataField({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  const isEmpty = value == null || value === "" || value === "—";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 truncate text-sm",
          isEmpty ? "text-muted-foreground" : "text-foreground",
          mono && "num",
        )}
        data-tabular={mono ? "true" : undefined}
        title={typeof value === "string" ? value : undefined}
      >
        {isEmpty ? "—" : value}
      </div>
    </div>
  );
}
