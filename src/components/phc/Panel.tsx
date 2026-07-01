import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  subtitle,
  action,
  children,
  tone = "default",
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  tone?: "default" | "attention";
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-surface",
        tone === "attention" ? "border-amber/30" : "border-border",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
