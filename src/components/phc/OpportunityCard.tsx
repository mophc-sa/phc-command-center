import { Link } from "@tanstack/react-router";
import { StatusPill } from "./StatusPill";
import { formatCurrency, type Lang } from "@/lib/i18n";

export type OpportunityRow = {
  id: string;
  project_name: string;
  client: string | null;
  main_contractor: string | null;
  tier: "A" | "B" | "C";
  stage: string;
  signage_package_status: string;
  estimated_value_min: number | null;
  estimated_value_max: number | null;
  quotation_value: number | null;
  currency: string;
  next_action: string | null;
  last_activity_at: string | null;
  source_confidence: "high" | "medium" | "low";
};

export function OpportunityCard({ o, lang }: { o: OpportunityRow; lang: Lang }) {
  const val =
    o.quotation_value ??
    (o.estimated_value_max ?? o.estimated_value_min);
  return (
    <div className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-structural">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={o.tier === "A" ? "attention" : "neutral"}>Tier {o.tier}</StatusPill>
            <StatusPill tone="muted">{humanize(o.stage)}</StatusPill>
          </div>
          <div className="mt-2 truncate text-sm font-semibold text-foreground">{o.project_name}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {o.client ?? "—"}{o.main_contractor ? ` · ${o.main_contractor}` : ""}
          </div>
        </div>
        <div className="text-right rtl:text-left">
          <div className="text-sm font-semibold text-foreground num" data-tabular="true">
            {formatCurrency(val, lang, o.currency)}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            {humanize(o.signage_package_status)}
          </div>
        </div>
      </div>
      {o.next_action ? (
        <div className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span className="text-amber-light">Next:</span> {o.next_action}
        </div>
      ) : null}
    </div>
  );
}

function humanize(s: string) {
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
