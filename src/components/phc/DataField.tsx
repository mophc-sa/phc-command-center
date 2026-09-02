import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { hasLink, linkify } from "@/lib/linkify";

/**
 * A pasted URL renders as something you can click.
 *
 * Reported 2026-09-02: a link added to a record was inert text — select, copy,
 * switch to the address bar, every time. Only http(s) is ever turned into an
 * anchor; see linkify.ts for why that restriction is the whole point.
 *
 * Only plain strings go through it. A caller that already passed an element
 * built its own markup on purpose, and re-parsing that would be a way to
 * surprise it.
 */
function renderValue(value: ReactNode): ReactNode {
  if (typeof value !== "string" || !hasLink(value)) return value;
  return linkify(value).map((seg, i) =>
    seg.kind === "link" ? (
      <a
        key={i}
        href={seg.href}
        target="_blank"
        // noreferrer as well as noopener: the destination is whatever someone
        // typed into a field, and it has no business reading where it came from.
        rel="noopener noreferrer"
        className="text-info underline underline-offset-2 hover:no-underline"
      >
        {seg.text}
      </a>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  );
}

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
      <div className="text-xs tracking-[0.02em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 truncate text-sm",
          isEmpty ? "text-muted-foreground" : "text-foreground",
          mono && "num",
        )}
        data-tabular={mono ? "true" : undefined}
        title={typeof value === "string" ? value : undefined}
      >
        {isEmpty ? "—" : renderValue(value)}
      </div>
    </div>
  );
}
