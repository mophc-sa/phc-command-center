import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowRight } from "lucide-react";
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

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title={t("nav_rfq_jih")}
        action={
          <button onClick={() => setNewRfq(true)} className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20">
            {t("wf_new_rfq")}
          </button>
        }
      />

      {/* RFQ Received column */}
      <div className="mb-6 rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">{t("sstage_rfq_received")}</span>
          <span className="text-xs text-muted-foreground">{rfqs.length}</span>
        </div>
        {rfqs.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t("wf_no_records")}</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {rfqs.map((r: any) => (
              <div key={r.id} className="rounded-md border border-border bg-background/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-foreground">{r.rfq_number ?? "RFQ"}</span>
                  <button onClick={() => setConvertRfq(r)} className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20">
                    {t("wf_convert_to_jih")}
                  </button>
                </div>
                <div className="mt-1 text-xs text-muted-foreground num" data-tabular="true">{formatCurrency(r.estimated_value, lang, "SAR")}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Opportunity stages */}
      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {OPP_STAGES.map((stage) => {
            const items = opps.filter((o: any) => o.sales_stage === stage);
            return (
              <div key={stage} className="rounded-lg border border-border bg-surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <StatusPill tone={stageTone(stage)}>{sstageLabel(stage)}</StatusPill>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((o: any) => (
                    <div key={o.id} className="rounded-md border border-border bg-background/40 px-3 py-2">
                      <Link to="/opportunities/$id" params={{ id: o.id }} className="block truncate text-sm text-foreground hover:underline">
                        {o.project_name}
                      </Link>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="num text-xs text-muted-foreground" data-tabular="true">{formatCurrency(o.estimated_value_max, lang, o.currency)}</span>
                        <div className="flex flex-wrap justify-end gap-1">
                          {o.action_required ? <StatusPill tone="attention">!</StatusPill> : null}
                          {nextSalesStages(o.sales_stage).map((ns) => (
                            <button key={ns} onClick={() => setAdvance({ opp: o, toStage: ns })} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                              → {sstageLabel(ns)}
                            </button>
                          ))}
                        </div>
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
        ]}
        onSubmit={async (v) => {
          try {
            await convertRfqToJih(convertRfq.id, {
              project_name: v.project_name,
              next_action: v.next_action,
              follow_up_date: v.follow_up_date,
              value_pending: v.value_pending === "yes",
              signage_relevant: true,
            });
            toast.success(t("crm_saved"));
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
    </div>
  );
}
