import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Gavel, AlertTriangle, Trophy, GitMerge, Eye, Pencil, UserCog, CalendarPlus, FileUp, BadgeCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canManageSalesPipeline, canApproveCommercialAction } from "@/lib/roles";
import { listTeamMembers } from "@/lib/opportunity-actions";
import {
  createTender, advanceTenderStage, requestTenderConversion, approveTenderConversion, nextTenderStages,
  updateTender, assignTenderOwner, setTenderFollowUp, setTenderWatchlist, addTenderEvidence,
  tenderConversionReadiness,
  TENDER_STAGES, type TenderStage,
} from "@/lib/tender-actions";
import { EmailComposeButton } from "@/components/phc/EmailComposeButton";

export const Route = createFileRoute("/_authenticated/tenders")({
  head: () => ({ meta: [{ title: "Tender Monitor — PHC" }, { name: "robots", content: "noindex" }] }),
  component: TenderMonitor,
});

// A board column is either a raw tender_stage or one of two derived,
// cross-cutting buckets that are NOT stages and NOT stored on tender_stage:
//  - "conversion_review": awarded_to_contractor + a pending TENDER_TO_JIH_APPROVAL
//  - "watchlist": is_watchlisted = true (pulls the card out of its normal
//    stage column into a dedicated attention lane, regardless of stage)
// Tender A/B/C classification (tender_priority_classification) is never a
// column — it only ever appears as a badge on the card.
type BoardColumn = TenderStage | "conversion_review" | "watchlist";

const BOARD_COLUMNS: BoardColumn[] = [
  "tender_identified",
  "tender_under_process",
  "award_negotiation",
  "awarded_to_contractor",
  "conversion_review",
  "converted_to_jih",
  "watchlist",
  "tender_lost_or_archived",
];

function columnLabel(col: BoardColumn, t: (k: string) => string): string {
  if (col === "conversion_review") return t("conv_review_title");
  if (col === "watchlist") return t("tb_watchlist");
  return t(`tstage_${col}`);
}

function columnFor(x: any, pendingConversionIds: Set<string>): BoardColumn {
  if (x.tender_stage === "tender_lost_or_archived") return "tender_lost_or_archived";
  if (x.is_watchlisted) return "watchlist";
  if (x.tender_stage === "awarded_to_contractor" && pendingConversionIds.has(x.id)) return "conversion_review";
  return x.tender_stage as BoardColumn;
}

function stageTone(s: BoardColumn): "positive" | "attention" | "danger" | "muted" | "neutral" {
  if (s === "converted_to_jih") return "positive";
  if (s === "tender_lost_or_archived") return "danger";
  if (s === "watchlist") return "attention";
  if (s === "conversion_review" || s === "awarded_to_contractor") return "attention";
  return "neutral";
}

function fieldsForTenderStage(t: string, tt: (k: string) => string, contractors: any[]): DialogField[] {
  if (t === "awarded_to_contractor") {
    return [
      { key: "main_contractor_id", type: "select", label: tt("wf_contractor"), required: true, options: contractors.map((c: any) => ({ value: c.id, label: c.name })) },
      { key: "award_evidence", type: "textarea", label: tt("wf_evidence"), required: true },
    ];
  }
  if (t === "tender_lost_or_archived") {
    return [{ key: "archive_reason", type: "textarea", label: tt("wf_loss_reason"), required: true }];
  }
  return [{ key: "notes", type: "textarea", label: tt("wf_notes") }];
}

// The PHC Tender Conversion Review — the questions that gate RFQ/Tender -> JIH.
function conversionReviewFields(tt: (k: string) => string, tender: any): DialogField[] {
  const yn = [
    { value: "yes", label: tt("conv_yes") },
    { value: "no", label: tt("conv_no") },
  ];
  return [
    { key: "project_stage_suitable", type: "select", label: tt("conv_stage_suitable"), required: true, options: yn },
    { key: "package_not_closed", type: "select", label: tt("conv_package_open"), required: true, options: yn },
    {
      key: "estimated_signage_value",
      type: "text",
      label: tt("conv_signage_value"),
      required: true,
      defaultValue: tender?.estimated_signage_value ?? tender?.estimated_project_value ?? "",
    },
    { key: "contact_plan_ready", type: "select", label: tt("conv_contact_plan"), required: true, options: yn },
    {
      key: "main_contractor_confirmed",
      type: "select",
      label: tt("conv_contractor_confirmed"),
      required: true,
      defaultValue: tender?.main_contractor_id ? "yes" : "",
      options: yn,
    },
    {
      key: "signage_package_status",
      type: "select",
      label: tt("conv_package_status"),
      required: true,
      options: [
        { value: "confirmed", label: "Confirmed / open" },
        { value: "likely", label: "Likely" },
        { value: "unknown", label: "Unknown" },
        { value: "no_package_identified", label: "No package" },
      ],
    },
    {
      key: "signage_package_confidence",
      type: "select",
      label: tt("conv_package_confidence"),
      required: true,
      defaultValue: tender?.signage_potential ?? "",
      options: [
        { value: "high", label: "High" },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
    },
    { key: "conversion_reason", type: "textarea", label: tt("conv_reason"), required: true },
  ];
}

function editTenderFields(tt: (k: string) => string, projects: any[], tender: any): DialogField[] {
  return [
    { key: "tenderName", type: "text", label: tt("nav_tenders"), required: true, defaultValue: tender?.tender_name ?? "" },
    { key: "source", type: "text", label: tt("wf_source"), defaultValue: tender?.source ?? "" },
    { key: "projectId", type: "select", label: tt("nav_projects"), defaultValue: tender?.project_id ?? "", options: [{ value: "", label: "—" }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))] },
    { key: "classification", type: "select", label: tt("wf_classification"), defaultValue: tender?.tender_priority_classification ?? "", options: [{ value: "", label: "—" }, { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }] },
    { key: "expectedAwardDate", type: "date", label: tt("wf_expected_award"), defaultValue: tender?.expected_award_date ?? "" },
    { key: "estimatedProjectValue", type: "text", label: tt("crm_total_value"), defaultValue: tender?.estimated_project_value != null ? String(tender.estimated_project_value) : "" },
    { key: "signagePotential", type: "select", label: tt("crm_signage_package"), defaultValue: tender?.signage_potential ?? "", options: [{ value: "", label: "—" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }] },
  ];
}

function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.round((dt.getTime() - Date.now()) / 86400000);
}

function nextActionHint(x: any, lang: "en" | "ar"): string {
  const map: Record<string, [string, string]> = {
    tender_identified: ["Verify and move to Under Process", "التحقق والانتقال لقيد الإجراء"],
    tender_under_process: ["Confirm main contractor & submit", "تأكيد المقاول الرئيسي والتقديم"],
    award_negotiation: ["Finalize award terms", "إنهاء شروط الترسية"],
    awarded_to_contractor: ["Start conversion review", "بدء مراجعة التحويل"],
    converted_to_jih: ["Now tracked as a JIH opportunity", "تُتابع الآن كفرصة قائمة"],
    tender_lost_or_archived: ["Archived — no action", "مؤرشفة — لا إجراء"],
  };
  const pair = map[x.tender_stage];
  return pair ? pair[lang === "ar" ? 1 : 0] : "—";
}

function TenderMonitor() {
  const { t, lang } = useI18n();
  const { roles, user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? "";
  const [newTender, setNewTender] = useState(false);
  const [advance, setAdvance] = useState<{ tender: any; toStage: TenderStage } | null>(null);
  const [convertReview, setConvertReview] = useState<any | null>(null);
  const [editTender, setEditTenderTarget] = useState<any | null>(null);
  const [assignOwnerFor, setAssignOwnerFor] = useState<any | null>(null);
  const [followUpFor, setFollowUpFor] = useState<any | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<any | null>(null);
  const [classFilter, setClassFilter] = useState<"all" | "A" | "B" | "C">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"board" | "table">("board");
  const canPipeline = canManageSalesPipeline(roles);
  const canApprove = canApproveCommercialAction(roles);

  const { data: tenders = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["tenders"],
    queryFn: async () => (await supabase.from("tenders").select("*, main_contractor:companies!tenders_main_contractor_id_fkey(id, name), project:projects(id, name, notes, signage_package_status, owner_company_id, consultant_id, main_contractor_id)").order("updated_at", { ascending: false })).data ?? [],
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => (await supabase.from("companies").select("id, name").order("name")).data ?? [],
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () => (await supabase.from("projects").select("id, name").order("name")).data ?? [],
  });
  const { data: teamMembers = [] } = useQuery({
    queryKey: ["team-members-min"],
    queryFn: listTeamMembers,
  });
  // Pending TENDER_TO_JIH_APPROVAL rows drive the derived "Conversion Review"
  // column — a tender sits there once review has started, until a manager
  // approves (converted_to_jih) or returns it (back to awarded_to_contractor).
  const { data: pendingConversions = [] } = useQuery({
    queryKey: ["tender-pending-conversions"],
    queryFn: async () =>
      (await supabase.from("approvals").select("id, linked_record_id").eq("approval_type", "TENDER_TO_JIH_APPROVAL").eq("status", "pending")).data ?? [],
  });
  const { data: evidenceRows = [] } = useQuery({
    queryKey: ["tender-evidence-counts"],
    queryFn: async () => (await supabase.from("award_evidence").select("linked_record_id").eq("linked_record_type", "tender")).data ?? [],
  });

  const companyMap = useMemo(() => new Map((companies as any[]).map((c) => [c.id, c.name])), [companies]);
  const teamMap = useMemo(() => new Map((teamMembers as any[]).map((p) => [p.id, p.full_name || p.email || "—"])), [teamMembers]);
  const pendingConversionByTender = useMemo(() => new Map((pendingConversions as any[]).map((a) => [a.linked_record_id, a.id])), [pendingConversions]);
  const pendingConversionIds = useMemo(() => new Set(pendingConversionByTender.keys()), [pendingConversionByTender]);
  const evidenceCountByTender = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of evidenceRows as any[]) m.set(r.linked_record_id, (m.get(r.linked_record_id) ?? 0) + 1);
    return m;
  }, [evidenceRows]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tenders"] });
    qc.invalidateQueries({ queryKey: ["tender-pending-conversions"] });
    qc.invalidateQueries({ queryKey: ["tender-evidence-counts"] });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tenders
      .filter((x: any) => classFilter === "all" || x.tender_priority_classification === classFilter)
      .filter((x: any) => !q || (x.tender_name ?? "").toLowerCase().includes(q) || (x.main_contractor?.name ?? "").toLowerCase().includes(q));
  }, [tenders, classFilter, query]);

  const kpis = useMemo(() => {
    const active = tenders.filter((x: any) => !["converted_to_jih", "tender_lost_or_archived"].includes(x.tender_stage)).length;
    const inReview = tenders.filter((x: any) => pendingConversionIds.has(x.id)).length;
    const watchlisted = tenders.filter((x: any) => x.is_watchlisted).length;
    const converted = tenders.filter((x: any) => x.tender_stage === "converted_to_jih").length;
    const urgent = tenders.filter((x: any) => {
      const d = daysUntil(x.expected_award_date);
      return d != null && d <= 14 && !["converted_to_jih", "tender_lost_or_archived"].includes(x.tender_stage);
    }).length;
    return { active, inReview, watchlisted, converted, urgent };
  }, [tenders, pendingConversionIds]);

  const canActOn = (x: any) => canPipeline || x.tender_owner_id === uid;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Execution"
        title={t("nav_tenders")}
        description="Track live tenders, deadlines, and conversion readiness."
        actions={
          <button onClick={() => setNewTender(true)} className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20">
            <Plus className="h-3.5 w-3.5" />
            {t("wf_new_tender")}
          </button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label={t("nav_tenders")} value={tenders.length} icon={<Gavel className="h-3.5 w-3.5" />} hint={`${kpis.active} active`} />
        <KpiCard label="Award pressure ≤ 14d" value={kpis.urgent} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <KpiCard label={t("conv_review_title")} value={kpis.inReview} icon={<BadgeCheck className="h-3.5 w-3.5" />} />
        <KpiCard label={t("tb_watchlist")} value={kpis.watchlisted} icon={<Eye className="h-3.5 w-3.5" />} />
        <KpiCard label={t("tstage_converted_to_jih")} value={kpis.converted} icon={<GitMerge className="h-3.5 w-3.5" />} />
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tenders or contractor"
            className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {(["all", "A", "B", "C"] as const).map((c) => (
              <button key={c} onClick={() => setClassFilter(c)} className={`rounded-full border px-3 py-1 text-xs ${classFilter === c ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {c === "all" ? t("crm_filter_all_types") : c}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border border-border p-0.5">
            {(["board", "table"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded px-2.5 py-1 text-[11px] capitalize ${view === v ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : isError ? (
        <div className="rounded-xl border border-border/70 bg-surface/60 p-6 text-sm">
          <div className="text-foreground">{t("error_generic")}</div>
          <button onClick={() => refetch()} className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted">
            {t("retry")}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState message={t("wf_no_records")} />
      ) : view === "board" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {BOARD_COLUMNS.map((col) => {
            const items = filtered.filter((x: any) => columnFor(x, pendingConversionIds) === col);
            return (
              <div key={col} className="rounded-xl border border-border/70 bg-surface/60 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <StatusPill tone={stageTone(col)}>{columnLabel(col, (k) => t(k as never))}</StatusPill>
                  <span className="text-xs text-muted-foreground num" data-tabular="true">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((x: any) => (
                    <TenderCard
                      key={x.id}
                      x={x}
                      col={col}
                      lang={lang}
                      t={(k) => t(k as never)}
                      companyMap={companyMap}
                      teamMap={teamMap}
                      evidenceCount={evidenceCountByTender.get(x.id) ?? 0}
                      canAct={canActOn(x)}
                      canApprove={canApprove}
                      onAdvance={(toStage) => setAdvance({ tender: x, toStage })}
                      onRequestConversion={() => setConvertReview(x)}
                      onConvertToJih={async () => {
                        const approvalId = pendingConversionByTender.get(x.id);
                        try {
                          await approveTenderConversion(x.id, approvalId);
                          toast.success(t("crm_saved"));
                          refresh();
                          qc.invalidateQueries({ queryKey: ["opportunities"] });
                        } catch (e) {
                          toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                        }
                      }}
                      onEdit={() => setEditTenderTarget(x)}
                      onAssignOwner={() => setAssignOwnerFor(x)}
                      onAddFollowUp={() => setFollowUpFor(x)}
                      onAddEvidence={() => setEvidenceFor(x)}
                      onToggleWatchlist={async () => {
                        try {
                          await setTenderWatchlist(x.id, !x.is_watchlisted);
                          refresh();
                        } catch (e) {
                          toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                        }
                      }}
                    />
                  ))}
                  {items.length === 0 ? <div className="text-xs text-muted-foreground">—</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border/70 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Tender</th>
                <th className="px-4 py-2.5">Contractor</th>
                <th className="px-4 py-2.5">Column</th>
                <th className="px-4 py-2.5">Class</th>
                <th className="px-4 py-2.5">{t("label_owner")}</th>
                <th className="px-4 py-2.5 text-right">Value</th>
                <th className="px-4 py-2.5 text-right">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((x: any) => {
                const d = daysUntil(x.expected_award_date);
                const overdue = d != null && d < 0;
                const urgent = d != null && d <= 14 && d >= 0;
                const col = columnFor(x, pendingConversionIds);
                return (
                  <tr key={x.id} className="border-t border-border/60">
                    <td className="px-4 py-2.5 text-foreground">{x.tender_name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{x.main_contractor?.name ?? "—"}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={stageTone(col)}>{columnLabel(col, (k) => t(k as never))}</StatusPill></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{x.tender_priority_classification ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{x.tender_owner_id ? teamMap.get(x.tender_owner_id) ?? "—" : t("tb_no_owner")}</td>
                    <td className="px-4 py-2.5 text-right text-foreground num" data-tabular="true">{formatCurrency(x.estimated_project_value, lang, "SAR")}</td>
                    <td className={`px-4 py-2.5 text-right num ${overdue ? "text-red-300" : urgent ? "text-amber-light" : "text-muted-foreground"}`} data-tabular="true">
                      {d == null ? "—" : overdue ? `Overdue ${Math.abs(d)}d` : `${d}d`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ActionDialog
        open={newTender}
        onOpenChange={setNewTender}
        title={t("wf_new_tender")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "tenderName", type: "text", label: t("nav_tenders"), required: true },
          { key: "source", type: "text", label: t("wf_source") },
          { key: "projectId", type: "select", label: t("nav_projects"), options: [{ value: "", label: "—" }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))] },
          { key: "classification", type: "select", label: t("wf_classification"), options: [{ value: "", label: "—" }, { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }] },
          { key: "expectedAwardDate", type: "date", label: t("wf_expected_award") },
          { key: "estimatedProjectValue", type: "text", label: t("crm_total_value") },
          { key: "signagePotential", type: "select", label: t("crm_signage_package"), options: [{ value: "", label: "—" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }] },
        ]}
        onSubmit={async (v) => {
          try {
            await createTender({
              tenderName: v.tenderName,
              source: v.source || undefined,
              projectId: v.projectId || null,
              classification: (v.classification || null) as "A" | "B" | "C" | null,
              expectedAwardDate: v.expectedAwardDate || null,
              estimatedProjectValue: v.estimatedProjectValue ? Number(v.estimatedProjectValue) : null,
              signagePotential: (v.signagePotential || null) as "high" | "medium" | "low" | null,
              claimOwner: true,
            });
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog
        open={!!advance}
        onOpenChange={(o) => !o && setAdvance(null)}
        title={advance ? `${t("wf_move_to")}: ${t(`tstage_${advance.toStage}`)}` : ""}
        submitLabel={t("wf_advance_stage")}
        fields={advance ? fieldsForTenderStage(advance.toStage, (k) => t(k as never), companies) : []}
        onSubmit={async (v) => {
          if (!advance) return;
          try {
            await advanceTenderStage({ tenderId: advance.tender.id, toStage: advance.toStage, fields: v });
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog
        open={!!convertReview}
        onOpenChange={(o) => !o && setConvertReview(null)}
        title={t("conv_review_title")}
        submitLabel={t("wf_request_conversion")}
        fields={convertReview ? conversionReviewFields((k) => t(k as never), convertReview) : []}
        onSubmit={async (v) => {
          if (!convertReview) return;
          try {
            const r: any = await requestTenderConversion(convertReview.id, {
              project_stage_suitable: v.project_stage_suitable === "yes",
              package_not_closed: v.package_not_closed === "yes",
              estimated_signage_value: v.estimated_signage_value ? Number(v.estimated_signage_value) : null,
              contact_plan_ready: v.contact_plan_ready === "yes",
              main_contractor_confirmed: v.main_contractor_confirmed === "yes",
              signage_package_status: v.signage_package_status || null,
              signage_package_confidence: v.signage_package_confidence || null,
              conversion_reason: v.conversion_reason || null,
            });
            toast.success(r?.pending_exception ? t("wf_pending_exception") : r?.pending_approval ? t("wf_pending_approval") : t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["approvals"] });
            qc.invalidateQueries({ queryKey: ["tender-pending-conversions"] });
            qc.invalidateQueries({ queryKey: ["tenders"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={!!editTender}
        onOpenChange={(o) => !o && setEditTenderTarget(null)}
        title={t("tb_edit_tender")}
        submitLabel={t("crm_save_changes")}
        fields={editTender ? editTenderFields((k) => t(k as never), projects, editTender) : []}
        onSubmit={async (v) => {
          if (!editTender) return;
          try {
            await updateTender(editTender.id, {
              tenderName: v.tenderName,
              source: v.source || null,
              projectId: v.projectId || null,
              classification: (v.classification || null) as "A" | "B" | "C" | null,
              expectedAwardDate: v.expectedAwardDate || null,
              estimatedProjectValue: v.estimatedProjectValue ? Number(v.estimatedProjectValue) : null,
              signagePotential: (v.signagePotential || null) as "high" | "medium" | "low" | null,
            });
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog
        open={!!assignOwnerFor}
        onOpenChange={(o) => !o && setAssignOwnerFor(null)}
        title={t("tb_assign_owner")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "ownerId", type: "select", label: t("label_owner"), required: true, options: teamMembers.map((p: any) => ({ value: p.id, label: p.full_name || p.email })) },
        ]}
        onSubmit={async (v) => {
          if (!assignOwnerFor) return;
          try {
            await assignTenderOwner(assignOwnerFor.id, v.ownerId || null);
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog
        open={!!followUpFor}
        onOpenChange={(o) => !o && setFollowUpFor(null)}
        title={t("tb_add_follow_up")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "followUpDate", type: "date", label: t("field_due_date"), required: true },
          { key: "notes", type: "textarea", label: t("wf_notes") },
        ]}
        onSubmit={async (v) => {
          if (!followUpFor) return;
          try {
            await setTenderFollowUp(followUpFor.id, v.followUpDate, v.notes || undefined);
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog
        open={!!evidenceFor}
        onOpenChange={(o) => !o && setEvidenceFor(null)}
        title={t("tb_add_evidence")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "evidenceType", type: "select", label: t("wf_classification"), defaultValue: "tender_award", options: [{ value: "tender_award", label: "Tender award" }, { value: "verbal_award", label: "Verbal award" }, { value: "contract", label: "Contract" }] },
          { key: "source", type: "text", label: t("wf_source") },
          { key: "note", type: "textarea", label: t("wf_notes") },
          { key: "document", type: "file", label: t("wf_evidence"), folder: "tenders" },
        ]}
        onSubmit={async (v) => {
          if (!evidenceFor) return;
          try {
            await addTenderEvidence({
              tenderId: evidenceFor.id,
              evidenceType: v.evidenceType || undefined,
              source: v.source || undefined,
              note: v.note || undefined,
              documentUrl: v.document || undefined,
              dateReceived: new Date().toISOString().slice(0, 10),
            });
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />
    </div>
  );
}

function TenderCard({
  x, col, lang, t, companyMap, teamMap, evidenceCount, canAct, canApprove,
  onAdvance, onRequestConversion, onConvertToJih, onEdit, onAssignOwner, onAddFollowUp, onAddEvidence, onToggleWatchlist,
}: {
  x: any;
  col: BoardColumn;
  lang: "en" | "ar";
  t: (k: string) => string;
  companyMap: Map<string, string>;
  teamMap: Map<string, string>;
  evidenceCount: number;
  canAct: boolean;
  canApprove: boolean;
  onAdvance: (toStage: TenderStage) => void;
  onRequestConversion: () => void;
  onConvertToJih: () => void;
  onEdit: () => void;
  onAssignOwner: () => void;
  onAddFollowUp: () => void;
  onAddEvidence: () => void;
  onToggleWatchlist: () => void;
}) {
  const d = daysUntil(x.expected_award_date);
  const urgent = d != null && d <= 14 && d >= 0;
  const overdue = d != null && d < 0;
  const project = x.project;
  const clientOwnerName = project?.owner_company_id ? companyMap.get(project.owner_company_id) ?? "—" : "—";
  const consultantName = project?.consultant_id ? companyMap.get(project.consultant_id) ?? "—" : "—";
  const mainContractorName = x.main_contractor?.name ?? (project?.main_contractor_id ? companyMap.get(project.main_contractor_id) ?? "—" : "—");
  const ownerName = x.tender_owner_id ? teamMap.get(x.tender_owner_id) ?? "—" : t("tb_no_owner");
  const readiness = tenderConversionReadiness(x);

  return (
    <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground">{x.tender_name}</span>
        <div className="flex shrink-0 items-center gap-1">
          {x.is_watchlisted ? <Eye className="h-3.5 w-3.5 text-amber-light" /> : null}
          {x.tender_priority_classification ? <StatusPill tone="muted">{x.tender_priority_classification}</StatusPill> : null}
        </div>
      </div>

      {x.source ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{t("wf_source")}: {x.source}</div> : null}
      {project?.name ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{t("label_project")}: {project.name}</div> : null}
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{t("tb_client_owner")}: {clientOwnerName}</div>
      {project?.notes ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{t("tb_scope_summary")}: {project.notes}</div> : null}
      {project?.signage_package_status ? (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {t("tb_signage_relevance")}: {project.signage_package_status.replaceAll("_", " ")}
        </div>
      ) : null}

      <div className="mt-1.5 text-xs text-muted-foreground">
        {mainContractorName !== "—" ? `${mainContractorName} · ` : ""}
        <span className="num" data-tabular="true">{formatCurrency(x.estimated_project_value, lang, "SAR")}</span>
      </div>
      {consultantName !== "—" ? <div className="text-[11px] text-muted-foreground">{t("tb_consultant")}: {consultantName}</div> : null}

      {d != null ? (
        <div className={`mt-1 text-[11px] ${overdue ? "text-red-300" : urgent ? "text-amber-light" : "text-muted-foreground"}`}>
          {overdue ? `Overdue ${Math.abs(d)}d` : `${d}d to award`}
        </div>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>{t("label_owner")}: {ownerName}</span>
        {x.next_follow_up_date ? <span>{t("field_due_date")}: {x.next_follow_up_date}</span> : null}
        <span>{t("tb_evidence_count")}: {evidenceCount}</span>
      </div>

      {col === "awarded_to_contractor" || col === "conversion_review" ? (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {t("tb_conversion_readiness")}: <span className={readiness.ready ? "text-emerald-300" : "text-amber-light"}>{readiness.met}/{readiness.total}</span>
        </div>
      ) : null}

      <div className="mt-1 text-[11px] text-muted-foreground">
        <span className="text-amber-light">{t("label_next_action")}:</span> {nextActionHint(x, lang)}
      </div>

      <div className="mt-2 flex flex-wrap justify-end gap-1 border-t border-border/60 pt-1.5">
        <EmailComposeButton
          size="xs"
          variant="ghost"
          template="tender_clarification"
          context={{ tenderName: x.tender_name, companyName: mainContractorName !== "—" ? mainContractorName : null, projectName: x.tender_name }}
          linked={{ type: "tender", id: x.id, label: x.tender_name, companyId: x.main_contractor?.id ?? null }}
        />
        {canAct ? (
          <>
            <IconButton title={t("tb_edit_tender")} onClick={onEdit}><Pencil className="h-3 w-3" /></IconButton>
            <IconButton title={t("tb_add_follow_up")} onClick={onAddFollowUp}><CalendarPlus className="h-3 w-3" /></IconButton>
            <IconButton title={t("tb_add_evidence")} onClick={onAddEvidence}><FileUp className="h-3 w-3" /></IconButton>
            <IconButton title={x.is_watchlisted ? t("tb_unmark_watchlist") : t("tb_mark_watchlist")} onClick={onToggleWatchlist}><Eye className="h-3 w-3" /></IconButton>
          </>
        ) : null}
        {canAct && canApprove ? <IconButton title={t("tb_assign_owner")} onClick={onAssignOwner}><UserCog className="h-3 w-3" /></IconButton> : null}
        {canAct && col === "awarded_to_contractor" ? (
          <button onClick={onRequestConversion} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20">
            {t("wf_request_conversion")}
          </button>
        ) : null}
        {canApprove && col === "conversion_review" ? (
          <button onClick={onConvertToJih} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20">
            {t("wf_convert_to_jih")}
          </button>
        ) : null}
        {canAct && (col === "tender_identified" || col === "tender_under_process" || col === "award_negotiation" || col === "awarded_to_contractor") ? (
          nextTenderStages(x.tender_stage as TenderStage).map((ns) => (
            <button key={ns} onClick={() => onAdvance(ns)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
              → {t(`tstage_${ns}`)}
            </button>
          ))
        ) : null}
      </div>
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="rounded border border-border p-1 text-muted-foreground hover:text-foreground">
      {children}
    </button>
  );
}
