import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { DataField } from "@/components/phc/DataField";
import { StatusPill } from "@/components/phc/StatusPill";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonForm } from "@/components/phc/Skeleton";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { updateProject, verifyProject, type ProjectStage, type ProjectRow, type SourceConfidence } from "@/lib/crm-actions";
import { canApproveCommercialAction, canCreateSalesRecords, canEditTotalValue, isSystemAdmin } from "@/lib/roles";
import { EmailComposeButton } from "@/components/phc/EmailComposeButton";
import { getProjectCoverUrl, uploadProjectCover, validateProjectCoverFile } from "@/lib/project-cover-actions";
import { ProjectKanban } from "@/components/phc/ProjectKanban";
import { ProjectBudget } from "@/components/phc/ProjectBudget";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Project — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ProjectDetail,
});

const PROJECT_STAGES: ProjectStage[] = [
  "early_planning", "design_development", "tender", "awarded",
  "under_construction", "near_handover", "completed", "unknown",
];

const SOURCE_CONFIDENCE_LEVELS: SourceConfidence[] = ["high", "medium", "low"];

type CompanyRef = { id: string; name: string } | null;
type OpportunityRef = {
  id: string; project_name: string; stage: string;
  estimated_value_max: number | null; currency: string;
  // Phase 5 (system-redesign request): a project can have several
  // opportunities — one per competing contractor — each with its own
  // package/BOQ tracking, independent of the others. Surfaced here so this
  // page answers "how do we monitor variable package/BOQ per contractor for
  // this project" without opening every linked opportunity individually.
  main_contractor: CompanyRef;
  signage_package_status: string | null;
  boqs: { status: string }[];
};
type ProjectDetailRow = ProjectRow & {
  main_contractor: CompanyRef;
  owner_company: CompanyRef;
  consultant: CompanyRef;
  opportunities: OpportunityRef[];
};

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ProjectDetail() {
  const { id } = Route.useParams();
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<"overview" | "pipeline" | "budget" | "opportunities">("overview");
  const isManager = canApproveCommercialAction(roles);
  const canEditProject = canCreateSalesRecords(roles) || isSystemAdmin(roles);
  const canEditBudget = canEditTotalValue(roles);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: async () =>
      (
        await supabase
          .from("projects")
          .select(
            "*, main_contractor:companies!projects_main_contractor_id_fkey(id, name), owner_company:companies!projects_owner_company_id_fkey(id, name), consultant:companies!projects_consultant_id_fkey(id, name), opportunities:opportunities!opportunities_project_id_fkey(id, project_name, stage, estimated_value_max, currency, signage_package_status, main_contractor:companies!opportunities_main_contractor_id_fkey(id, name), boqs(status))",
          )
          .eq("id", id)
          .single()
      ).data as ProjectDetailRow | null,
  });

  const coverUrlQ = useQuery({
    queryKey: ["project-cover", id, project?.cover_image_path],
    queryFn: () => getProjectCoverUrl(project?.cover_image_path ?? null),
    enabled: !!project,
  });

  const [uploadingCover, setUploadingCover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCoverSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !project) return;
    const check = validateProjectCoverFile(file);
    if (!check.ok) {
      toast.error(
        check.reason === "file_too_large"
          ? (lang === "ar" ? "الصورة أكبر من 10 ميجابايت" : "Image is larger than 10MB")
          : (lang === "ar" ? "نوع الملف غير مسموح" : "File type not allowed"),
      );
      return;
    }
    setUploadingCover(true);
    try {
      await uploadProjectCover(project.id, file);
      toast.success(lang === "ar" ? "تم تحديث صورة الغلاف" : "Cover photo updated");
      qc.invalidateQueries({ queryKey: ["project", id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (lang === "ar" ? "فشل رفع الصورة" : "Upload failed"));
    } finally {
      setUploadingCover(false);
    }
  }

  if (isLoading) return <SkeletonForm />;
  if (!project) return <EmptyState message={t("crm_no_projects")} />;
  const p = project;
  const oppCount = p.opportunities?.length ?? 0;
  const oppValue = (p.opportunities ?? []).reduce(
    (s, o) => s + (o.estimated_value_max ?? 0),
    0,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("nav_projects")}
      </Link>

      {/* Cover photo */}
      <div className="group relative h-40 overflow-hidden rounded-xl border border-border/70 bg-surface sm:h-56">
        {coverUrlQ.data ? (
          <img src={coverUrlQ.data} alt={p.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface to-surface-2">
            <span className="text-xs text-muted-foreground">{lang === "ar" ? "لا توجد صورة غلاف" : "No cover photo"}</span>
          </div>
        )}
        {canEditProject ? (
          <>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleCoverSelected} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingCover}
              className="absolute bottom-3 end-3 inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground opacity-0 backdrop-blur transition-opacity hover:bg-background group-hover:opacity-100 disabled:opacity-100"
            >
              {uploadingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              {coverUrlQ.data ? (lang === "ar" ? "تغيير الصورة" : "Change photo") : (lang === "ar" ? "إضافة صورة" : "Add photo")}
            </button>
          </>
        ) : null}
      </div>

      <PageHeader
        eyebrow={humanize(p.project_stage)}
        title={p.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill tone={p.verification_status === "verified" ? "positive" : "attention"}>
              {p.verification_status === "verified" ? t("crm_verified") : t("crm_pending_verification")}
            </StatusPill>
            {p.project_number ? (
              <span className="num rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground" data-tabular="true">
                {p.project_number}
              </span>
            ) : null}
            {p.location ? <span className="text-xs text-muted-foreground">{p.location}</span> : null}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <button onClick={() => setEditOpen(true)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              {t("crm_edit")}
            </button>
            {isManager && p.verification_status !== "verified" ? (
              <button
                onClick={async () => {
                  try { await verifyProject(p.id); toast.success(t("crm_saved")); qc.invalidateQueries({ queryKey: ["project", id] }); }
                  catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                }}
                className="rounded-md border border-won/30 bg-won/10 px-3 py-1.5 text-xs text-won hover:bg-won/20"
              >
                {t("crm_verified")}
              </button>
            ) : null}
            <EmailComposeButton
              template="contractor_introduction"
              context={{
                recipientName: null,
                recipientEmail: null,
                companyName: p.main_contractor?.name ?? null,
                projectName: p.name,
              }}
              linked={{ type: "project", id: p.id, label: p.name, companyId: p.main_contractor?.id ?? null }}
            />
          </div>
        }
      />

      {/* Key facts strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("crm_completion")}</div>
          <div className="mt-2 num text-lg font-semibold text-foreground" data-tabular="true">
            {p.completion_pct != null ? `${p.completion_pct}%` : "—"}
          </div>
          {p.completion_pct != null ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-amber/70" style={{ width: `${Math.max(0, Math.min(100, p.completion_pct))}%` }} />
            </div>
          ) : null}
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("crm_total_value")}</div>
          <div className="mt-2 num text-lg font-semibold text-foreground" data-tabular="true">
            {formatCurrency(p.total_value, lang, p.currency)}
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("crm_linked_opportunities")}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="num text-lg font-semibold text-foreground" data-tabular="true">{oppCount}</span>
            {oppValue > 0 ? (
              <span className="num text-[11px] text-muted-foreground" data-tabular="true">
                {formatCurrency(oppValue, lang)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("crm_expected_boq")}</div>
          <div className="mt-2 num text-sm font-medium text-foreground" data-tabular="true">
            {p.expected_boq_date ?? "—"}
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("crm_expected_signage")}</div>
          <div className="mt-2 num text-sm font-medium text-foreground" data-tabular="true">
            {p.expected_signage_date ?? "—"}
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">{lang === "ar" ? "نظرة عامة" : "Overview"}</TabsTrigger>
          <TabsTrigger value="pipeline">{lang === "ar" ? "خط سير العمل" : "Job Pipeline"}</TabsTrigger>
          <TabsTrigger value="budget">{lang === "ar" ? "الميزانية" : "Budget"}</TabsTrigger>
          <TabsTrigger value="opportunities">{t("crm_linked_opportunities")} ({oppCount})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Panel title={t("nav_projects")}>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <DataField label={t("crm_location")} value={p.location} />
              <DataField label={t("crm_sector")} value={p.sector} />
              <DataField label={t("crm_main_contractor")} value={p.main_contractor ? <Link to="/accounts/$id" params={{ id: p.main_contractor.id }} className="hover:underline">{p.main_contractor.name}</Link> : null} />
              <DataField label={t("company_type_owner")} value={p.owner_company?.name} />
              <DataField label={t("company_type_consultant")} value={p.consultant?.name} />
              <DataField label={t("crm_signage_package")} value={humanize(p.signage_package_status)} />
              <DataField label={t("crm_source_confidence")} value={humanize(p.source_confidence)} />
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="pipeline">
          <Panel title={lang === "ar" ? "خط سير العمل" : "Job Pipeline"} subtitle={lang === "ar" ? "لوحة مرنة — أضف/عدّل/احذف المراحل والبطاقات كما تحتاج." : "A flexible board — add/edit/delete stages and cards as needed."}>
            <ProjectKanban projectId={p.id} canEdit={canEditProject} />
          </Panel>
        </TabsContent>

        <TabsContent value="budget">
          <Panel title={lang === "ar" ? "الميزانية" : "Budget"}>
            <ProjectBudget projectId={p.id} canEdit={canEditBudget} />
          </Panel>
        </TabsContent>

        <TabsContent value="opportunities">
          <Panel title={t("crm_linked_opportunities")} subtitle={String(oppCount)}>
            {(p.opportunities ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground">—</div>
            ) : (
              <>
              {oppCount > 1 ? (
                <p className="mb-3 text-xs text-muted-foreground">{t("crm_multi_contractor_hint")}</p>
              ) : null}
              <ul className="divide-y divide-border/60">
                {p.opportunities.map((o) => {
                  const boq = o.boqs?.[0];
                  return (
                    <li key={o.id} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <Link to="/opportunities/$id" params={{ id: o.id }} className="truncate text-sm text-foreground hover:underline">{o.project_name}</Link>
                        <div className="flex items-center gap-2">
                          <StatusPill tone="muted">{humanize(o.stage)}</StatusPill>
                          <span className="num text-xs text-muted-foreground" data-tabular="true">{formatCurrency(o.estimated_value_max, lang, o.currency)}</span>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>{o.main_contractor?.name ?? t("crm_no_contractor")}</span>
                        <span>·</span>
                        <StatusPill
                          tone={
                            o.signage_package_status === "confirmed" ? "positive"
                            : o.signage_package_status === "no_package_identified" ? "danger"
                            : "muted"
                          }
                        >
                          {t("crm_package")}: {humanize(o.signage_package_status)}
                        </StatusPill>
                        <StatusPill tone={boq?.status === "verified" ? "positive" : boq?.status === "missing" || !boq ? "danger" : "attention"}>
                          {t("crm_boq")}: {boq ? humanize(boq.status) : t("boq_status_missing" as never)}
                        </StatusPill>
                      </div>
                    </li>
                  );
                })}
              </ul>
              </>
            )}
          </Panel>
        </TabsContent>
      </Tabs>

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
          { key: "expectedSignageDate", type: "date", label: t("crm_expected_signage"), defaultValue: p.expected_signage_date ?? "" },
          { key: "sourceConfidence", type: "select", label: t("crm_source_confidence"), defaultValue: p.source_confidence, options: SOURCE_CONFIDENCE_LEVELS.map((c) => ({ value: c, label: humanize(c) })) },
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
              expected_signage_date: v.expectedSignageDate || null,
              source_confidence: v.sourceConfidence as SourceConfidence,
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
