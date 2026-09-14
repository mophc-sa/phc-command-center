import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Native disclosure keeps the summary keyboard accessible and avoids mounting charts in a zero-width hidden panel. */
export function ExecutiveDisclosure({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="executive-disclosure group rounded-xl border border-border bg-surface"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-base font-semibold text-foreground">{title}</span>
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
            {description}
          </span>
        </span>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <div className="min-w-0 border-t border-border p-3 sm:p-5">{open ? children : null}</div>
    </details>
  );
}
