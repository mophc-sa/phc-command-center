import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Gavel, AlertTriangle, Trophy, GitMerge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import {
  createTender, advanceTenderStage, requestTenderConversion, nextTenderStages,
  TENDER_STAGES, type TenderStage,
} from "@/lib/tender-actions";
import { EmailComposeButton } from "@/components/phc/EmailComposeButton";

export const Route = createFileRoute("/_authenticated/tenders")({
  head: () => ({ meta: [{ title: "Tender Monitor — PHC" }, { name: "robots", content: "noindex" }] }),
  component: TenderMonitor,
});

function stageTone(s: TenderStage): "positive" | "attention" | "danger" | "muted" | "neutral" {
  if (s === "converted_to_jih") return "positive";
  if (s === "tender_lost_or_archived") return "danger";
  if (s === "awarded_to_contractor") return "attention";
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

function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.round((dt.getTime() - Date.now()) / 86400000);
}

function TenderMonitor() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [newTender, setNewTender] = useState(false);
  const [advance, setAdvance] = useState<{ tender: any; toStage: TenderStage } | null>(null);
  const [convertReview, setConvertReview] = useState<any | null>(null);
  const [classFilter, setClassFilter] = useState<"all" | "A" | "B" | "C">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"board" | "table">("board");
  const tstageLabel = (s: string) => t(`tstage_${s}` as never);

  const { data: tenders = [], isLoading } = useQuery({
    queryKey: ["tenders"],
    queryFn: async () => (await supabase.from("tenders").select("*, main_contractor:companies!tenders_main_contractor_id_fkey(id, name)").order("updated_at", { ascending: false })).data ?? [],
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => (await supabase.from("companies").select("id, name").order("name")).data ?? [],
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () => (await supabase.from("projects").select("id, name").order("name")).data ?? [],
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["tenders"] });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tenders
      .filter((x: any) => classFilter === "all" || x.tender_priority_classification === classFilter)
      .filter((x: any) => !q || (x.tender_name ?? "").toLowerCase().includes(q) || (x.main_contractor?.name ?? "").toLowerCase().includes(q));
  }, [tenders, classFilter, query]);

  const kpis = useMemo(() => {
    const active = tenders.filter((x: any) => !["converted_to_jih", "tender_lost_or_archived"].includes(x.tender_stage)).length;
    const awarded = tenders.filter((x: any) => x.tender_stage === "awarded_to_contractor").length;
    const converted = tenders.filter((x: any) => x.tender_stage === "converted_to_jih").length;
    const urgent = tenders.filter((x: any) => {
      const d = daysUntil(x.expected_award_date);
      return d != null && d <= 14 && !["converted_to_jih", "tender_lost_or_archived"].includes(x.tender_stage);
    }).length;
    return { active, awarded, converted, urgent };
  }, [tenders]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Execution"
        title={t("nav_tenders")}
        description={t("tender_monitor_intro" as never) !== "tender_monitor_intro" ? t("tender_monitor_intro" as never) : "Track live tenders, deadlines, and conversion readiness."}
        actions={
          <button onClick={() => setNewTender(true)} className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20">
            <Plus className="h-3.5 w-3.5" />
            {t("wf_new_tender")}
          </button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t("nav_tenders")} value={tenders.length} icon={<Gavel className="h-3.5 w-3.5" />} hint={`${kpis.active} active`} />
        <KpiCard label="Award pressure ≤ 14d" value={kpis.urgent} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <KpiCard label={t("tstage_awarded_to_contractor")} value={kpis.awarded} icon={<Trophy className="h-3.5 w-3.5" />} />
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
      ) : filtered.length === 0 ? (
        <EmptyState message={t("wf_no_records")} />
      ) : view === "board" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TENDER_STAGES.map((stage) => {
            const items = filtered.filter((x: any) => x.tender_stage === stage);
            return (
              <div key={stage} className="rounded-xl border border-border/70 bg-surface/60 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <StatusPill tone={stageTone(stage)}>{tstageLabel(stage)}</StatusPill>
                  <span className="text-xs text-muted-foreground num" data-tabular="true">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((x: any) => {
                    const d = daysUntil(x.expected_award_date);
                    const urgent = d != null && d <= 14 && d >= 0;
                    const overdue = d != null && d < 0;
                    return (
                      <div key={x.id} className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate text-sm text-foreground">{x.tender_name}</span>
                          {x.tender_priority_classification ? <StatusPill tone="muted">{x.tender_priority_classification}</StatusPill> : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {x.main_contractor?.name ? `${x.main_contractor.name} · ` : ""}
                          <span className="num" data-tabular="true">{formatCurrency(x.estimated_project_value, lang, "SAR")}</span>
                        </div>
                        {d != null ? (
                          <div className={`mt-1 text-[11px] ${overdue ? "text-red-300" : urgent ? "text-amber-light" : "text-muted-foreground"}`}>
                            {overdue ? `Overdue ${Math.abs(d)}d` : `${d}d to award`}
                          </div>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap justify-end gap-1">
                          {stage === "awarded_to_contractor" ? (
                            <button
                              onClick={() => setConvertReview(x)}
                              className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
                            >
                              {t("wf_request_conversion")}
                            </button>
                          ) : null}
                          {nextTenderStages(stage).map((ns) => (
                            <button key={ns} onClick={() => setAdvance({ tender: x, toStage: ns })} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                              → {tstageLabel(ns)}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
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
                <th className="px-4 py-2.5">Stage</th>
                <th className="px-4 py-2.5">Class</th>
                <th className="px-4 py-2.5 text-right">Value</th>
                <th className="px-4 py-2.5 text-right">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((x: any) => {
                const d = daysUntil(x.expected_award_date);
                const overdue = d != null && d < 0;
                const urgent = d != null && d <= 14 && d >= 0;
                return (
                  <tr key={x.id} className="border-t border-border/60">
                    <td className="px-4 py-2.5 text-foreground">{x.tender_name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{x.main_contractor?.name ?? "—"}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={stageTone(x.tender_stage)}>{tstageLabel(x.tender_stage)}</StatusPill></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{x.tender_priority_classification ?? "—"}</td>
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
        title={advance ? `${t("wf_move_to")}: ${tstageLabel(advance.toStage)}` : ""}
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
            qc.invalidateQueries({ queryKey: ["tenders"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
