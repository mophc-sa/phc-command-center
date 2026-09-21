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
  /** "attention" = needs a look; "critical" = something is overdue or failing. */
  tone?: "default" | "attention" | "critical";
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-surface shadow-card transition-shadow duration-200 hover:shadow-elevated",
        tone === "critical" ? "border-destructive" : tone === "attention" ? "border-amber" : "border-border",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold tracking-[0.02em] text-muted-foreground">
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
