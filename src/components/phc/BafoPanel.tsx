// BAFO / commercial-discount approval chain panel — client spec
// (2026-07-27, "دور مدير تطوير الأعمال داخل النظام", section 12). Renders
// on the opportunity detail page's Decision tab. A fixed 4-step sequential
// chain; see bafo-actions.ts / 20260727220000_bafo_approval_chain.sql for
// the server-side ordering/role enforcement this UI reflects but does not
// itself decide.
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import {
  listBafoRequests, createBafoRequest, decideBafoStep, markBafoSentToClient,
  BAFO_STEPS, type BafoStep, type BafoRequest, type BafoStepStatus,
} from "@/lib/bafo-actions";
import {
  canRequestBafo, canReviewBafoCommercial, canApproveBafoCost,
  canApproveBafoFinance, canApproveBafoFinal,
} from "@/lib/roles";

function stepTone(status: BafoStepStatus): "positive" | "attention" | "danger" | "neutral" {
  if (status === "approved") return "positive";
  if (status === "rejected") return "danger";
  return "neutral";
}

const STEP_STATUS_KEY: Record<BafoStep, keyof BafoRequest> = {
  commercial_review: "commercial_review_status",
  cost_approval: "cost_approval_status",
  finance_review: "finance_review_status",
  final_approval: "final_approval_status",
};

export function BafoPanel({ opportunityId }: { opportunityId: string }) {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [decideTarget, setDecideTarget] = useState<{ request: BafoRequest; step: BafoStep; decision: "approved" | "rejected" } | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["bafo-requests", opportunityId],
    queryFn: () => listBafoRequests(opportunityId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["bafo-requests", opportunityId] });

  // Order matters — a step is only actionable once every prior step in
  // BAFO_STEPS is approved (mirrors the DB trigger's sequential gate).
  function canDecideStep(request: BafoRequest, step: BafoStep): boolean {
    const idx = BAFO_STEPS.indexOf(step);
    const priorStepsApproved = BAFO_STEPS.slice(0, idx).every(
      (s) => request[STEP_STATUS_KEY[s]] === "approved",
    );
    if (!priorStepsApproved || request[STEP_STATUS_KEY[step]] !== "pending") return false;
    if (step === "commercial_review") return canReviewBafoCommercial(roles);
    if (step === "cost_approval") return canApproveBafoCost(roles);
    if (step === "finance_review") return canApproveBafoFinance(roles);
    return canApproveBafoFinal(roles);
  }

  return (
    <Panel
      title={t("section_bafo" as never)}
      action={
        canRequestBafo(roles) ? (
          <button
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("bafo_request_new" as never)}
          </button>
        ) : undefined
      }
    >
      {isLoading ? null : requests.length === 0 ? (
        <EmptyState message={t("bafo_no_requests" as never)} />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="rounded-xl border border-border/70 bg-surface/60 px-4 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={stepTone(r.status as BafoStepStatus)}>
                    {t(`bafo_status_${r.status}` as never)}
                  </StatusPill>
                  {r.proposed_value != null ? (
                    <span className="num text-sm text-foreground" data-tabular="true">
                      {formatCurrency(r.proposed_value, lang)}
                    </span>
                  ) : null}
                  {r.proposed_discount_pct != null ? (
                    <span className="text-xs text-muted-foreground">-{r.proposed_discount_pct}%</span>
                  ) : null}
                </div>
                {r.status === "approved" && !r.sent_to_client_at ? (
                  <button
                    onClick={async () => {
                      try {
                        await markBafoSentToClient(r.id);
                        toast.success(t("bafo_mark_sent_to_client" as never));
                        refresh();
                      } catch (e) {
                        toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                      }
                    }}
                    className="rounded-md border border-won/30 bg-won/10 px-2.5 py-1 text-[11px] text-won hover:bg-won/20"
                  >
                    {t("bafo_mark_sent_to_client" as never)}
                  </button>
                ) : r.sent_to_client_at ? (
                  <span className="text-[11px] text-muted-foreground">{t("bafo_sent_to_client_at" as never)}</span>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{r.justification}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {BAFO_STEPS.map((step) => {
                  const status = r[STEP_STATUS_KEY[step]] as BafoStepStatus;
                  const actionable = canDecideStep(r, step);
                  return (
                    <div key={step} className="rounded-md border border-border/60 px-2.5 py-2">
                      <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        {t(`bafo_step_${step}` as never)}
                      </div>
                      <StatusPill tone={stepTone(status)}>{t(`bafo_status_${status}` as never)}</StatusPill>
                      {actionable ? (
                        <div className="mt-1.5 flex gap-1.5">
                          <button
                            onClick={() => setDecideTarget({ request: r, step, decision: "approved" })}
                            className="rounded border border-won/30 bg-won/10 px-1.5 py-0.5 text-[10px] text-won hover:bg-won/20"
                          >
                            {t("bafo_approve" as never)}
                          </button>
                          <button
                            onClick={() => setDecideTarget({ request: r, step, decision: "rejected" })}
                            className="rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive/90 hover:bg-destructive/20"
                          >
                            {t("bafo_reject" as never)}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <ActionDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title={t("bafo_request_new" as never)}
        submitLabel={t("crm_add")}
        fields={[
          { key: "proposedValue", type: "text", label: t("bafo_proposed_value" as never) },
          { key: "proposedDiscountPct", type: "text", label: t("bafo_proposed_discount_pct" as never) },
          { key: "proposedPaymentTerms", type: "text", label: t("bafo_proposed_payment_terms" as never) },
          { key: "justification", type: "textarea", label: t("bafo_justification" as never), required: true },
        ]}
        onSubmit={async (v) => {
          try {
            await createBafoRequest({
              opportunityId,
              proposedValue: v.proposedValue ? Number(v.proposedValue) : null,
              proposedDiscountPct: v.proposedDiscountPct ? Number(v.proposedDiscountPct) : null,
              proposedPaymentTerms: v.proposedPaymentTerms || null,
              justification: v.justification,
            });
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={!!decideTarget}
        onOpenChange={(o) => { if (!o) setDecideTarget(null); }}
        title={decideTarget ? `${t(`bafo_step_${decideTarget.step}` as never)} — ${t(`bafo_${decideTarget.decision === "approved" ? "approve" : "reject"}` as never)}` : ""}
        submitLabel={decideTarget ? t(`bafo_${decideTarget.decision === "approved" ? "approve" : "reject"}` as never) : ""}
        destructive={decideTarget?.decision === "rejected"}
        fields={[{ key: "notes", type: "textarea", label: t("bafo_decision_notes" as never) }]}
        onSubmit={async (v) => {
          if (!decideTarget) return;
          try {
            await decideBafoStep({
              requestId: decideTarget.request.id,
              step: decideTarget.step,
              decision: decideTarget.decision,
              notes: v.notes || undefined,
            });
            toast.success(t("crm_saved"));
            setDecideTarget(null);
            refresh();
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </Panel>
  );
}
