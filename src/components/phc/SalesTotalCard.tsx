// Review 81/82 item 23 (Omar, decided 2026-11-22): one sales figure — verbal
// awards plus signed sales — with the two parts as small lines under it, so
// the verbal number does not need a card of its own. Riyals on top, counts under.
import { formatCurrency, formatNumber, type Lang } from "@/lib/i18n";

export function SalesTotalCard({ label, hint, verbal, signed, lang }: {
  label: string; hint?: string; lang: Lang;
  verbal: { value: number; count: number }; signed: { value: number; count: number };
}) {
  const ar = lang === "ar";
  const line = (name: string, x: { value: number; count: number }) => (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{name}</span>
      <span className="num text-end font-semibold text-foreground" data-tabular="true">
        {formatCurrency(x.value, lang, "SAR")}
        <span className="block text-2xs font-normal text-muted-foreground">{formatNumber(x.count, lang)} {ar ? "صفقة" : x.count === 1 ? "deal" : "deals"}</span>
      </span>
    </div>
  );
  return (
    <div className="relative rounded-xl border border-border/70 bg-surface p-5 sm:min-h-[168px]">
      <div className="text-sm font-medium tracking-[0.02em] text-muted-foreground">{label}</div>
      <div className="num my-2 text-[clamp(1.375rem,2vw,1.75rem)] font-semibold leading-[1.35] text-foreground" data-tabular="true">
        {formatCurrency(verbal.value + signed.value, lang, "SAR")}
      </div>
      <div className="grid gap-1.5 border-t border-border pt-2">
        {line(ar ? "شفهي" : "Verbal", verbal)}
        {line(ar ? "موقّع" : "Signed", signed)}
      </div>
      {hint ? <div className="mt-1.5 text-2xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** Review 81/82 item 24: achievement as a small ring, not a block. */
export function AchievementRing({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const p = Math.max(0, Math.min(100, pct));
  const r = 16, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 40 40" className="h-12 w-12" role="img" aria-label={`${Math.round(p)}%`}>
      <circle cx="20" cy="20" r={r} fill="none" strokeWidth="5" className="stroke-muted" />
      <circle cx="20" cy="20" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-primary"
        strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 20 20)" />
    </svg>
  );
}
