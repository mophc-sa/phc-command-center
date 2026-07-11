import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowRight, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { createRfq, convertRfqToJih } from "@/lib/rfq-actions";
import {
  advanceSalesStage, nextSalesStages, SALES_STAGES, type SalesStage,
} from "@/lib/workflow-actions";
import { CommunicationActions } from "@/components/phc/CommunicationActions";
import { CommunicationTimeline } from "@/components/phc/CommunicationTimeline";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/rfq-jih")({
  head: () => ({ meta: [{ title: "RFQ & JIH Board — PHC" }, { name: "robots", content: "noindex" }] }),
  component: RfqJihBoard,
});

// Only opportunity stages appear as columns; the RFQ column is sourced from rfqs.
const OPP_STAGES: SalesStage[] = SALES_STAGES.filter((s) => s !== "rfq_received");

function stageTone(s: SalesStage): "positive" | "attention" | "danger" | "muted" | "neutral" {
  if (s === "won") return "positive";
  if (s === "lost") return "danger";
  if (s === "verbally_awarded" || s === "contract_received") return "attention";
  if (s === "on_hold") return "muted";
  return "neutral";
}

function fieldsForStage(t: string, tt: (k: string) => string): DialogField[] {
  switch (t) {
    case "under_negotiation":
      return [{ key: "notes", type: "textarea", label: tt("wf_notes"), required: true }];
    case "verbally_awarded":
      return [
        { key: "verbal_award_contact_name", type: "text", label: tt("wf_award_contact"), required: true },
        { key: "verbal_award_contact_title", type: "text", label: tt("wf_award_title"), required: true },
        { key: "verbal_award_method", type: "text", label: tt("wf_award_method") },
        { key: "expected_contract_date", type: "date", label: tt("wf_expected_contract"), required: true },
        { key: "evidence", type: "textarea", label: tt("wf_evidence"), required: true },
      ];
    case "contract_received":
      return [
        { key: "contract_value", type: "text", label: tt("wf_contract_value"), required: true },
        { key: "contract_reference_number", type: "text", label: tt("wf_contract_ref") },
        { key: "contract_document_url", type: "file", label: tt("wf_evidence"), folder: "contracts" },
      ];
    case "won":
      return [{ key: "notes", type: "textarea", label: tt("wf_notes") }];
    case "lost":
      return [
        { key: "loss_reason", type: "textarea", label: tt("wf_loss_reason"), required: true },
        { key: "loss_notes", type: "textarea", label: tt("wf_notes") },
      ];
    case "on_hold":
      return [
        { key: "hold_reason", type: "textarea", label: tt("wf_hold_reason"), required: true },
        { key: "hold_review_date", type: "date", label: tt("wf_hold_review"), required: true },
      ];
    default:
      return [];
  }
}

function RfqJihBoard() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [newRfq, setNewRfq] = useState(false);
  const [convertRfq, setConvertRfq] = useState<any | null>(null);
  const [advance, setAdvance] = useState<{ opp: any; toStage: SalesStage } | null>(null);
  const [historyRfq, setHistoryRfq] = useState<{ id: string; label: string } | null>(null);
  const sstageLabel = (s: string) => t(`sstage_${s}` as never);

  const { data: rfqs = [] } = useQuery({
    queryKey: ["rfqs-open"],
    queryFn: async () => (await supabase.from("rfqs").select("*").eq("status", "open").order("received_date", { ascending: false })).data ?? [],
  });
  const { data: opps = [], isLoading } = useQuery({
    queryKey: ["opps-sales-stage"],
    queryFn: async () =>
      (await supabase.from("opportunities").select("id, project_name, sales_stage, win_confidence, estimated_value_max, currency, action_required").not("sales_stage", "is", null).order("updated_at", { ascending: false })).data ?? [],
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => (await supabase.from("companies").select("id, name").order("name")).data ?? [],
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () => (await supabase.from("projects").select("id, name").order("name")).data ?? [],
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["rfqs-open"] });
    qc.invalidateQueries({ queryKey: ["opps-sales-stage"] });
  };

  const rfqValue = rfqs.reduce((s: number, r: any) => s + (r.estimated_value ?? 0), 0);
  const activeOpps = opps.filter((o: any) => !["won", "lost", "archived"].includes(o.sales_stage));
  const totalPipeline = activeOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0);
  const awaitingAward = opps.filter((o: any) => o.sales_stage === "verbally_awarded").length;
  const wonThisPeriod = opps.filter((o: any) => o.sales_stage === "won").length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={lang === "ar" ? "التحويل" : "Conversion"}
        title={t("nav_rfq_jih")}
        description={lang === "ar" ? "من طلب عرض السعر إلى الترسية والعقد." : "From incoming RFQ to award and contract."}
        actions={
          <button
            onClick={() => setNewRfq(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3.5 text-[12px] font-medium text-amber-light transition-colors hover:bg-amber/20"
          >
            <Plus className="h-3.5 w-3.5" /> {t("wf_new_rfq")}
          </button>
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t("sstage_rfq_received")} value={formatNumber(rfqs.length, lang)} hint={formatCurrency(rfqValue, lang, "SAR")} />
        <KpiCard label={lang === "ar" ? "خط الأنابيب النشط" : "Active pipeline"} value={formatCurrency(totalPipeline, lang, "SAR")} hint={`${formatNumber(activeOpps.length, lang)} ${lang === "ar" ? "فرصة" : "opportunities"}`} />
        <KpiCard label={t("sstage_verbally_awarded")} value={formatNumber(awaitingAward, lang)} hint={lang === "ar" ? "تحتاج توثيق" : "Needs documentation"} trend={awaitingAward > 0 ? "up" : "flat"} />
        <KpiCard label={t("sstage_won")} value={formatNumber(wonThisPeriod, lang)} hint={lang === "ar" ? "المغلقة بنجاح" : "Closed successfully"} />
      </section>

      {/* RFQ Received column */}
      <div className="mb-6 overflow-hidden rounded-xl border border-border/70 bg-surface/60">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold text-foreground">{t("sstage_rfq_received")}</span>
            <StatusPill tone="muted">{formatNumber(rfqs.length, lang)}</StatusPill>
          </div>
          <span className="num text-[11px] text-muted-foreground" data-tabular="true">{formatCurrency(rfqValue, lang, "SAR")}</span>
        </div>
        <div className="p-3">
          {rfqs.length === 0 ? (
            <div className="py-6"><EmptyState message={t("wf_no_records")} /></div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {rfqs.map((r: any) => (
                <div key={r.id} className="rounded-lg border border-border/70 bg-background/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">{r.rfq_number ?? "RFQ"}</span>
                    <button
                      onClick={() => setConvertRfq(r)}
                      className="shrink-0 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
                    >
                      {t("wf_convert_to_jih")} <ArrowRight className="ms-0.5 inline h-2.5 w-2.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="num text-[11px] text-muted-foreground" data-tabular="true">
                      {formatCurrency(r.estimated_value, lang, "SAR")}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setHistoryRfq({ id: r.id, label: r.rfq_number ?? "RFQ" })}
                        title={t("comm_history")}
                        className="grid h-6 w-6 place-items-center rounded-md border border-border/70 text-muted-foreground hover:text-foreground"
                      >
                        <History className="h-3 w-3" />
                      </button>
                      <CommunicationActions
                        size="xs"
                        linked={{
                          type: "rfq",
                          id: r.id,
                          label: r.rfq_number ?? "RFQ",
                          rfqId: r.id,
                          companyId: r.company_id ?? null,
                          contactId: r.contact_id ?? null,
                        }}
                        emailTemplate="tender_clarification"
                        emailContext={{ rfqName: r.rfq_number ?? "RFQ", projectName: r.rfq_number ?? null }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Opportunity stages */}
      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {OPP_STAGES.map((stage) => {
            const items = opps.filter((o: any) => o.sales_stage === stage);
            const totalValue = items.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0);
            return (
              <div key={stage} className="flex flex-col rounded-xl border border-border/70 bg-surface/60">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <StatusPill tone={stageTone(stage)}>{sstageLabel(stage)}</StatusPill>
                    <span className="num text-[11px] text-muted-foreground" data-tabular="true">{formatNumber(items.length, lang)}</span>
                  </div>
                  {totalValue > 0 ? (
                    <span className="num text-[10px] uppercase tracking-wider text-muted-foreground" data-tabular="true">
                      {formatCurrency(totalValue, lang, "SAR")}
                    </span>
                  ) : null}
                </div>
                <div className="flex-1 space-y-2 p-3">
                  {items.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/60 py-6 text-center text-[11px] text-muted-foreground">
                      —
                    </div>
                  ) : (
                    items.map((o: any) => (
                      <div key={o.id} className="rounded-lg border border-border/70 bg-background/60 p-3 transition-colors hover:border-border-strong/70">
                        <Link to="/opportunities/$id" params={{ id: o.id }} className="block truncate text-[13px] font-medium text-foreground hover:underline">
                          {o.project_name}
                        </Link>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="num text-[11px] text-muted-foreground" data-tabular="true">
                            {formatCurrency(o.estimated_value_max, lang, o.currency)}
                          </span>
                          <div className="flex flex-wrap justify-end gap-1">
                            {o.action_required ? <StatusPill tone="attention">!</StatusPill> : null}
                            {nextSalesStages(o.sales_stage).map((ns) => (
                              <button
                                key={ns}
                                onClick={() => setAdvance({ opp: o, toStage: ns })}
                                className="rounded-md border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-border-strong hover:bg-surface-2/50 hover:text-foreground"
                              >
                                → {sstageLabel(ns)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}


      {/* New RFQ */}
      <ActionDialog
        open={newRfq}
        onOpenChange={setNewRfq}
        title={t("wf_new_rfq")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "rfqNumber", type: "text", label: "RFQ #" },
          { key: "companyId", type: "select", label: t("crm_company"), options: [{ value: "__none__", label: "—" }, ...companies.map((c: any) => ({ value: c.id, label: c.name }))] },
          { key: "projectId", type: "select", label: t("nav_projects"), options: [{ value: "__none__", label: "—" }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))] },
          { key: "estimatedValue", type: "text", label: t("crm_total_value") },
          { key: "responseDueDate", type: "date", label: t("wf_expected_contract") },
          { key: "documentUrl", type: "file", label: t("wf_evidence"), folder: "rfq" },
        ]}
        onSubmit={async (v) => {
          try {
            await createRfq({
              rfqNumber: v.rfqNumber || undefined,
              companyId: v.companyId && v.companyId !== "__none__" ? v.companyId : null,
              projectId: v.projectId && v.projectId !== "__none__" ? v.projectId : null,
              estimatedValue: v.estimatedValue ? Number(v.estimatedValue) : null,
              responseDueDate: v.responseDueDate || null,
              documentUrl: v.documentUrl || null,
              claimOwner: true,
            });
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      {/* Convert RFQ -> JIH */}
      <ActionDialog
        open={!!convertRfq}
        onOpenChange={(o) => !o && setConvertRfq(null)}
        title={t("wf_convert_to_jih")}
        submitLabel={t("wf_convert_to_jih")}
        fields={[
          { key: "project_name", type: "text", label: t("nav_projects"), required: true, defaultValue: convertRfq?.rfq_number ?? "" },
          { key: "next_action", type: "text", label: t("crm_next_action"), required: true },
          { key: "follow_up_date", type: "date", label: t("crm_next_action"), required: true },
          { key: "value_pending", type: "select", label: t("crm_total_value"), defaultValue: "no", options: [{ value: "no", label: "—" }, { value: "yes", label: t("crm_pending_verification") }] },
          // PHC conversion review gates.
          { key: "project_stage_suitable", type: "select", label: t("conv_stage_suitable"), required: true, options: [{ value: "yes", label: t("conv_yes") }, { value: "no", label: t("conv_no") }] },
          { key: "package_not_closed", type: "select", label: t("conv_package_open"), required: true, options: [{ value: "yes", label: t("conv_yes") }, { value: "no", label: t("conv_no") }] },
          { key: "estimated_signage_value", type: "text", label: t("conv_signage_value"), required: true, defaultValue: convertRfq?.estimated_signage_value ?? convertRfq?.estimated_value ?? "" },
          { key: "contact_plan_ready", type: "select", label: t("conv_contact_plan"), required: true, options: [{ value: "yes", label: t("conv_yes") }, { value: "no", label: t("conv_no") }] },
          { key: "main_contractor_confirmed", type: "select", label: t("conv_contractor_confirmed"), required: true, options: [{ value: "yes", label: t("conv_yes") }, { value: "no", label: t("conv_no") }] },
          { key: "signage_package_status", type: "select", label: t("conv_package_status"), required: true, options: [{ value: "confirmed", label: "Confirmed / open" }, { value: "likely", label: "Likely" }, { value: "unknown", label: "Unknown" }, { value: "no_package_identified", label: "No package" }] },
          { key: "signage_package_confidence", type: "select", label: t("conv_package_confidence"), required: true, options: [{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }] },
          { key: "conversion_reason", type: "textarea", label: t("conv_reason"), required: true },
        ]}
        onSubmit={async (v) => {
          try {
            const r: any = await convertRfqToJih(
              convertRfq.id,
              {
                project_name: v.project_name,
                next_action: v.next_action,
                follow_up_date: v.follow_up_date,
                value_pending: v.value_pending === "yes",
                signage_relevant: true,
              },
              {
                project_stage_suitable: v.project_stage_suitable === "yes",
                package_not_closed: v.package_not_closed === "yes",
                estimated_signage_value: v.estimated_signage_value ? Number(v.estimated_signage_value) : null,
                contact_plan_ready: v.contact_plan_ready === "yes",
                main_contractor_confirmed: v.main_contractor_confirmed === "yes",
                signage_package_status: v.signage_package_status || null,
                signage_package_confidence: v.signage_package_confidence || null,
                conversion_reason: v.conversion_reason || null,
              },
            );
            toast.success(r?.pending_exception ? t("wf_pending_exception") : t("crm_saved"));
            refresh();
            qc.invalidateQueries({ queryKey: ["opportunities"] });
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      {/* Advance sales stage */}
      <ActionDialog
        open={!!advance}
        onOpenChange={(o) => !o && setAdvance(null)}
        title={advance ? `${t("wf_move_to")}: ${sstageLabel(advance.toStage)}` : ""}
        submitLabel={t("wf_advance_stage")}
        fields={advance ? fieldsForStage(advance.toStage, (k) => t(k as never)) : []}
        onSubmit={async (v) => {
          if (!advance) return;
          const { notes, evidence, ...fields } = v as Record<string, string>;
          try {
            const res: any = await advanceSalesStage({
              opportunityId: advance.opp.id,
              toStage: advance.toStage,
              notes,
              evidence,
              fields: { ...fields, contract_value: fields.contract_value ? Number(fields.contract_value) : undefined },
            });
            toast.success(res?.pending_approval ? t("wf_pending_approval") : t("crm_saved"));
            refresh();
            qc.invalidateQueries({ queryKey: ["approvals"] });
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <Dialog open={!!historyRfq} onOpenChange={(o) => !o && setHistoryRfq(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{historyRfq ? `${t("comm_history")} — ${historyRfq.label}` : t("comm_history")}</DialogTitle>
          </DialogHeader>
          {historyRfq ? <CommunicationTimeline filter={{ rfqId: historyRfq.id }} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
