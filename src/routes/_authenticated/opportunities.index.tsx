import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, LayoutGrid, Rows3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { OpportunityCard, type OpportunityRow } from "@/components/phc/OpportunityCard";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { Link } from "@tanstack/react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { humanize } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/opportunities/")({
  validateSearch: (s: Record<string, unknown>) => ({
    q:     typeof s.q === "string" ? s.q : "",
    stage: typeof s.stage === "string" ? s.stage : "all",
    tier:  typeof s.tier === "string" ? s.tier : "all",
    view:  s.view === "table" ? "table" as const : "cards" as const,
  }),
  head: () => ({
    meta: [
      { title: "Opportunities — PHC" },
      { name: "description", content: "Every active opportunity, its stage, owner, next action and commercial value." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OppList,
});

const STAGES = ["discovery", "qualification", "preparation", "quotation", "follow_up", "won", "lost", "archived"] as const;
const CLOSED = ["won", "lost", "archived"];

function OppList() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { q: search, stage, tier, view } = Route.useSearch();

  const setSearch = (v: string) => navigate({ to: ".", search: { q: v, stage, tier, view }, replace: true });
  const setStage  = (v: string) => navigate({ to: ".", search: { q: search, stage: v, tier, view }, replace: true });
  const setTier   = (v: string) => navigate({ to: ".", search: { q: search, stage, tier: v, view }, replace: true });
  const setView   = (v: "cards" | "table") => navigate({ to: ".", search: { q: search, stage, tier, view: v }, replace: true });

  const { data = [], isLoading } = useQuery({
    queryKey: ["opps"],
    queryFn: async () => {
      const { data } = await supabase.from("opportunities").select("*").order("last_activity_at", { ascending: false, nullsFirst: false });
      return (data ?? []) as unknown as OpportunityRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((o: any) => {
      if (stage !== "all" && o.stage !== stage) return false;
      if (tier !== "all" && o.tier !== tier) return false;
      if (!q) return true;
      return [o.project_name, o.client, o.main_contractor, o.location, o.sector]
        .filter(Boolean)
        .some((f: string) => f.toLowerCase().includes(q));
    });
  }, [data, search, stage, tier]);

  const open = data.filter((o) => !CLOSED.includes(o.stage));
  const openValue = open.reduce((s, o) => s + (o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min ?? 0), 0);
  const tierA = open.filter((o) => o.tier === "A").length;
  const winRate = (() => {
    const closed = data.filter((o) => CLOSED.includes(o.stage) && o.stage !== "archived");
    if (closed.length === 0) return 0;
    return Math.round((closed.filter((o) => o.stage === "won").length / closed.length) * 100);
  })();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={lang === "ar" ? "خط الأنابيب" : "Pipeline"}
        title={t("nav_opportunities")}
        description={lang === "ar" ? "كل الفرص، حالتها، ومالكها والقيمة التجارية." : "Every opportunity, its stage, owner, and commercial value."}
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={lang === "ar" ? "قيمة مفتوحة" : "Open value"} value={formatCurrency(openValue, lang)} hint={`${formatNumber(open.length, lang)} ${lang === "ar" ? "فرصة" : "opportunities"}`} />
        <KpiCard label={lang === "ar" ? "الطبقة أ" : "Tier A"} value={formatNumber(tierA, lang)} hint={lang === "ar" ? "أولوية عالية" : "High priority"} />
        <KpiCard label={lang === "ar" ? "معدل الفوز" : "Win rate"} value={`${winRate}%`} hint={lang === "ar" ? "المغلقة حتى الآن" : "Of closed to date"} />
        <KpiCard label={lang === "ar" ? "قيد التصفية" : "Showing"} value={formatNumber(filtered.length, lang)} hint={lang === "ar" ? "بعد الفلترة" : "After filters"} />
      </section>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-surface/60 p-2">
        <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
          <Search className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filter_search")}
            className="h-9 w-full rounded-md bg-transparent pe-3 ps-8 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="h-9 w-[180px] text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter_all_stages")}</SelectItem>
            {STAGES.map((s) => (
              <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger className="h-9 w-[140px] text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter_all_tiers")}</SelectItem>
            {(["A", "B", "C"] as const).map((x) => (
              <SelectItem key={x} value={x}>{t("label_tier")} {x}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ms-auto flex items-center gap-1 rounded-md border border-border/70 bg-background/40 p-0.5">
          <button
            onClick={() => setView("cards")}
            className={`grid h-7 w-7 place-items-center rounded transition-colors ${view === "cards" ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            aria-label="Card view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setView("table")}
            className={`grid h-7 w-7 place-items-center rounded transition-colors ${view === "table" ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            aria-label="Table view"
          >
            <Rows3 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : data.length === 0 ? (
        <EmptyState title={t("empty_opportunities")} description={t("empty_desc_opportunities")} />
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="no-results"
          title={t("empty_title_no_results")}
          description={t("empty_desc_no_results")}
          secondaryAction={{ label: t("empty_clear_filters"), onClick: () => { setSearch(""); setStage("all"); setTier("all"); } }}
        />
      ) : view === "cards" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((o) => <OpportunityCard key={o.id} o={o} lang={lang} />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          <div className="grid grid-cols-[minmax(0,2fr)_auto_auto_auto_auto_minmax(0,1fr)] items-center gap-3 border-b border-border/60 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <div>{lang === "ar" ? "المشروع" : "Project"}</div>
            <div>{lang === "ar" ? "الطبقة" : "Tier"}</div>
            <div>{t("score_label")}</div>
            <div>{lang === "ar" ? "المرحلة" : "Stage"}</div>
            <div className="text-right">{lang === "ar" ? "القيمة" : "Value"}</div>
            <div>{lang === "ar" ? "التالي" : "Next action"}</div>
          </div>
          <ul>
            {filtered.map((o) => (
              <li key={o.id} className="transition-colors hover:bg-surface-2/40">
                <Link
                  to="/opportunities/$id"
                  params={{ id: o.id }}
                  className="grid grid-cols-[minmax(0,2fr)_auto_auto_auto_auto_minmax(0,1fr)] items-center gap-3 border-t border-border/60 px-4 py-3 first:border-t-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-foreground">{o.project_name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{o.client ?? "—"}{o.main_contractor ? ` · ${o.main_contractor}` : ""}</div>
                  </div>
                  <StatusPill tone={o.tier === "A" ? "attention" : "neutral"}>{o.tier}</StatusPill>
                  {(o as any).score != null ? (
                    <StatusPill tone={(o as any).score_tier === "A" ? "positive" : (o as any).score_tier === "not_qualified" ? "danger" : "muted"}>
                      {(o as any).score}
                    </StatusPill>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">—</span>
                  )}
                  <StatusPill tone="muted">{humanize(o.stage)}</StatusPill>
                  <div className="num text-right text-[12px] font-medium text-foreground" data-tabular="true">
                    {formatCurrency(o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min, lang, o.currency)}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{o.next_action ?? "—"}</div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
