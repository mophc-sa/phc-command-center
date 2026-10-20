// Construction progress as a bar. NULL means nobody has reported it, which is
// not 0% -- so it renders "—", never an empty bar.
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function CompletionBar({ pct, compact = false }: { pct: number | null | undefined; compact?: boolean }) {
  const { lang } = useI18n();
  if (pct === null || pct === undefined) {
    return (
      <span className="text-xs text-muted-foreground" title={lang === "ar" ? "لم تُسجَّل نسبة إنجاز" : "No progress reported"}>
        —
      </span>
    );
  }
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={cn("flex items-center gap-2", compact ? "min-w-24" : "w-full")}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-label={lang === "ar" ? "نسبة إنجاز الموقع" : "Construction progress"}
      >
        <div className="h-full rounded-full bg-foreground/70" style={{ width: `${clamped}%` }} />
      </div>
      <span className="num w-9 text-end text-xs font-medium text-foreground" data-tabular="true">
        {clamped}%
      </span>
    </div>
  );
}
