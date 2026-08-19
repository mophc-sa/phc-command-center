import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Clock, CheckCircle2, AlertTriangle, Inbox, Percent } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { decideApproval } from "@/lib/opportunity-actions";
import { decideBafoStep } from "@/lib/bafo-actions";
import { approveIntakeForPricing, rejectIntake, requestIntakeInformation } from "@/lib/inbox-actions";
import { executeDelete, DELETABLE_ENTITY_TYPES } from "@/lib/record-lifecycle-actions";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canApproveCommercialAction, canExecuteDelete } from "@/lib/roles";
import {
  ageDays,
  canDecide,
  currentBafoStep,
  fromBafo,
  fromIntakeApproval,
  fromRecordApproval,
  sortApprovals,
  type BafoRowIn,
  type IntakeApprovalRowIn,
  type RecordApprovalRowIn,
  type UnifiedApproval,
} from "@/lib/approvals-center";
import { humanize } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({ meta: [{ title: "Approvals — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ApprovalsPage,
});

type Decision = "approved" | "returned" | "escalated";

type DecideTarget =
  | { kind: "record"; id: string; oppId: string; decision: Decision }
  | { kind: "bafo"; id: string; step: string; decision: "approved" | "rejected" }
  | { kind: "intake"; id: string; decision: "approve" | "reject" | "info" };

const KIND_ICON = { record: ShieldCheck, bafo: Percent, intake: Inbox } as const;

function ApprovalsPage() {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const canExecute = canExecuteDelete(roles);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "recent">("pending");
  const [decideFor, setDecideFor] = useState<DecideTarget | null>(null);
  const [executeFor, setExecuteFor] = useState<{ id: string } | null>(null);

  // ── The three approval workflows ──────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["approvals-unified", filter],
    queryFn: async () => {
      const [recs, bafos, intake] = await Promise.all([
        supabase
          .from("approvals")
          .select("*, opportunities(id, project_name, client)")
          .order("created_at", { ascending: filter === "pending" })
          .limit(200),
        supabase.from("bafo_requests").select("*").order("created_at", { ascending: false }).limit(200),
        supabase
          .from("inbox_items")
          .select(
            "id, project_name, company_name, review_state, request_type, created_by, assigned_owner_id, review_notes, reject_reason, has_boq, has_drawings, has_specs, created_at, reviewed_at",
          )
          .not("review_state", "is", null)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (recs.error) throw recs.error;

      const bafoRows = (bafos.data ?? []) as unknown as BafoRowIn[];
      // One lookup for the project names the BAFO rows point at.
      const oppIds = [...new Set(bafoRows.map((b) => b.opportunity_id).filter(Boolean) as string[])];
      const names = new Map<string, string | null>();
      if (oppIds.length) {
        const { data: opps } = await supabase.from("opportunities").select("id, project_name").in("id", oppIds);
        for (const o of opps ?? []) names.set(o.id, o.project_name);
      }

      return {
        list: sortApprovals([
          ...((recs.data ?? []) as unknown as RecordApprovalRowIn[]).map(fromRecordApproval),
          ...bafoRows.map((b) => fromBafo(b, b.opportunity_id ? names.get(b.opportunity_id) : null)),
          ...((intake.data ?? []) as unknown as IntakeApprovalRowIn[]).map(fromIntakeApproval),
        ]),
        // kept so canDecide can resolve which BAFO step is live
        bafoById: new Map(bafoRows.map((b) => [b.id, b])),
        rawRecords: new Map(((recs.data ?? []) as unknown as RecordApprovalRowIn[]).map((r) => [r.id, r])),
      };
    },
  });

  const list = data?.list ?? [];
  const shown = useMemo(
    () => (filter === "pending" ? list.filter((a) => a.state === "pending") : list.slice(0, 60)),
    [list, filter],
  );

  const kpis = useMemo(() => {
    const pending = list.filter((a) => a.state === "pending");
    const oldest = pending.reduce((m, a) => {
      const d = ageDays(a.submittedAt);
      return d != null && d > m ? d : m;
    }, 0);
    return {
      pending: pending.length,
      oldest,
      approved: list.filter((a) => a.state === "approved").length,
      intake: pending.filter((a) => a.kind === "intake").length,
    };
  }, [list]);

  // Nothing at all is decidable by this viewer → say so once, at the top.
  const canDecideAnything = useMemo(
    () => list.some((a) => canDecide(a, roles, data?.bafoById.get(a.sourceRecordId))),
    [list, roles, data],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["approvals-unified"] });
    qc.invalidateQueries({ queryKey: ["unified-actions"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["cc-metrics"] });
  };

  async function submitDecision(values: Record<string, string>) {
    if (!decideFor) return;
    try {
      if (decideFor.kind === "record") {
        await decideApproval({
          approvalId: decideFor.id,
          opportunityId: decideFor.oppId,
          decision: decideFor.decision,
          notes: values.notes,
        });
      } else if (decideFor.kind === "bafo") {
        await decideBafoStep({
          requestId: decideFor.id,
          step: decideFor.step as never,
          decision: decideFor.decision,
          notes: values.notes,
        });
      } else if (decideFor.decision === "approve") {
        await approveIntakeForPricing(decideFor.id);
      } else if (decideFor.decision === "reject") {
        await rejectIntake(decideFor.id, values.notes);
      } else {
        // The reviewer types the outstanding items one per line, matching
        // IntakeReviewPanel's own contract for this field.
        await requestIntakeInformation(decideFor.id, {
          requiredItems: (values.requiredItems ?? "").split("\n").map((x) => x.trim()).filter(Boolean),
          comment: values.notes,
        });
      }
      toast.success(t("toast_approve_ok"));
      invalidate();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Governance"
        title={t("nav_approvals")}
        description={
          lang === "ar"
            ? "قائمة قرارات موحدة: مراجعة الطلبات الواردة، سلسلة BAFO، واعتمادات السجلات."
            : "One decision queue: intake review, the BAFO chain, and record approvals."
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pending" value={kpis.pending} icon={<Clock className="h-3.5 w-3.5" />} />
        <KpiCard label="Oldest waiting" value={`${kpis.oldest}d`} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <KpiCard label="Intake reviews" value={kpis.intake} icon={<Inbox className="h-3.5 w-3.5" />} />
        <KpiCard label="Approved" value={kpis.approved} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
      </div>

      {!canDecideAnything && !isLoading ? (
        <div className="mb-4 rounded-md border border-border bg-surface/60 px-4 py-3 text-xs text-muted-foreground">
          {t("approvals_forbidden")}
        </div>
      ) : null}

      <div className="mb-4 flex gap-1.5 text-xs">
        {(["pending", "recent"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1.5 transition-colors ${
              filter === f
                ? "border-amber/40 bg-amber/10 text-amber-light"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "pending" ? (lang === "ar" ? "قيد الانتظار" : "Pending") : lang === "ar" ? "الأحدث" : "Recent"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <SkeletonTable rows={5} />
      ) : isError ? (
        <div className="rounded-xl border border-border/70 bg-surface/60 p-6 text-sm">
          <div className="text-foreground">{t("approvals_error")}</div>
          <button onClick={() => refetch()} className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted">
            {t("retry")}
          </button>
        </div>
      ) : shown.length === 0 ? (
        <EmptyState message={t("empty_approvals")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          {shown.map((a) => {
            const raw = data?.bafoById.get(a.sourceRecordId);
            const decidable = canDecide(a, roles, raw);
            const age = ageDays(a.submittedAt);
            const urgent = a.state === "pending" && age != null && age >= 3;
            const Icon = KIND_ICON[a.kind];
            const rec = a.kind === "record" ? data?.rawRecords.get(a.sourceRecordId) : undefined;

            return (
              <div
                key={a.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border/60 px-5 py-4 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={a.state === "approved" ? "positive" : a.state === "rejected" ? "danger" : "attention"}>
                      <Icon className="h-3 w-3" />
                      {humanize(a.approvalType)}
                    </StatusPill>
                    {a.step ? <StatusPill tone="neutral">{a.step}</StatusPill> : null}
                    <StatusPill tone="muted">{a.requiredRole}</StatusPill>
                    {a.state === "pending" && age != null ? (
                      <span className={`num text-[11px] ${urgent ? "text-destructive/80" : "text-muted-foreground"}`} data-tabular="true">
                        {age}d waiting
                      </span>
                    ) : null}
                  </div>

                  {a.entityLabel ? (
                    a.entityId && a.kind !== "intake" ? (
                      <Link
                        to="/opportunities/$id"
                        params={{ id: a.entityId }}
                        className="mt-1.5 block truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {a.entityLabel}
                      </Link>
                    ) : (
                      <Link to={a.href as never} className="mt-1.5 block truncate text-sm font-medium text-foreground hover:underline">
                        {a.entityLabel}
                      </Link>
                    )
                  ) : null}

                  {a.clientContext ? <div className="mt-0.5 text-[11px] text-muted-foreground">{a.clientContext}</div> : null}
                  {a.evidence ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      <span className="text-amber-light">Evidence:</span> {a.evidence}
                    </div>
                  ) : null}
                  {a.notes ? <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.notes}</div> : null}
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  {rec &&
                  rec.approval_type &&
                  (rec as { requested_action?: string }).requested_action === "delete_record" &&
                  (DELETABLE_ENTITY_TYPES as readonly string[]).includes((rec as { linked_record_type?: string }).linked_record_type ?? "") &&
                  a.state === "approved" &&
                  (rec as { execution_status?: string }).execution_status !== "executed" &&
                  canExecute ? (
                    <button
                      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 font-medium text-destructive/90 transition-colors duration-150 hover:bg-destructive/[0.16]"
                      onClick={() => setExecuteFor({ id: a.sourceRecordId })}
                    >
                      {t("lifecycle_execute_delete")}
                    </button>
                  ) : null}

                  {decidable ? (
                    <>
                      <button
                        className="rounded-md border border-won/40 bg-won/10 px-3 py-1.5 font-medium text-won transition-colors duration-150 hover:bg-won/[0.16]"
                        onClick={() =>
                          setDecideFor(
                            a.kind === "record"
                              ? { kind: "record", id: a.sourceRecordId, oppId: a.entityId ?? "", decision: "approved" }
                              : a.kind === "bafo"
                                ? { kind: "bafo", id: a.sourceRecordId, step: currentBafoStep(raw!)!, decision: "approved" }
                                : { kind: "intake", id: a.sourceRecordId, decision: "approve" },
                          )
                        }
                      >
                        {t("action_approve")}
                      </button>

                      {a.kind === "intake" ? (
                        <button
                          className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-amber-light hover:bg-amber/20"
                          onClick={() => setDecideFor({ kind: "intake", id: a.sourceRecordId, decision: "info" })}
                        >
                          {t("rev_need_info")}
                        </button>
                      ) : null}

                      <button
                        className="rounded-md border border-border bg-surface px-3 py-1.5 text-foreground hover:bg-muted"
                        onClick={() =>
                          setDecideFor(
                            a.kind === "record"
                              ? { kind: "record", id: a.sourceRecordId, oppId: a.entityId ?? "", decision: "returned" }
                              : a.kind === "bafo"
                                ? { kind: "bafo", id: a.sourceRecordId, step: currentBafoStep(raw!)!, decision: "rejected" }
                                : { kind: "intake", id: a.sourceRecordId, decision: "reject" },
                          )
                        }
                      >
                        {t("action_return")}
                      </button>
                    </>
                  ) : (
                    <Link
                      to={a.href as never}
                      className="rounded-md border border-border bg-surface px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {t("action_review")}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ActionDialog
        open={!!decideFor}
        onOpenChange={(v) => !v && setDecideFor(null)}
        title={
          decideFor?.kind === "intake" && decideFor.decision === "info"
            ? t("rev_need_info")
            : decideFor && "decision" in decideFor && (decideFor.decision === "approved" || decideFor.decision === "approve")
              ? t("dialog_approve_title")
              : t("dialog_return_title")
        }
        description={
          decideFor && "decision" in decideFor && (decideFor.decision === "approved" || decideFor.decision === "approve")
            ? t("dialog_approve_desc")
            : t("dialog_return_desc")
        }
        submitLabel={
          decideFor && "decision" in decideFor && (decideFor.decision === "approved" || decideFor.decision === "approve")
            ? t("action_approve")
            : t("action_return")
        }
        destructive={
          !!decideFor && "decision" in decideFor && decideFor.decision !== "approved" && decideFor.decision !== "approve"
        }
        fields={[
          ...(decideFor?.kind === "intake" && decideFor.decision === "info"
            ? ([
                {
                  key: "requiredItems",
                  type: "textarea",
                  label: t("rev_required_items"),
                  placeholder: t("rev_required_items_hint"),
                  required: true,
                },
              ] as const)
            : []),
          {
            key: "notes",
            type: "textarea",
            label: t("field_notes"),
            required: !!decideFor && "decision" in decideFor && decideFor.decision !== "approved" && decideFor.decision !== "approve",
          },
        ]}
        onSubmit={submitDecision}
      />

      <ActionDialog
        open={!!executeFor}
        onOpenChange={(v) => !v && setExecuteFor(null)}
        title={t("lifecycle_execute_delete")}
        description={t("lifecycle_execute_delete_desc")}
        submitLabel={t("lifecycle_execute_delete")}
        destructive
        fields={[]}
        onSubmit={async () => {
          try {
            await executeDelete({ approvalId: executeFor!.id });
            toast.success(t("lifecycle_executed_toast"));
            invalidate();
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}

export { canApproveCommercialAction };
