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
import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, HelpCircle, Eye, XCircle, RotateCcw, ChevronRight, Check, Minus, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { updateInboxItem } from "@/lib/inbox-actions";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { formatCurrency, useI18n } from "@/lib/i18n";
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

/**
 * What a reviewer needs in order to decide, laid out in the four groups the
 * decision actually turns on.
 *
 * Exported because the Lead & Tender Inbox cards below the review queue show
 * the SAME entity and ask for the same kind of judgement (classify, convert,
 * mark duplicate). Two detail renderers over one table would drift; this is
 * the one.
 *
 * Empty fields are shown as "not recorded" rather than hidden. A blank Scope
 * is itself a reason to send a request back for information, and a layout that
 * silently omits it makes the gap invisible at exactly the moment somebody is
 * deciding whether the request is complete enough to price.
 */
export function IntakeDetail({ r }: { r: any }) {
  const { t, lang } = useI18n();
  const dash = t("rev_details_none");

  const Field = ({ label, value }: { label: string; value: unknown }) => {
    const empty = value === null || value === undefined || String(value).trim() === "";
    return (
      <div className="min-w-0">
        <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-sm ${empty ? "text-muted-foreground italic" : "text-foreground"}`}>
          {empty ? dash : String(value)}
        </div>
      </div>
    );
  };

  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <div className="mb-1.5 text-xs font-medium text-foreground">{title}</div>
      <div className="grid gap-2.5 sm:grid-cols-2">{children}</div>
    </div>
  );

  // Three booleans, rendered as present/absent rather than true/false. These
  // were already being fetched by the queue and never shown, and "no BOQ" is
  // the single most common reason a request is not ready for pricing.
  const docs: Array<[string, boolean]> = [
    [t("ibx_has_boq"), r.has_boq === true],
    [t("ibx_has_drawings"), r.has_drawings === true],
    [t("ibx_has_specs"), r.has_specs === true],
  ];

  const money = (v: unknown) =>
    v === null || v === undefined || v === ""
      ? null
      : formatCurrency(Number(v), lang, "SAR");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Group title={t("rev_details_scope")}>
        <Field label={t("ibx_scope")} value={r.scope} />
        <Field
          label={t("ibx_scope_type")}
          value={r.scope_type ? t(`ibx_scope_${r.scope_type}` as never) : null}
        />
        <Field label={t("ibx_estimated_value")} value={money(r.estimated_value)} />
        <Field label={t("ibx_project_number")} value={r.project_number} />
        <Field label={t("ibx_client_rfq_ref")} value={r.client_rfq_reference} />
      </Group>

      <Group title={t("rev_details_docs")}>
        <div className="col-span-full flex flex-wrap gap-1.5">
          {docs.every(([, got]) => !got) ? (
            <span className="text-sm italic text-muted-foreground">{t("rev_details_no_docs")}</span>
          ) : (
            docs.map(([label, got]) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${
                  got ? "border-success/40 text-success" : "border-border text-muted-foreground"
                }`}
              >
                {got ? <Check className="h-3 w-3" aria-hidden="true" /> : <Minus className="h-3 w-3" aria-hidden="true" />}
                {label}
              </span>
            ))
          )}
        </div>
        <Field label={t("ibx_evidence_url")} value={r.evidence_url} />
        <Field label={t("ibx_deadline")} value={r.deadline} />
      </Group>

      <Group title={t("rev_details_parties")}>
        <Field
          label={t("ibx_client_type")}
          value={r.client_type ? t(`ibx_client_type_${r.client_type}` as never) : null}
        />
        <Field label={t("ibx_main_contractor")} value={r.main_contractor} />
        <Field label={t("ibx_consultant")} value={r.consultant} />
        <Field label={t("ibx_contact_name")} value={r.contact_name} />
        <Field label={t("ibx_email")} value={r.email} />
        <Field label={t("ibx_phone")} value={r.phone} />
        <Field label={t("ibx_location_city")} value={r.location_city || r.location} />
      </Group>

      <Group title={t("rev_details_origin")}>
        <Field
          label={t("ibx_project_type")}
          value={r.project_type ? t(`ibx_project_type_${r.project_type}` as never) : null}
        />
        <Field label={t("ibx_source_name")} value={r.source_name} />
        <Field label={t("ibx_date_received")} value={r.date_received} />
        <Field label={t("ibx_internal_rfq_ref")} value={r.internal_rfq_reference} />
        <Field label={t("ibx_notes")} value={r.notes} />
      </Group>
    </div>
  );
}

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

  const [expanded, setExpanded] = useState<string | null>(null);
  const [infoFor, setInfoFor] = useState<any>(null);
  const [rejectFor, setRejectFor] = useState<any>(null);
  const [editFor, setEditFor] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: teamMembers = [] } = useQuery({ queryKey: ["team-members-min"], queryFn: listTeamMembers });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["intake-review-queue"],
    staleTime: 15_000,
    queryFn: async () =>
      (
        await supabase
          .from("inbox_items")
          // Widened for the expandable detail. Approving for pricing creates an
          // opportunity and hands the file to Commercial, and this queue used
          // to show four fields out of the fifty-five the record carries —
          // has_boq / has_drawings / has_specs were already being fetched and
          // then never rendered, which is the whole point of the decision.
          .select(
            "id, project_name, company_name, request_type, review_state, deadline, " +
            "has_boq, has_drawings, has_specs, info_required_items, info_comment, " +
            "info_due_date, resubmit_count, created_at, " +
            "scope, scope_type, estimated_value, contact_name, email, phone, " +
            "main_contractor, consultant, client_type, location, location_city, " +
            "notes, evidence_url, client_rfq_reference, internal_rfq_reference, " +
            "project_number, date_received, source_name, project_type",
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
        <p className="mb-3 rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-muted-foreground">
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
              <tr className="border-b border-border text-start text-xs uppercase tracking-wide text-muted-foreground">
                {/* Client feedback 2026-08-25: these five, in this order. Project
                    Code is new — the number was already fetched and only shown
                    once the row was expanded, so a reviewer scanning the queue
                    could not tell two similarly-named projects apart. The last
                    header said "Pending review", which is a STATE, not a column
                    name — and it sat above a cell that could say something else
                    entirely. */}
                <th className="px-3 py-2 text-start">{t("label_project_name" as never)}</th>
                <th className="px-3 py-2 text-start">{t("label_project_code" as never)}</th>
                <th className="px-3 py-2 text-start">{t("ibx_request_type")}</th>
                <th className="px-3 py-2 text-start">{t("ibx_deadline")}</th>
                <th className="px-3 py-2 text-start">{t("label_status")}</th>
                <th className="px-3 py-2 text-end">—</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => {
                const state = r.review_state as IntakeReviewState;
                const disabled = busy === r.id;
                return (
                  <Fragment key={r.id}>
                  <tr className="border-b border-border/50">
                    <td className="px-3 py-2.5">
                      {/* The row IS the disclosure. A review queue is worked
                          top to bottom; sending someone to a detail page and
                          back for each of ten requests loses their place every
                          time. */}
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                        aria-expanded={expanded === r.id}
                        aria-controls={`intake-detail-${r.id}`}
                        className="flex items-start gap-1.5 text-start hover:underline"
                      >
                        <ChevronRight
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform rtl:-scale-x-100 ${expanded === r.id ? "rotate-90" : ""}`}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="block font-medium text-foreground">{r.project_name || "—"}</span>
                          <span className="block text-xs text-muted-foreground">{r.company_name || "—"}</span>
                        </span>
                      </button>
                      <span className="sr-only">
                        {expanded === r.id ? t("rev_hide_details") : t("rev_show_details")}
                      </span>
                      {state === "need_information" && (
                        <div className="mt-1 text-xs text-amber-light">
                          {(r.info_required_items ?? []).join(" · ") || r.info_comment}
                          {r.info_due_date && ` · ${t("ibx_info_due")}: ${r.info_due_date}`}
                          {r.resubmit_count > 0 && ` · ${t("rev_resubmit_count")}: ${r.resubmit_count}`}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 num" data-tabular="true">
                      {r.project_number || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.request_type ? t(`ibx_rtype_short_${r.request_type}` as never) : "—"}
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
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                          >
                            <RotateCcw className="h-3 w-3" /> {t("rev_resubmit")}
                          </button>
                        )}
                        {canReview && state === "pending_review" && (
                          <>
                            <button
                              disabled={disabled}
                              onClick={() => approve(r)}
                              className="inline-flex items-center gap-1 rounded border border-won/40 bg-won/10 px-2 py-1 text-xs text-won hover:bg-won/20 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3 w-3" /> {t("rev_approve")}
                            </button>
                            <button
                              disabled={disabled}
                              onClick={() => setInfoFor(r)}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                            >
                              <HelpCircle className="h-3 w-3" /> {t("rev_need_info")}
                            </button>
                            <button
                              disabled={disabled}
                              onClick={() => run(r.id, () => monitorIntake(r.id), t("rev_monitored_done"))}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                            >
                              <Eye className="h-3 w-3" /> {t("rev_monitor")}
                            </button>
                            <button
                              disabled={disabled}
                              onClick={() => setRejectFor(r)}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-danger hover:bg-muted disabled:opacity-50"
                            >
                              <XCircle className="h-3 w-3" /> {t("rev_reject")}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr id={`intake-detail-${r.id}`} className="border-b border-border/50 bg-surface-2/40">
                      {/* 6, not 5 — Project Code was added above. A short colSpan
                          leaves the detail panel one column narrow and pushes an
                          empty cell onto the end of the row. */}
                      <td colSpan={6} className="px-3 py-3">
                        <div className="mb-2 flex justify-end">
                          {/* Client feedback 2026-08-25: "ADD EDIT PROJECT DETAILS".
                              A reviewer who spots a wrong deadline or a missing
                              scope could read it here and had no way to correct
                              it — the only actions were approve, reject, ask for
                              information, or monitor. */}
                          <button
                            type="button"
                            onClick={() => setEditFor(r)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                            {t("rev_edit_project_details" as never)}
                          </button>
                        </div>
                        <IntakeDetail r={r} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
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

      {/* Client feedback 2026-08-25: a reviewer could see a wrong deadline or a
          missing scope in the detail panel and had no way to fix it. These are
          the fields the review decision actually turns on — the ones the panel
          above prints as "Not recorded" — not the whole record. */}
      <ActionDialog
        open={!!editFor}
        onOpenChange={(v) => !v && setEditFor(null)}
        title={t("rev_edit_project_details" as never)}
        description={t("rev_edit_project_details_desc" as never)}
        submitLabel={t("action_save")}
        fields={[
          { key: "project_name", type: "text", label: t("label_project_name" as never), defaultValue: editFor?.project_name ?? "" },
          { key: "scope", type: "textarea", label: t("ibx_scope"), defaultValue: editFor?.scope ?? "" },
          { key: "estimated_value", type: "text", label: t("ibx_estimated_value"), defaultValue: editFor?.estimated_value != null ? String(editFor.estimated_value) : "" },
          { key: "deadline", type: "date", label: t("ibx_deadline"), defaultValue: editFor?.deadline ?? "" },
          { key: "main_contractor", type: "text", label: t("ibx_main_contractor"), defaultValue: editFor?.main_contractor ?? "" },
          { key: "consultant", type: "text", label: t("ibx_consultant"), defaultValue: editFor?.consultant ?? "" },
          { key: "notes", type: "textarea", label: t("ibx_notes"), defaultValue: editFor?.notes ?? "" },
        ]}
        onSubmit={async (v) => {
          const id = editFor.id;
          const num = String(v.estimated_value ?? "").trim();
          // An empty value clears the field; a non-numeric one is refused rather
          // than silently written as null, which would read as "no value known".
          let estimated: number | null = null;
          if (num !== "") {
            const parsed = Number(num.replace(/,/g, ""));
            if (!Number.isFinite(parsed)) throw new Error(t("rev_edit_value_invalid" as never));
            estimated = parsed;
          }
          await updateInboxItem(id, {
            project_name: String(v.project_name ?? "").trim() || null,
            scope: String(v.scope ?? "").trim() || null,
            estimated_value: estimated,
            deadline: String(v.deadline ?? "").trim() || null,
            main_contractor: String(v.main_contractor ?? "").trim() || null,
            consultant: String(v.consultant ?? "").trim() || null,
            notes: String(v.notes ?? "").trim() || null,
          });
          toast.success(t("rev_edit_saved" as never));
          setEditFor(null);
          qc.invalidateQueries({ queryKey: ["intake-review-queue"] });
        }}
      />

    </Panel>
  );
}
