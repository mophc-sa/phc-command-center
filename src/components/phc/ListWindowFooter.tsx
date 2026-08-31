// =============================================================================
// The line that stops a windowed list from lying by omission.
//
// A list showing the first fifty of 739 without saying so is not merely
// incomplete -- it is misleading in a specific way: the reader scrolls to the
// bottom, finds nothing more, and concludes that is everything there is. On a
// page whose whole job is to be the record of what exists, that is the worst
// failure available.
//
// So the count is never optional and never a tooltip. It states what is shown,
// what is held back, and offers both a step and the whole list.
//
// One component rather than the same block in three routes: not for reuse in
// the abstract, but because the WORDING is the safeguard. Three copies drift,
// and the day one of them stops saying "of 739" is the day that list starts
// lying.
// =============================================================================

import { useI18n, formatNumber } from "@/lib/i18n";
import type { Windowed } from "@/lib/windowed-list";

export function ListWindowFooter<T>({ win }: { win: Windowed<T> }) {
  const { lang } = useI18n();
  if (!win.hasMore) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface/40 px-4 py-3 text-2xs text-muted-foreground">
      <span>
        {lang === "ar"
          ? `يُعرض ${formatNumber(win.shown, lang)} من ${formatNumber(win.total, lang)} — ${formatNumber(win.hidden, lang)} غير معروضة`
          : `Showing ${formatNumber(win.shown, lang)} of ${formatNumber(win.total, lang)} — ${formatNumber(win.hidden, lang)} not shown`}
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={win.showMore}
          className="rounded-md border border-border px-3 py-1.5 font-semibold text-foreground transition-colors hover:bg-surface-2/60"
        >
          {lang === "ar" ? "اعرض المزيد" : "Show more"}
        </button>
        <button
          type="button"
          onClick={win.showAll}
          className="rounded-md px-3 py-1.5 font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {lang === "ar"
            ? `اعرض الكل (${formatNumber(win.total, lang)})`
            : `Show all (${formatNumber(win.total, lang)})`}
        </button>
      </span>
    </div>
  );
}
