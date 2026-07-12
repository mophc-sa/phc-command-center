import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { createProject, type ProjectStage } from "@/lib/crm-actions";

export const Route = createFileRoute("/_authenticated/projects")({
  head: () => ({ meta: [{ title: "Projects — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ProjectsPage,
});

const PROJECT_STAGES: ProjectStage[] = [
  "early_planning", "design_development", "tender", "awarded",
  "under_construction", "near_handover", "completed", "unknown",
];

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function stageTone(pct: number | null): "positive" | "attention" | "neutral" {
  if (pct == null) return "neutral";
  if (pct >= 50 && pct <= 95) return "attention";
  return "neutral";
}

function ProjectsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<ProjectStage | "all">("all");

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () =>
      (
        await supabase
          .from("projects")
          .select("*, main_contractor:companies!projects_main_contractor_id_fkey(id, name)")
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });

  const { data: contractors = [] } = useQuery({
    queryKey: ["companies-contractors"],
    queryFn: async () => (await supabase.from("companies").select("id, name").order("name")).data ?? [],
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .filter((p: any) => stageFilter === "all" || p.project_stage === stageFilter)
      .filter(
        (p: any) =>
          !q ||
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.location && p.location.toLowerCase().includes(q)) ||
          (p.main_contractor?.name && p.main_contractor.name.toLowerCase().includes(q)),
      );
  }, [projects, query, stageFilter]);

  const kpis = useMemo(() => {
    const uc = projects.filter((p: any) => p.project_stage === "under_construction").length;
    const near = projects.filter((p: any) => p.project_stage === "near_handover").length;
    const totalValue = projects.reduce((s: number, p: any) => s + (p.total_value ?? 0), 0);
    return { total: projects.length, uc, near, totalValue };
  }, [projects]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={t("nav_crm" as never) || "CRM"}
        title={t("nav_projects")}
        actions={
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("crm_new_project")}
          </button>
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
            className={`rounded-full border px-3 py-1 text-xs ${stageFilter === "all" ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {t("crm_filter_all_types")}
          </button>
          {PROJECT_STAGES.map((s) => (
            <button
              key={s}
              onClick={() => setStageFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs ${stageFilter === s ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {humanize(s)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("crm_no_projects")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((p: any) => (
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
                <StatusPill tone={stageTone(p.completion_pct)}>{humanize(p.project_stage)}</StatusPill>
              </div>
              <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
                {p.completion_pct != null ? (
                  <span className="num" data-tabular="true">{t("crm_completion")}: {p.completion_pct}%</span>
                ) : null}
                {p.total_value != null ? (
                  <span className="num" data-tabular="true">{formatCurrency(p.total_value, lang, p.currency)}</span>
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
      )}

      <ActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("crm_new_project")}
        description={t("crm_pending_verification")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "name", type: "text", label: t("nav_projects"), required: true },
          { key: "location", type: "text", label: t("crm_location") },
          { key: "sector", type: "text", label: t("crm_sector") },
          { key: "mainContractorId", type: "select", label: t("crm_main_contractor"), options: [{ value: "", label: "—" }, ...contractors.map((c: any) => ({ value: c.id, label: c.name }))] },
          { key: "projectStage", type: "select", label: t("crm_project_stage"), defaultValue: "unknown", options: PROJECT_STAGES.map((s) => ({ value: s, label: humanize(s) })) },
          { key: "completionPct", type: "text", label: t("crm_completion") },
          { key: "totalValue", type: "text", label: t("crm_total_value") },
          { key: "expectedBoqDate", type: "date", label: t("crm_expected_boq") },
        ]}
        onSubmit={async (v) => {
          try {
            await createProject({
              name: v.name,
              location: v.location || undefined,
              sector: v.sector || undefined,
              mainContractorId: v.mainContractorId || null,
              projectStage: v.projectStage as ProjectStage,
              completionPct: v.completionPct ? Number(v.completionPct) : null,
              totalValue: v.totalValue ? Number(v.totalValue) : null,
              expectedBoqDate: v.expectedBoqDate || null,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["projects"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
