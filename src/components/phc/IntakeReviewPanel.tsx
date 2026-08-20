// PHC Sales OS — Opportunity Review queue (Phase 2).
//
// PRD 2026-08-12 §15-19. Every new request lands here before it can go to
// pricing. A Sales Manager OR a BD Manager decides — either alone is enough,
// they do not both have to sign.
//
// The four decisions map onto what actually happens next:
//   Approve for Pricing → routes onto the JIH or Tender track (the same
//                         conversion the form used to run on save)
//   Need Information    → hands it back with what is missing and who owes it
//   Monitor             → real, but not actionable yet; stays visible
//   Reject              → closed, with a reason that is mandatory in the DB
//
// Authority is enforced by the protect_intake_review trigger. This component
// hides what a user cannot do; the database is what prevents it.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, HelpCircle, Eye, XCircle, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { useI18n } from "@/lib/i18n";
import { invalidateSalesData } from "@/lib/invalidate-sales";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canReviewIntake } from "@/lib/roles";
import { listTeamMembers } from "@/lib/opportunity-actions";
import {
  approveIntakeForPricing,
  requestIntakeInformation,
  monitorIntake,
  rejectIntake,
  resubmitIntake,
  type IntakeReviewState,
} from "@/lib/inbox-actions";

const REVIEW_TONE: Record<IntakeReviewState, "attention" | "positive" | "danger" | "muted" | "neutral"> = {
  pending_review: "attention",
  approved_for_pricing: "positive",
  need_information: "attention",
  monitored: "neutral",
  rejected: "danger",
};

export function IntakeReviewPanel() {
  const { t } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const canReview = canReviewIntake(roles);

  const [infoFor, setInfoFor] = useState<any>(null);
  const [rejectFor, setRejectFor] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: teamMembers = [] } = useQuery({ queryKey: ["team-members-min"], queryFn: listTeamMembers });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["intake-review-queue"],
    staleTime: 15_000,
    queryFn: async () =>
      (
        await supabase
          .from("inbox_items")
          .select(
            "id, project_name, company_name, request_type, review_state, deadline, has_boq, has_drawings, has_specs, info_required_items, info_comment, info_due_date, reject_reason, resubmit_count, created_at",
          )
          .in("review_state", ["pending_review", "need_information"])
          .order("created_at", { ascending: true })
          .limit(100)
      ).data ?? [],
  });

  const refresh = () => {
    // Approving intake for pricing creates an opportunity and moves handoff
    // state, which is read under keys this list does not name (opps, ws-*,
    // unified-actions, today-panel).
    invalidateSalesData(qc);
  };

  async function run(id: string, fn: () => Promise<unknown>, okMessage: string) {
    setBusy(id);
    try {
      await fn();
      toast.success(okMessage);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error_generic"));
    } finally {
      setBusy(null);
    }
  }

  async function approve(row: any) {
    setBusy(row.id);
    try {
      const res = await approveIntakeForPricing(row.id);
      toast.success(
        res.routed === "rfq"
          ? t("rev_approved_routed_jih")
          : res.routed === "tender"
            ? t("rev_approved_routed_tender")
            : t("rev_approved_no_route"),
      );
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error_generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title={t("rev_queue_title")} className="mb-6">
      <p className="mb-3 text-xs text-muted-foreground">{t("rev_queue_intro")}</p>
      {!canReview && (
        <p className="mb-3 rounded-md border border-border bg-surface/60 px-3 py-2 text-[11px] text-muted-foreground">
          {t("rev_no_authority")}
        </p>
      )}

      {isLoading ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState message={t("rev_empty")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-start text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-start">{t("label_project")}</th>
                <th className="px-3 py-2 text-start">{t("ibx_request_type")}</th>
                <th className="px-3 py-2 text-start">{t("ibx_deadline")}</th>
                <th className="px-3 py-2 text-start">{t("rev_state_pending_review")}</th>
                <th className="px-3 py-2 text-end">—</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => {
                const state = r.review_state as IntakeReviewState;
                const disabled = busy === r.id;
                return (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-foreground">{r.project_name || "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{r.company_name || "—"}</div>
                      {state === "need_information" && (
                        <div className="mt-1 text-[11px] text-amber-light">
                          {(r.info_required_items ?? []).join(" · ") || r.info_comment}
                          {r.resubmit_count > 0 && ` · ${t("rev_resubmit_count")}: ${r.resubmit_count}`}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.request_type ? t(`ibx_request_type_${r.request_type}` as never) : "—"}
                    </td>
                    <td className="px-3 py-2.5 num" data-tabular="true">{r.deadline ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill tone={REVIEW_TONE[state]}>{t(`rev_state_${state}` as never)}</StatusPill>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {state === "need_information" && (
                          <button
                            disabled={disabled}
                            onClick={() => run(r.id, () => resubmitIntake(r.id), t("rev_resubmitted"))}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
                          >
                            <RotateCcw className="h-3 w-3" /> {t("rev_resubmit")}
                          </button>
                        )}
                        {canReview && state === "pending_review" && (
                          <>
                            <button
                              disabled={disabled}
                              onClick={() => approve(r)}
                              className="inline-flex items-center gap-1 rounded border border-won/40 bg-won/10 px-2 py-1 text-[11px] text-won hover:bg-won/20 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3 w-3" /> {t("rev_approve")}
                            </button>
                            <button
                              disabled={disabled}
                              onClick={() => setInfoFor(r)}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
                            >
                              <HelpCircle className="h-3 w-3" /> {t("rev_need_info")}
                            </button>
                            <button
                              disabled={disabled}
                              onClick={() => run(r.id, () => monitorIntake(r.id), t("rev_monitored_done"))}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
                            >
                              <Eye className="h-3 w-3" /> {t("rev_monitor")}
                            </button>
                            <button
                              disabled={disabled}
                              onClick={() => setRejectFor(r)}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-danger hover:bg-muted disabled:opacity-50"
                            >
                              <XCircle className="h-3 w-3" /> {t("rev_reject")}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ActionDialog
        open={!!infoFor}
        onOpenChange={(v) => !v && setInfoFor(null)}
        title={t("rev_need_info")}
        submitLabel={t("rev_need_info")}
        fields={[
          { key: "requiredItems", type: "textarea", label: t("rev_required_items"), placeholder: t("rev_required_items_hint") },
          { key: "comment", type: "textarea", label: t("rev_comment") },
          {
            key: "responsibleId",
            type: "select",
            label: t("rev_responsible"),
            options: [{ value: "", label: "—" }, ...teamMembers.map((m: any) => ({ value: m.id, label: m.full_name ?? m.email }))],
          },
          { key: "dueDate", type: "date", label: t("rev_due_date") },
        ]}
        onSubmit={async (v) => {
          const id = infoFor.id;
          setInfoFor(null);
          await run(
            id,
            () =>
              requestIntakeInformation(id, {
                requiredItems: (v.requiredItems ?? "").split("\n"),
                comment: v.comment,
                responsibleId: v.responsibleId || null,
                dueDate: v.dueDate || null,
              }),
            t("rev_info_requested"),
          );
        }}
      />

      <ActionDialog
        open={!!rejectFor}
        onOpenChange={(v) => !v && setRejectFor(null)}
        title={t("rev_reject")}
        submitLabel={t("rev_reject")}
        fields={[{ key: "reason", type: "textarea", label: t("rev_reject_reason"), required: true }]}
        onSubmit={async (v) => {
          const id = rejectFor.id;
          setRejectFor(null);
          await run(id, () => rejectIntake(id, v.reason ?? ""), t("rev_rejected_done"));
        }}
      />
    </Panel>
  );
}
