import { Minus, Plus, Type } from "lucide-react";
import { useFontScale } from "@/hooks/useFontScale";
import { useI18n } from "@/lib/i18n";

/**
 * Accessibility control for user-adjustable text size.
 * Persists via localStorage and sets `data-font-scale` on <html>.
 */
export function FontSizeControl() {
  const { scale, increment, decrement, reset, options } = useFontScale();
  const { lang } = useI18n();
  const label = lang === "ar" ? "حجم الخط" : "Text size";
  const decLabel = lang === "ar" ? "تصغير الخط" : "Decrease text size";
  const incLabel = lang === "ar" ? "تكبير الخط" : "Increase text size";
  const resetLabel = lang === "ar" ? "إعادة الضبط" : "Reset text size";
  const atMin = scale === options[0];
  const atMax = scale === options[options.length - 1];

  return (
    <div
      className="inline-flex h-8 items-center gap-0.5 rounded-md border border-border bg-surface px-1"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        onClick={decrement}
        disabled={atMin}
        aria-label={decLabel}
        className="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
      >
        <Minus className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={reset}
        aria-label={resetLabel}
        title={`${label}: ${scale.toUpperCase()}`}
        className="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
      >
        <Type className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={increment}
        disabled={atMax}
        aria-label={incLabel}
        className="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}
