import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import {
  createTender, advanceTenderStage, requestTenderConversion, nextTenderStages,
  TENDER_STAGES, type TenderStage,
} from "@/lib/tender-actions";

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

function TenderMonitor() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [newTender, setNewTender] = useState(false);
  const [advance, setAdvance] = useState<{ tender: any; toStage: TenderStage } | null>(null);
  const [classFilter, setClassFilter] = useState<"all" | "A" | "B" | "C">("all");
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
  const filtered = classFilter === "all" ? tenders : tenders.filter((x: any) => x.tender_priority_classification === classFilter);

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title={t("nav_tenders")}
        count={filtered.length}
        action={
          <button onClick={() => setNewTender(true)} className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20">
            {t("wf_new_tender")}
          </button>
        }
      />

      <div className="mb-4 flex gap-1.5">
        {(["all", "A", "B", "C"] as const).map((c) => (
          <button key={c} onClick={() => setClassFilter(c)} className={`rounded-full border px-3 py-1 text-xs ${classFilter === c ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {c === "all" ? t("crm_filter_all_types") : c}
          </button>
        ))}
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TENDER_STAGES.map((stage) => {
            const items = filtered.filter((x: any) => x.tender_stage === stage);
            return (
              <div key={stage} className="rounded-lg border border-border bg-surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <StatusPill tone={stageTone(stage)}>{tstageLabel(stage)}</StatusPill>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((x: any) => (
                    <div key={x.id} className="rounded-md border border-border bg-background/40 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-sm text-foreground">{x.tender_name}</span>
                        {x.tender_priority_classification ? <StatusPill tone="muted">{x.tender_priority_classification}</StatusPill> : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {x.main_contractor?.name ? `${x.main_contractor.name} · ` : ""}
                        <span className="num" data-tabular="true">{formatCurrency(x.estimated_project_value, lang, "SAR")}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap justify-end gap-1">
                        {stage === "awarded_to_contractor" ? (
                          <button
                            onClick={async () => {
                              try { const r: any = await requestTenderConversion(x.id); toast.success(r?.pending_approval ? t("wf_pending_approval") : t("crm_saved")); qc.invalidateQueries({ queryKey: ["approvals"] }); }
                              catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                            }}
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
                  ))}
                  {items.length === 0 ? <div className="text-xs text-muted-foreground">—</div> : null}
                </div>
              </div>
            );
          })}
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
    </div>
  );
}
