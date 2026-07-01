import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Tone = "neutral" | "attention" | "positive" | "muted" | "danger";

export function StatusPill({
  tone = "neutral",
  children,
  className,
  icon,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  const tones: Record<Tone, string> = {
    neutral: "border-border bg-surface text-foreground",
    attention: "border-amber/40 bg-amber/10 text-amber-light",
    positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    muted: "border-border bg-transparent text-muted-foreground",
    danger: "border-red-500/40 bg-red-500/10 text-red-300",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
