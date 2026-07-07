import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { Panel } from "@/components/phc/Panel";
import { DataField } from "@/components/phc/DataField";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { approveTenderConversion } from "@/lib/tender-actions";
import { decideApproval } from "@/lib/opportunity-actions";

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
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const isManager = hasAnyRole(["sales_manager", "ceo"]);

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

  if (isLoading) return <EmptyState message={t("loading")} />;
  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeader title={t("nav_tender_conversion")} count={rows.length} hint={t("tc_pending_reviews")} />
      {rows.length === 0 ? (
        <EmptyState message={t("tc_no_reviews")} />
      ) : (
        <div className="space-y-4">
          {rows.map(({ approval, tender }: any) => (
            <Panel key={approval.id} title={tender?.tender_name ?? "—"} tone="attention">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <DataField label={t("wf_contractor")} value={tender?.main_contractor?.name} />
                <DataField label={t("crm_signage_package")} value={humanize(tender?.signage_potential)} />
                <DataField label={t("crm_total_value")} value={formatCurrency(tender?.estimated_project_value, lang, "SAR")} mono />
                <DataField label={t("wf_expected_award")} value={tender?.expected_award_date} />
                <DataField label={t("win_confidence_label")} value={humanize(tender?.tender_priority_classification)} />
                <DataField label={t("wf_notes")} value={approval.decision_notes} />
              </div>
              {isManager ? (
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={async () => {
                      try { await decideApproval({ approvalId: approval.id, opportunityId: approval.related_opportunity_id ?? "", decision: "returned" }); toast.success(t("action_return")); refresh(); }
                      catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t("action_return")}
                  </button>
                  <button
                    onClick={async () => {
                      try { await approveTenderConversion(tender.id, approval.id); toast.success(t("crm_saved")); refresh(); qc.invalidateQueries({ queryKey: ["opportunities"] }); }
                      catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                    }}
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20"
                  >
                    {t("tc_approve")}
                  </button>
                </div>
              ) : (
                <div className="mt-3"><StatusPill tone="attention">{t("crm_pending_review")}</StatusPill></div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
