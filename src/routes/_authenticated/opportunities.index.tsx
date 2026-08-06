import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { IntakeHubTabs } from "@/components/phc/IntakeHubTabs";

export const Route = createFileRoute("/_authenticated/opportunities/")({
  validateSearch: (s: Record<string, unknown>) => ({
    q:     typeof s.q === "string" ? s.q : "",
    stage: typeof s.stage === "string" ? s.stage : "all",
    tier:  typeof s.tier === "string" ? s.tier : "all",
    view:  s.view === "cards" ? "cards" as const : "table" as const,
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

// The filter offers the real PHC pipeline, not the generic CRM buckets. It used
// to list discovery/qualification/preparation/... — stages a salesperson never
// sees anywhere else in the app, and which no longer matched what the rows show.
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
    const q = search.trim().toLowerCase();
    const rows = data.filter((o: any) => {
      if (stage !== "all" && resolveCanonicalStage(o).stage !== stage) return false;
      if (tier !== "all" && o.tier !== tier) return false;
      if (!q) return true;
      return [o.project_name, o.client, o.main_contractor, o.location, o.sector]
        .filter(Boolean)
        .some((f: string) => f.toLowerCase().includes(q));
    });
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
  }, [data, search, stage, tier, sort]);

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
      <IntakeHubTabs active="opportunities" />
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
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="h-9 w-full sm:w-[180px] text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter_all_stages")}</SelectItem>
            {CANONICAL_STAGES.map((s) => (
              <SelectItem key={s} value={s}>{t(canonicalStageLabelKey(s))}</SelectItem>
            ))}
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
