import { createFileRoute, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, LayoutGrid, Rows3, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveCanonicalStage,
  CANONICAL_ACTIVE_STAGES,
  CANONICAL_STAGES,
  canonicalStageLabelKey,
} from "@/lib/stage-canonical";
import type { OpportunitySearch } from "@/lib/drilldown";
import {
  DEFAULT_SEARCH,
  describeFilters,
  hasActiveFilters,
  matchesOpportunitySearch,
  parseOpportunitySearch,
} from "@/lib/drilldown";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { humanize } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/opportunities/")({
  // Phase 5: parsed by the shared drilldown contract so a KPI link and this
  // page cannot disagree about what a filter means. `owner`, `from` and `to`
  // were added because a KPI scoped by salesperson or period has nowhere to put
  // that context otherwise.
  //
  // `SearchSchemaInput` splits the two directions apart: links may pass any
  // subset (the many existing <Link to="/opportunities"> callers send only the
  // original four), while `useSearch()` gets the parser's complete, defaulted
  // object back. Declaring owner/from/to optional on the OUTPUT — the previous
  // shape — was what pushed the page into `routeSearch.owner && ...` guards
  // and let them drift out of the filter's dependency array.
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput): OpportunitySearch =>
    parseOpportunitySearch(s),
  head: () => ({
    meta: [
      { title: "Opportunities — PHC" },
      { name: "description", content: "Every active opportunity, its stage, owner, next action and commercial value." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OppList,
});

// The filter offers the real PHC pipeline, not the generic CRM buckets. It used
// to list discovery/qualification/preparation/... — stages a salesperson never
// sees anywhere else in the app, and which no longer matched what the rows show.

// The stage groups a drilldown can arrive with, in the order they read.
const STAGE_GROUP_FILTERS = ["open", "late_stage", "closed"] as const;

/** One label for a stage filter, whether it names a group or a single stage. */
function stageFilterLabel(stage: string, t: (k: string) => string): string {
  return (STAGE_GROUP_FILTERS as readonly string[]).includes(stage)
    ? t(`filter_stage_${stage}`)
    : t(canonicalStageLabelKey(stage as (typeof CANONICAL_STAGES)[number]));
}

function OppList() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const routeSearch = Route.useSearch();
  const { q: search, stage, tier, view } = routeSearch;

  // Every setter spreads the current search, so changing one filter never
  // silently drops the owner or date range a drilldown arrived with.
  const patch = (next: Partial<ReturnType<typeof parseOpportunitySearch>>) =>
    navigate({ to: ".", search: { ...routeSearch, ...next }, replace: true });
  const setSearch = (v: string) => patch({ q: v });
  const setStage  = (v: string) => patch({ stage: v });
  const setTier   = (v: string) => patch({ tier: v });
  const setView   = (v: "cards" | "cards" | "table") => patch({ view: v as "cards" | "table" });

  // Resets every field, not just the three with controls on this page. A
  // drilldown can arrive carrying an owner and a date range that have no
  // visible control, so clearing only q/stage/tier left the list narrowed by
  // filters the user could neither see nor remove.
  const clearFilters = () =>
    navigate({ to: ".", search: { ...DEFAULT_SEARCH, view }, replace: true });

  const { data = [], isLoading } = useQuery({
    queryKey: ["opps"],
    queryFn: async () => {
      const { data } = await supabase
        .from("opportunities")
        .select(
          "*, company:companies!opportunities_company_id_fkey(id, name), rfqs(classification, rfq_number, created_at), quotations(status, value, issued_date, created_at)",
        )
        .order("last_activity_at", { ascending: false, nullsFirst: false });
      return (data ?? []) as unknown as OpportunityRow[];
    },
  });

  type SortKey = "classification" | "sales_code" | "project_name" | "amount" | "quotation_status" | "submission_date" | "client_company";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const latestRfq = (o: any) =>
    [...(o.rfqs ?? [])].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0] ?? null;
  const latestQuotation = (o: any) =>
    [...(o.quotations ?? [])].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0] ?? null;

  const filtered = useMemo(() => {
    // One shared predicate with the KPI engine, so "open" here means exactly
    // what "open" meant in the number that linked here — and so the owner and
    // period a drilldown arrives with cannot be quietly ignored.
    const rows = data.filter((o: any) => matchesOpportunitySearch(o, routeSearch));
    if (!sort) return rows;
    const sortValue = (o: any): string | number => {
      const rfq = latestRfq(o);
      const quote = latestQuotation(o);
      switch (sort.key) {
        case "classification": return rfq?.classification ?? "";
        case "sales_code": return rfq?.rfq_number ?? "";
        case "project_name": return o.project_name ?? "";
        case "amount": return quote?.value ?? o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min ?? 0;
        case "quotation_status": return quote?.status ?? "";
        case "submission_date": return quote?.issued_date ?? "";
        case "client_company": return o.company?.name ?? o.client ?? "";
      }
    };
    const sorted = [...rows].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, routeSearch, sort]);

  // Canonical stage. `stage` and `sales_stage` only agree at won/lost, so the
  // KPI strip on this page could disagree with My Workspace for the same deal.
  const canonical = (o: any) => resolveCanonicalStage(o).stage;
  const open = data.filter((o) => {
    const s = canonical(o);
    return s !== null && (CANONICAL_ACTIVE_STAGES as readonly string[]).includes(s);
  });
  const openValue = open.reduce((s, o) => s + (o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min ?? 0), 0);
  const tierA = open.filter((o) => o.tier === "A").length;
  const winRate = (() => {
    const closed = data.filter((o) => {
      const s = canonical(o);
      return s === "won" || s === "lost";
    });
    if (closed.length === 0) return 0;
    return Math.round((closed.filter((o) => canonical(o) === "won").length / closed.length) * 100);
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
        <div className="relative min-w-0 w-full flex-1 sm:max-w-sm">
          <Search className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filter_search")}
            className="h-9 w-full rounded-md bg-transparent pe-3 ps-8 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        {/* The groups belong here, not only the individual stages. A KPI is
            usually defined over a SET of stages — "open pipeline", "late
            stage", "closed" — and that is what its drilldown puts in the URL.
            With only `all` + CANONICAL_STAGES as options, arriving from one of
            those numbers left this control rendering BLANK, because Radix has
            no item matching the value. Four of the eight KPI drilldowns do
            exactly that. */}
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="h-9 w-full sm:w-[180px] text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter_all_stages")}</SelectItem>
            <SelectSeparator />
            {/* Radix requires SelectLabel to sit inside a SelectGroup — outside
                one it throws and takes the whole page to the error boundary. */}
            <SelectGroup>
              <SelectLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("filter_group_heading" as never)}
              </SelectLabel>
              {STAGE_GROUP_FILTERS.map((g) => (
                <SelectItem key={g} value={g}>{t(`filter_stage_${g}` as never)}</SelectItem>
              ))}
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("filter_stage_heading" as never)}
              </SelectLabel>
              {CANONICAL_STAGES.map((s) => (
                <SelectItem key={s} value={s}>{t(canonicalStageLabelKey(s))}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger className="h-9 w-full sm:w-[140px] text-[12px]"><SelectValue /></SelectTrigger>
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

      {/* A drilldown can scope this list by owner and by period — neither of
          which has a control in the toolbar above. Without this the list just
          looked short, with no way to tell why. describeFilters/hasActiveFilters
          were already imported for exactly this and had never been rendered. */}
      {hasActiveFilters(routeSearch) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-surface/40 px-3 py-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("filter_chip_filtered_by" as never)}
          </span>
          {describeFilters(routeSearch).map((chip) => (
            <span
              key={chip.kind}
              className="rounded-full border border-border/70 bg-background/50 px-2 py-0.5 text-[11px] text-foreground"
            >
              {chip.kind === "stage"
                ? `${t("filter_chip_stage" as never)}: ${stageFilterLabel(chip.stage, t as (k: string) => string)}`
                : chip.kind === "tier"
                  ? `${t("filter_chip_tier" as never)} ${chip.tier}`
                  : chip.kind === "owner"
                    ? t("filter_chip_owner" as never)
                    : chip.kind === "period"
                      ? `${chip.from} → ${chip.to}`
                      : `${t("filter_chip_search" as never)}: “${chip.q}”`}
            </span>
          ))}
          <button
            onClick={clearFilters}
            className="ms-auto text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t("empty_clear_filters")}
          </button>
        </div>
      )}

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : data.length === 0 ? (
        <EmptyState title={t("empty_opportunities")} description={t("empty_desc_opportunities")} />
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="no-results"
          title={t("empty_title_no_results")}
          description={t("empty_desc_no_results")}
          secondaryAction={{ label: t("empty_clear_filters"), onClick: clearFilters }}
        />
      ) : view === "cards" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((o) => <OpportunityCard key={o.id} o={o} lang={lang} />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          <div className="overflow-x-auto">
          <div className="min-w-[900px] grid grid-cols-[90px_130px_minmax(0,2fr)_130px_150px_110px_minmax(0,1.2fr)] items-center gap-3 border-b border-border/60 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <SortHeader label={lang === "ar" ? "JIH / منافسة" : "JIH / Tender"} active={sort?.key === "classification"} dir={sort?.dir} onClick={() => toggleSort("classification")} />
            <SortHeader label={lang === "ar" ? "كود المبيعات" : "Sales Code"} active={sort?.key === "sales_code"} dir={sort?.dir} onClick={() => toggleSort("sales_code")} />
            <SortHeader label={lang === "ar" ? "اسم المشروع" : "Project Name"} active={sort?.key === "project_name"} dir={sort?.dir} onClick={() => toggleSort("project_name")} />
            <SortHeader label={lang === "ar" ? "القيمة" : "Amount"} active={sort?.key === "amount"} dir={sort?.dir} onClick={() => toggleSort("amount")} className="justify-end text-right" />
            <SortHeader label={lang === "ar" ? "حالة العرض" : "Quotation Status"} active={sort?.key === "quotation_status"} dir={sort?.dir} onClick={() => toggleSort("quotation_status")} />
            <SortHeader label={lang === "ar" ? "تاريخ التقديم" : "Submission Date"} active={sort?.key === "submission_date"} dir={sort?.dir} onClick={() => toggleSort("submission_date")} />
            <SortHeader label={lang === "ar" ? "شركة العميل" : "Client Company"} active={sort?.key === "client_company"} dir={sort?.dir} onClick={() => toggleSort("client_company")} />
          </div>
          <ul>
            {filtered.map((o: any) => {
              const rfq = latestRfq(o);
              const quote = latestQuotation(o);
              const amount = quote?.value ?? o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min;
              return (
                <li key={o.id} className="transition-colors hover:bg-surface-2/40">
                  <Link
                    to="/opportunities/$id"
                    params={{ id: o.id }}
                    className="min-w-[900px] grid grid-cols-[90px_130px_minmax(0,2fr)_130px_150px_110px_minmax(0,1.2fr)] items-center gap-3 border-t border-border/60 px-4 py-3 first:border-t-0"
                  >
                    {rfq?.classification ? (
                      <StatusPill tone={rfq.classification === "tender" ? "attention" : "muted"}>
                        {rfq.classification === "jih" ? "JIH" : humanize(rfq.classification)}
                      </StatusPill>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                    <div className="truncate text-[12px] text-foreground" data-tabular="true">{rfq?.rfq_number ?? "—"}</div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-foreground">{o.project_name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{o.location ?? "—"}</div>
                    </div>
                    <div className="num text-right text-[12px] font-medium text-foreground" data-tabular="true">
                      {formatCurrency(amount, lang, o.currency)}
                    </div>
                    {quote?.status ? (
                      <StatusPill tone={quote.status === "won" ? "positive" : quote.status === "lost" || quote.status === "expired" ? "danger" : "muted"}>
                        {humanize(quote.status)}
                      </StatusPill>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                    <div className="truncate text-[11px] text-muted-foreground" data-tabular="true">
                      {quote?.issued_date ? new Date(quote.issued_date).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US") : "—"}
                    </div>
                    <div className="truncate text-[12px] text-foreground">{o.company?.name ?? o.client ?? "—"}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active?: boolean;
  dir?: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 text-start transition-colors hover:text-foreground ${active ? "text-foreground" : ""} ${className ?? ""}`}
    >
      {label}
      {active ? (
        dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}
