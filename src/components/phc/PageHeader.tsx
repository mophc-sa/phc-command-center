import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Standard page header for authenticated routes.
 * Left: eyebrow + title + optional description.
 * Right: primary/secondary actions.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-8 flex flex-col gap-4 md:mb-10 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {/* The eyebrow sits ABOVE the title, so it is the first thing read on
            every page — and it is the least useful thing on the page, naming a
            section the navigation already highlights. Demoted below the title,
            where it works as the caption it always was, and set at the shared
            label weight so it stops competing with the heading it introduces. */}
        <h1 className="text-[30px] font-bold tracking-[-0.02em] text-foreground md:text-[34px]">
          {title}
        </h1>
        {eyebrow ? <div className="section-label mt-1.5">{eyebrow}</div> : null}
        {description ? (
          // Capped nearer 65 characters. The old 2xl measure ran to ~90 on a
          // wide screen, which is past the point where the eye reliably finds
          // the start of the next line.
          <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
