import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Plus, Search, Layers, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatCurrency } from "@/lib/i18n";
import type { ProjectStage, ProjectRow } from "@/lib/crm-actions";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ProjectsPage,
});

const PROJECT_STAGES: ProjectStage[] = [
  "early_planning", "design_development", "tender", "awarded",
  "under_construction", "near_handover", "completed", "unknown",
];

const PAGE_SIZE = 20;

type ProjectListRow = ProjectRow & { main_contractor: { id: string; name: string } | null };

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function stageTone(pct: number | null): "positive" | "attention" | "neutral" {
  if (pct == null) return "neutral";
  if (pct >= 50 && pct <= 95) return "attention";
  return "neutral";
}

// PostgREST .or() uses "," to separate conditions — strip it (and parens,
// used for grouping) from user input so a stray character can't break the
// filter syntax or smuggle in an unintended condition.
function sanitizeForOrFilter(q: string) {
  return q.replace(/[(),]/g, "");
}

function ProjectsPage() {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<ProjectStage | "all">("all");
  const [page, setPage] = useState(0);

  // Debounce the search box so we don't fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // A filter change should always land back on page 1.
  useEffect(() => {
    setPage(0);
  }, [debouncedQuery, stageFilter]);

  const { data: listResult, isLoading } = useQuery({
    queryKey: ["projects", { page, debouncedQuery, stageFilter }],
    queryFn: async () => {
      let q = supabase
        .from("projects")
        .select("*, main_contractor:companies!projects_main_contractor_id_fkey(id, name)", { count: "exact" })
        .order("updated_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (stageFilter !== "all") q = q.eq("project_stage", stageFilter);
      const cleaned = sanitizeForOrFilter(debouncedQuery);
      if (cleaned) q = q.or(`name.ilike.%${cleaned}%,location.ilike.%${cleaned}%`);

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as ProjectListRow[], count: count ?? 0 };
    },
    placeholderData: keepPreviousData,
  });

  const projects = listResult?.rows ?? [];
  const totalCount = listResult?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Global counts/totals must reflect every project, not just the current
  // page — a lightweight, joinless query keeps that cheap even though the
  // list above is now paginated.
  const { data: kpiRows = [] } = useQuery({
    queryKey: ["projects-kpi"],
    queryFn: async () =>
      (await supabase.from("projects").select("project_stage, total_value")).data ?? [],
  });

  const kpis = useMemo(() => {
    const uc = kpiRows.filter((p) => p.project_stage === "under_construction").length;
    const near = kpiRows.filter((p) => p.project_stage === "near_handover").length;
    const totalValue = kpiRows.reduce((s, p) => s + (p.total_value ?? 0), 0);
    return { total: kpiRows.length, uc, near, totalValue };
  }, [kpiRows]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={t("navgroup_production")}
        title={t("nav_projects")}
        actions={
          <Link
            to="/lead-tender-inbox"
            className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("ibx_new_item")}
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t("nav_projects")} value={kpis.total} icon={<Layers className="h-3.5 w-3.5" />} />
        <KpiCard label={humanize("under_construction")} value={kpis.uc} />
        <KpiCard label={humanize("near_handover")} value={kpis.near} hint={t("crm_signage_package" as never) || undefined} />
        <KpiCard label={t("crm_total_value")} value={formatCurrency(kpis.totalValue, lang)} />
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("crm_search_projects" as never) || "Search projects"}
            className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setStageFilter("all")}
            className={`rounded-full border px-3 py-1.5 text-xs ${stageFilter === "all" ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {t("crm_filter_all_types")}
          </button>
          {PROJECT_STAGES.map((s) => (
            <button
              key={s}
              onClick={() => setStageFilter(s)}
              className={`rounded-full border px-3 py-1.5 text-xs ${stageFilter === s ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {humanize(s)}
            </button>
          ))}
        </div>
      </div>

      {isLoading && !listResult ? (
        <SkeletonTable rows={6} />
      ) : projects.length === 0 ? (
        <EmptyState message={t("crm_no_projects")} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {projects.map((p) => (
              <Link
                key={p.id}
                to="/projects/$id"
                params={{ id: p.id }}
                className="rounded-xl border border-border/70 bg-surface/60 px-5 py-4 transition-colors hover:border-border-strong/70 hover:bg-surface"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {p.main_contractor?.name ?? "—"}{p.location ? ` · ${p.location}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill tone={stageTone(p.completion_pct)}>{humanize(p.project_stage)}</StatusPill>
                    <StatusPill tone={p.verification_status === "verified" ? "positive" : "attention"}>
                      {p.verification_status === "verified" ? t("crm_verified") : t("crm_pending_verification")}
                    </StatusPill>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  {p.completion_pct != null ? (
                    <span className="num" data-tabular="true">{t("crm_completion")}: {p.completion_pct}%</span>
                  ) : null}
                  {p.total_value != null ? (
                    <span className="num" data-tabular="true">{formatCurrency(p.total_value, lang, p.currency)}</span>
                  ) : null}
                  {p.signage_package_status ? (
                    <span>{t("crm_signage_package")}: {humanize(p.signage_package_status)}</span>
                  ) : null}
                  {p.source_confidence ? (
                    <span>{t("crm_source_confidence")}: {humanize(p.source_confidence)}</span>
                  ) : null}
                </div>
                {p.completion_pct != null ? (
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-amber/70" style={{ width: `${Math.max(0, Math.min(100, p.completion_pct))}%` }} />
                  </div>
                ) : null}
              </Link>
            ))}
          </div>

          {totalPages > 1 ? (
            <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
              <span className="num" data-tabular="true">
                {t("crm_page_of")} {page + 1} / {totalPages} · {totalCount}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 disabled:opacity-40 hover:text-foreground disabled:hover:text-muted-foreground"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 disabled:opacity-40 hover:text-foreground disabled:hover:text-muted-foreground"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
