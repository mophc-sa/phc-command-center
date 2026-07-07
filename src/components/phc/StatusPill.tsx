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
    neutral: "border-border bg-surface-2/60 text-foreground/90",
    attention: "border-amber/35 bg-amber/[0.08] text-amber-light",
    positive: "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200",
    muted: "border-border/60 bg-transparent text-muted-foreground",
    danger: "border-red-400/30 bg-red-400/[0.07] text-red-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
