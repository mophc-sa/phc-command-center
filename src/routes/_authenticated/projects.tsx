import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
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

// Highest attention when the project is close to handover — this is when the
// signage package is decided (Sales OS section 6.5 project-stage guidance).
function stageTone(pct: number | null): "positive" | "attention" | "neutral" {
  if (pct == null) return "neutral";
  if (pct >= 50 && pct <= 95) return "attention";
  return "neutral";
}

function ProjectsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

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

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title={t("nav_projects")}
        count={projects.length}
        action={
          <button onClick={() => setCreateOpen(true)} className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20">
            {t("crm_new_project")}
          </button>
        }
      />

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : projects.length === 0 ? (
        <EmptyState message={t("crm_no_projects")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((p: any) => (
            <Link key={p.id} to="/projects/$id" params={{ id: p.id }} className="rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-amber/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {p.main_contractor?.name ?? "—"}{p.location ? ` · ${p.location}` : ""}
                  </div>
                </div>
                <StatusPill tone={stageTone(p.completion_pct)}>{humanize(p.project_stage)}</StatusPill>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                {p.completion_pct != null ? <span>{t("crm_completion")}: {p.completion_pct}%</span> : null}
                {p.total_value != null ? <span className="num" data-tabular="true">{formatCurrency(p.total_value, lang, p.currency)}</span> : null}
              </div>
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
