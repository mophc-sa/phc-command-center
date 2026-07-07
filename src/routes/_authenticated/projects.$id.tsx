import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/phc/Panel";
import { DataField } from "@/components/phc/DataField";
import { StatusPill } from "@/components/phc/StatusPill";
import { EmptyState } from "@/components/phc/EmptyState";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { updateProject, type ProjectStage } from "@/lib/crm-actions";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Project — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ProjectDetail,
});

const PROJECT_STAGES: ProjectStage[] = [
  "early_planning", "design_development", "tender", "awarded",
  "under_construction", "near_handover", "completed", "unknown",
];

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ProjectDetail() {
  const { id } = Route.useParams();
  const { t, lang } = useI18n();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const isManager = hasAnyRole(["ceo", "sales_manager"]);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: async () =>
      (
        await supabase
          .from("projects")
          .select(
            "*, main_contractor:companies!projects_main_contractor_id_fkey(id, name), owner_company:companies!projects_owner_company_id_fkey(id, name), consultant:companies!projects_consultant_id_fkey(id, name), opportunities:opportunities!opportunities_project_id_fkey(id, project_name, stage, estimated_value_max, currency)",
          )
          .eq("id", id)
          .single()
      ).data,
  });

  if (isLoading) return <EmptyState message={t("loading")} />;
  if (!project) return <EmptyState message={t("crm_no_projects")} />;
  const p: any = project;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> {t("nav_projects")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{p.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusPill tone="muted">{humanize(p.project_stage)}</StatusPill>
            <StatusPill tone={p.verification_status === "verified" ? "positive" : "attention"}>
              {p.verification_status === "verified" ? t("crm_verified") : t("crm_pending_verification")}
            </StatusPill>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditOpen(true)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            {t("crm_edit")}
          </button>
          {isManager && p.verification_status !== "verified" ? (
            <button
              onClick={async () => {
                try { await updateProject(p.id, { verification_status: "verified" }); toast.success(t("crm_saved")); qc.invalidateQueries({ queryKey: ["project", id] }); }
                catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
              }}
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20"
            >
              {t("crm_verified")}
            </button>
          ) : null}
        </div>
      </div>

      <Panel title={t("nav_projects")}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <DataField label={t("crm_location")} value={p.location} />
          <DataField label={t("crm_sector")} value={p.sector} />
          <DataField label={t("crm_completion")} value={p.completion_pct != null ? `${p.completion_pct}%` : null} mono />
          <DataField label={t("crm_total_value")} value={formatCurrency(p.total_value, lang, p.currency)} mono />
          <DataField label={t("crm_main_contractor")} value={p.main_contractor ? <Link to="/accounts/$id" params={{ id: p.main_contractor.id }} className="hover:underline">{p.main_contractor.name}</Link> : null} />
          <DataField label={t("company_type_owner")} value={p.owner_company?.name} />
          <DataField label={t("company_type_consultant")} value={p.consultant?.name} />
          <DataField label={t("crm_signage_package")} value={humanize(p.signage_package_status)} />
          <DataField label={t("crm_expected_boq")} value={p.expected_boq_date} />
        </div>
      </Panel>

      <Panel title={t("crm_linked_opportunities")} subtitle={String(p.opportunities?.length ?? 0)}>
        {(p.opportunities ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">—</div>
        ) : (
          <ul className="space-y-2">
            {p.opportunities.map((o: any) => (
              <li key={o.id} className="flex items-center justify-between gap-2">
                <Link to="/opportunities/$id" params={{ id: o.id }} className="truncate text-sm text-foreground hover:underline">{o.project_name}</Link>
                <div className="flex items-center gap-2">
                  <StatusPill tone="muted">{humanize(o.stage)}</StatusPill>
                  <span className="num text-xs text-muted-foreground" data-tabular="true">{formatCurrency(o.estimated_value_max, lang, o.currency)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ActionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title={t("crm_edit")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "name", type: "text", label: t("nav_projects"), required: true, defaultValue: p.name },
          { key: "location", type: "text", label: t("crm_location"), defaultValue: p.location ?? "" },
          { key: "sector", type: "text", label: t("crm_sector"), defaultValue: p.sector ?? "" },
          { key: "projectStage", type: "select", label: t("crm_project_stage"), defaultValue: p.project_stage, options: PROJECT_STAGES.map((s) => ({ value: s, label: humanize(s) })) },
          { key: "completionPct", type: "text", label: t("crm_completion"), defaultValue: p.completion_pct != null ? String(p.completion_pct) : "" },
          { key: "totalValue", type: "text", label: t("crm_total_value"), defaultValue: p.total_value != null ? String(p.total_value) : "" },
          { key: "expectedBoqDate", type: "date", label: t("crm_expected_boq"), defaultValue: p.expected_boq_date ?? "" },
        ]}
        onSubmit={async (v) => {
          try {
            await updateProject(p.id, {
              name: v.name,
              location: v.location || null,
              sector: v.sector || null,
              project_stage: v.projectStage as ProjectStage,
              completion_pct: v.completionPct ? Number(v.completionPct) : null,
              total_value: v.totalValue ? Number(v.totalValue) : null,
              expected_boq_date: v.expectedBoqDate || null,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["project", id] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
