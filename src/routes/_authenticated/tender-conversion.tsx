import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { approveTenderConversion } from "@/lib/tender-actions";
import { decideApproval } from "@/lib/opportunity-actions";
import { canApproveCommercialAction } from "@/lib/roles";
import { CheckCircle2, XCircle, GitMerge, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tender-conversion")({
  head: () => ({ meta: [{ title: "Tender Conversion — PHC" }, { name: "robots", content: "noindex" }] }),
  component: TenderConversionReview,
});

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function TenderConversionReview() {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const isManager = canApproveCommercialAction(roles);

  const { data, isLoading } = useQuery({
    queryKey: ["tender-conversions"],
    queryFn: async () => {
      const { data: approvals } = await supabase
        .from("approvals")
        .select("*")
        .eq("approval_type", "TENDER_TO_JIH_APPROVAL")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      const tenderIds = (approvals ?? []).map((a: any) => a.linked_record_id).filter(Boolean);
      let tenders: any[] = [];
      if (tenderIds.length) {
        tenders = (
          await supabase
            .from("tenders")
            .select("*, main_contractor:companies!tenders_main_contractor_id_fkey(id, name)")
            .in("id", tenderIds)
        ).data ?? [];
      }
      const byId = new Map(tenders.map((x) => [x.id, x]));
      return (approvals ?? []).map((a: any) => ({ approval: a, tender: byId.get(a.linked_record_id) }));
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tender-conversions"] });
    qc.invalidateQueries({ queryKey: ["tenders"] });
    qc.invalidateQueries({ queryKey: ["approvals"] });
  };

  const rows = data ?? [];

  const kpis = useMemo(() => {
    const totalValue = rows.reduce((s, r) => s + (r.tender?.estimated_project_value ?? 0), 0);
    const missingEvidence = rows.filter((r) => !r.tender?.signage_potential || !r.tender?.main_contractor).length;
    const highValue = rows.filter((r) => (r.tender?.estimated_project_value ?? 0) >= 300000).length;
    return { total: rows.length, totalValue, missingEvidence, highValue };
  }, [rows]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Execution"
        title={t("nav_tender_conversion")}
        description="Decision workspace for converting awarded tenders into JIH opportunities."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t("tc_pending_reviews")} value={kpis.total} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
        <KpiCard label="Combined value" value={<span className="num" data-tabular="true">{formatCurrency(kpis.totalValue, lang, "SAR")}</span>} />
        <KpiCard label="Missing evidence" value={kpis.missingEvidence} />
        <KpiCard label="High value (≥ 300k)" value={kpis.highValue} />
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : rows.length === 0 ? (
        <EmptyState message={t("tc_no_reviews")} />
      ) : (
        <div className="space-y-3">
          {rows.map(({ approval, tender }: any) => {
            const hasContractor = !!tender?.main_contractor;
            const hasSignage = !!tender?.signage_potential;
            const hasValue = tender?.estimated_project_value != null;
            return (
              <div key={approval.id} className="rounded-xl border border-border/70 bg-surface/60 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusPill tone="attention">{t("crm_pending_review")}</StatusPill>
                      {tender?.tender_priority_classification ? (
                        <StatusPill tone="muted">Class {tender.tender_priority_classification}</StatusPill>
                      ) : null}
                    </div>
                    {tender ? (
                      <Link to="/tenders" className="mt-1.5 block text-[15px] font-medium text-foreground hover:underline">
                        {tender.tender_name}
                      </Link>
                    ) : (
                      <div className="mt-1.5 text-[15px] font-medium text-foreground">—</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t("crm_total_value")}</div>
                    <div className="text-lg font-semibold text-foreground num" data-tabular="true">
                      {formatCurrency(tender?.estimated_project_value, lang, "SAR")}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  <EvidenceRow ok={hasContractor} label={t("wf_contractor")} value={tender?.main_contractor?.name} />
                  <EvidenceRow ok={hasSignage} label={t("crm_signage_package")} value={humanize(tender?.signage_potential)} />
                  <EvidenceRow ok={hasValue} label={t("crm_total_value")} value={formatCurrency(tender?.estimated_project_value, lang, "SAR")} />
                  <EvidenceRow ok={!!tender?.expected_award_date} label={t("wf_expected_award")} value={tender?.expected_award_date} />
                  <EvidenceRow ok={!!tender?.tender_priority_classification} label={t("win_confidence_label")} value={humanize(tender?.tender_priority_classification)} />
                  <EvidenceRow ok={!!approval.decision_notes} label={t("wf_notes")} value={approval.decision_notes} />
                </div>

                {isManager ? (
                  <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
                    <button
                      onClick={async () => {
                        try { await decideApproval({ approvalId: approval.id, opportunityId: approval.related_opportunity_id ?? "", decision: "returned" }); toast.success(t("action_return")); refresh(); }
                        catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {t("action_return")}
                    </button>
                    <button
                      onClick={async () => {
                        try { await approveTenderConversion(tender.id, approval.id); toast.success(t("crm_saved")); refresh(); qc.invalidateQueries({ queryKey: ["opportunities"] }); }
                        catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                      {t("tc_approve")}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EvidenceRow({ ok, label, value }: { ok: boolean; label: string; value?: string | null }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {ok ? <CheckCircle2 className="h-3 w-3 text-emerald-300" /> : <XCircle className="h-3 w-3 text-red-300" />}
        {label}
      </div>
      <div className="mt-0.5 truncate text-xs text-foreground">{value || "—"}</div>
    </div>
  );
}
