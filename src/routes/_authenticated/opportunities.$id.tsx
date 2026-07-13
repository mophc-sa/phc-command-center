import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, formatCurrency, formatNumber, type Lang } from "@/lib/i18n";
import { Panel } from "@/components/phc/Panel";
import { DataField } from "@/components/phc/DataField";
import { StatusPill } from "@/components/phc/StatusPill";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonForm } from "@/components/phc/Skeleton";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import {
  requestReview,
  scheduleFollowUp,
  rescheduleFollowUp,
  assignOwner,
  escalateOpportunity,
  completeFollowUp,
  listTeamMembers,
  decideApproval,
  updateOpportunityStage,
  recomputeOpportunityScore,
  overrideOpportunityScore,
} from "@/lib/opportunity-actions";
import { ArrowLeft, ArrowRight, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { CommunicationActions } from "@/components/phc/CommunicationActions";
import { CommunicationTimeline } from "@/components/phc/CommunicationTimeline";
import { RecordLifecycleMenu } from "@/components/phc/RecordLifecycleMenu";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canManageSalesPipeline } from "@/lib/roles";
import type { OpportunityScoreTier } from "@/lib/opportunity-scoring";

export const Route = createFileRoute("/_authenticated/opportunities/$id")({
  head: () => ({
    meta: [
      { title: "Opportunity — PHC" },
      { name: "description", content: "Opportunity detail with evidence and decisions." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OpportunityDetail,
});

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(d: string | null | undefined, lang: Lang) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function recToTone(r: string | null | undefined): "attention" | "positive" | "danger" | "muted" {
  switch (r) {
    case "approve":
    case "advance":
    case "quote":
      return "positive";
    case "hold":
    case "review":
    case "escalate":
      return "attention";
    case "exclude":
    case "reject":
      return "danger";
    default:
      return "muted";
  }
}

type ActionKind = "review" | "approve" | "schedule" | "assign" | "escalate" | null;
type TimelineFilter = "all" | "alert" | "evidence" | "decision" | "assignment" | "follow_up" | "outcome";

function OpportunityDetail() {
  const { id } = Route.useParams();
  const { t, lang, dir } = useI18n();
  const qc = useQueryClient();
  const [action, setAction] = useState<ActionKind>(null);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [decideFor, setDecideFor] = useState<{ id: string; kind: "approved" | "returned" } | null>(
    null,
  );
  const [evidenceOpen, setEvidenceOpen] = useState<any | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const show = (k: TimelineFilter) => filter === "all" || filter === k;
  const [scoring, setScoring] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const { user, roles } = useAuth();
  const canScore = canManageSalesPipeline(roles);

  const teamQ = useQuery({ queryKey: ["team"], queryFn: listTeamMembers });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["opp", id] });
    qc.invalidateQueries({ queryKey: ["opp-fu", id] });
    qc.invalidateQueries({ queryKey: ["opp-app", id] });
    qc.invalidateQueries({ queryKey: ["cc-metrics"] });
    qc.invalidateQueries({ queryKey: ["all-followups"] });
    qc.invalidateQueries({ queryKey: ["approvals"] });
  };

  const runSafe = async (fn: () => Promise<unknown>, okKey: Parameters<typeof t>[0]) => {
    try {
      await fn();
      toast.success(t(okKey));
      invalidate();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  };


  const oppQ = useQuery({
    queryKey: ["opp", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select(
          "*, company:companies!opportunities_company_id_fkey(id, name), contractor_company:companies!opportunities_main_contractor_id_fkey(id, name), project:projects!opportunities_project_id_fkey(id, name)",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data as any;
    },
  });

  const stakeholdersQ = useQuery({
    queryKey: ["opp-stake", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("stakeholders")
        .select("*")
        .eq("opportunity_id", id)
        .order("contact_order", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const evidenceQ = useQuery({
    queryKey: ["opp-ev", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("evidence_sources")
        .select("*")
        .eq("related_opportunity_id", id)
        .order("source_date", { ascending: false, nullsFirst: false });
      return data ?? [];
    },
  });

  const followUpsQ = useQuery({
    queryKey: ["opp-fu", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("follow_ups")
        .select("*")
        .eq("opportunity_id", id)
        .order("due_date", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const approvalsQ = useQuery({
    queryKey: ["opp-app", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("approvals")
        .select("*")
        .eq("related_opportunity_id", id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  if (oppQ.isLoading) return <SkeletonForm />;
  const o = oppQ.data;
  if (!o) {
    return (
      <div className="mx-auto max-w-7xl">
        <EmptyState message={t("not_found")} />
      </div>
    );
  }

  const val = o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min;
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const recTone = recToTone(o.agent_recommendation);
  const canActOnScore = canScore || o.owner_id === user?.id;
  const scoreTierTone = (tier: string | null | undefined): "positive" | "attention" | "danger" | "muted" =>
    tier === "A" ? "positive" : tier === "B" ? "attention" : tier === "C" ? "muted" : tier === "not_qualified" ? "danger" : "muted";
  const scoreTierLabel = (tier: string | null | undefined) => (tier === "not_qualified" ? t("score_not_qualified") : tier ?? "—");

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      {/* Breadcrumb + Page header */}
      <div>
        <Link to="/opportunities" search={{ q: "", stage: "all", tier: "all", view: "cards" }} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <BackIcon className="h-3.5 w-3.5" />
          {t("nav_opportunities")}
        </Link>
        <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {t("nav_opportunities")}
            </div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-foreground md:text-[30px]">
              {o.project ? (
                <Link to="/projects/$id" params={{ id: o.project.id }} className="hover:underline">
                  {o.project_name}
                </Link>
              ) : (
                o.project_name
              )}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {o.company ? (
                <Link to="/accounts/$id" params={{ id: o.company.id }} className="hover:underline">
                  {o.company.name}
                </Link>
              ) : (
                o.client ?? "—"
              )}
              {o.contractor_company ? (
                <>
                  {" · "}
                  <Link to="/accounts/$id" params={{ id: o.contractor_company.id }} className="hover:underline">
                    {o.contractor_company.name}
                  </Link>
                </>
              ) : o.main_contractor ? (
                ` · ${o.main_contractor}`
              ) : (
                ""
              )}
              {o.location ? ` · ${o.location}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={o.tier === "A" ? "attention" : "neutral"}>
              {t("label_tier")} {o.tier}
            </StatusPill>
            <StatusPill tone="muted">{humanize(o.stage)}</StatusPill>
            {o.agent_recommendation ? (
              <StatusPill tone={recTone}>{humanize(o.agent_recommendation)}</StatusPill>
            ) : null}
            <RecordLifecycleMenu entityType="opportunities" entityId={o.id} roles={roles} onDone={invalidate} />
          </div>
        </div>
      </div>


      {/* Activity Timeline filters */}
      <TimelineFilterBar value={filter} onChange={setFilter} t={t} />

      {/* 1. KEY FACTS + ACTIONS */}
      {show("alert") && (
      <Panel
        title={t("section_alert")}
        tone={recTone === "attention" || recTone === "danger" ? "attention" : "default"}
      >
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <DataField label={t("label_quotation")} value={formatCurrency(val, lang, o.currency)} mono />
            <DataField
              label={t("label_value_range")}
              value={
                o.estimated_value_min || o.estimated_value_max
                  ? `${formatCurrency(o.estimated_value_min, lang, o.currency)} – ${formatCurrency(o.estimated_value_max, lang, o.currency)}`
                  : "—"
              }
              mono
            />
            <DataField label={t("label_next_action")} value={o.next_action} />
            <DataField label={t("label_due")} value={fmtDate(o.next_action_due, lang)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton primary onClick={() => setAction("review")}>{t("action_review")}</ActionButton>
            <ActionButton onClick={() => setAction("approve")}>{t("action_approve")}</ActionButton>
            <ActionButton onClick={() => setAction("schedule")}>{t("action_schedule")}</ActionButton>
            <ActionButton onClick={() => setAction("assign")}>{t("action_assign")}</ActionButton>
            <ActionButton onClick={() => setAction("escalate")}>{t("action_escalate")}</ActionButton>
            {(() => {
              const primary = (stakeholdersQ.data ?? []).find((s: any) => !!s.email) ?? (stakeholdersQ.data ?? [])[0];
              return (
                <CommunicationActions
                  linked={{
                    type: "opportunity",
                    id: o.id,
                    label: o.project_name,
                    opportunityId: o.id,
                    companyId: o.company?.id ?? null,
                    contactId: primary?.id ?? null,
                  }}
                  recipientName={primary?.name ?? null}
                  recipientEmail={primary?.email ?? null}
                  recipientPhone={primary?.phone ?? null}
                  emailTemplate="opportunity_follow_up"
                  emailContext={{
                    companyName: o.company?.name ?? o.client ?? null,
                    projectName: o.project_name,
                    opportunityName: o.project_name,
                    currentStage: humanize(o.stage),
                    nextAction: o.next_action,
                    aiRecommendation: o.agent_recommendation ? humanize(o.agent_recommendation) : null,
                  }}
                />
              );
            })()}
          </div>
        </div>
      </Panel>
      )}


      {/* 2. QUALIFICATION — under Alert */}
      {show("alert") && (
      <Panel title={t("section_qualification")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DataField label={t("label_project_stage")} value={humanize(o.project_stage)} />
          <DataField label={t("pipeline_step_label")} value={humanize(o.pipeline_step)} />
          <DataField label={t("label_package_status")} value={humanize(o.signage_package_status)} />
          <DataField
            label={t("label_package_confidence")}
            value={humanize(o.signage_package_confidence)}
          />
          <DataField
            label={t("label_budget_confirmed")}
            value={o.package_budget_confirmed ? t("yes") : t("no")}
          />
          <DataField
            label={t("label_contractor_confirmed")}
            value={o.main_contractor_confirmed ? t("yes") : t("no")}
          />
          <DataField label={t("label_decision_maker")} value={o.contractor_decision_maker} />
          <DataField label={t("label_prequal")} value={o.prequalification_status} />
          <DataField label={t("label_strategic_value")} value={o.strategic_value} />
          <DataField label={t("label_sector")} value={o.sector} />
        </div>
      </Panel>
      )}

      {/* 3. STAKEHOLDERS — assignment context */}
      {show("assignment") && (
      <Panel title={t("section_stakeholders")}>
        {stakeholdersQ.data && stakeholdersQ.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {stakeholdersQ.data.map((s: any) => (
              <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{s.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[s.role, s.organization].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {s.email || s.phone ? (
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {[s.email, s.phone].filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                </div>
                <div className="text-right rtl:text-left">
                  {s.contact_confidence ? (
                    <StatusPill
                      tone={
                        s.contact_confidence === "high"
                          ? "positive"
                          : s.contact_confidence === "low"
                            ? "muted"
                            : "neutral"
                      }
                    >
                      {humanize(s.contact_confidence)}
                    </StatusPill>
                  ) : null}
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {fmtDate(s.last_interaction_at, lang)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message="—" />
        )}
      </Panel>
      )}

      {/* 4. EVIDENCE */}
      {show("evidence") && (
      <Panel
        title={t("section_evidence")}
        subtitle={`${formatNumber(evidenceQ.data?.length ?? 0, lang)} · ${humanize(o.source_confidence)}`}
      >
        {evidenceQ.data && evidenceQ.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {evidenceQ.data.map((e: any) => (
              <li
                key={e.id}
                className="-mx-2 grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] gap-3 rounded px-2 py-3 transition-colors hover:bg-muted/40"
                onClick={() => setEvidenceOpen(e)}
              >
                <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground">{e.source_title || e.source_type}</div>
                  {e.extracted_summary ? (
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {e.extracted_summary}
                    </div>
                  ) : null}
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{humanize(e.source_type)}</span>
                    <span>·</span>
                    <span>{fmtDate(e.source_date, lang)}</span>
                    {e.confidence_level ? (
                      <>
                        <span>·</span>
                        <span>{humanize(e.confidence_level)}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                {e.source_url ? (
                  <a
                    href={e.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message={t("empty_evidence")} />
        )}
      </Panel>
      )}

      {/* 5. FOLLOW-UPS */}
      {show("follow_up") && (
      <Panel title={t("section_follow_ups")}>
        {followUpsQ.data && followUpsQ.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {followUpsQ.data.map((f: any) => {
              const overdue =
                f.due_date && f.status !== "completed" && new Date(f.due_date) < new Date();
              return (
                <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">
                      {humanize(f.channel)} · {humanize(f.cadence_tier)}
                    </div>
                    {f.notes ? (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.notes}</div>
                    ) : null}
                  </div>
                  <div className="text-right rtl:text-left">
                    <StatusPill
                      tone={
                        f.status === "completed"
                          ? "positive"
                          : overdue
                            ? "attention"
                            : "neutral"
                      }
                    >
                      {overdue ? "Overdue" : humanize(f.status)}
                    </StatusPill>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t("label_due")}: {fmtDate(f.due_date, lang)}
                    </div>
                    {f.status !== "completed" ? (
                      <div className="mt-1.5 flex justify-end gap-3 text-[11px] rtl:justify-start">
                        <button
                          onClick={() => setCompleteId(f.id)}
                          className="text-amber-light hover:underline"
                        >
                          {t("action_complete")}
                        </button>
                        <button
                          onClick={() => setRescheduleId(f.id)}
                          className="text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {t("action_reschedule")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState message={t("empty_follow_ups")} />
        )}
      </Panel>
      )}

      {/* 6. APPROVALS & DECISIONS + logged outcomes */}
      {(show("decision") || show("outcome")) && (
      <Panel title={t("section_approvals")}>
        {approvalsQ.data && approvalsQ.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {approvalsQ.data.map((a: any) => (
              <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground">{humanize(a.approval_type)}</div>
                  {a.decision_notes ? (
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {a.decision_notes}
                    </div>
                  ) : null}
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {fmtDate(a.decided_at ?? a.created_at, lang)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 rtl:items-start">
                  {a.recommendation ? (
                    <StatusPill tone="muted">{humanize(a.recommendation)}</StatusPill>
                  ) : null}
                  <StatusPill
                    tone={
                      a.decision === "approved" || a.status === "approved"
                        ? "positive"
                        : a.status === "returned"
                          ? "danger"
                          : "attention"
                    }
                  >
                    {humanize(a.decision ?? a.status)}
                  </StatusPill>
                  {a.status === "pending" ? (
                    <div className="mt-1 flex gap-2 text-[11px]">
                      <button
                        onClick={() => setDecideFor({ id: a.id, kind: "approved" })}
                        className="text-amber-light hover:underline"
                      >
                        {t("action_approve")}
                      </button>
                      <button
                        onClick={() => setDecideFor({ id: a.id, kind: "returned" })}
                        className="text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {t("action_return")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message={t("empty_approvals")} />
        )}
      </Panel>
      )}

      {/* 7. REASONING */}
      {show("decision") && (
      <Panel title={t("section_reasoning")}>
        <div className="grid gap-4">
          <DataField label={t("label_recommendation")} value={humanize(o.agent_recommendation)} />
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t("label_reasoning")}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {o.agent_reasoning || "—"}
            </p>
          </div>
          {o.management_review_reason ? (
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Management review
              </div>
              <p className="mt-2 text-sm text-foreground">{o.management_review_reason}</p>
            </div>
          ) : null}
        </div>
      </Panel>
      )}

      {/* 7b. SCORING — Sprint 4 */}
      {show("decision") && (
      <Panel
        title={t("section_scoring")}
        action={
          canActOnScore ? (
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  setScoring(true);
                  try {
                    await recomputeOpportunityScore(o.id);
                    toast.success(t("crm_saved"));
                    qc.invalidateQueries({ queryKey: ["opp", id] });
                  } catch (e) {
                    toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                  } finally {
                    setScoring(false);
                  }
                }}
                disabled={scoring}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${scoring ? "animate-spin" : ""}`} />
                {t("score_recalculate")}
              </button>
              <button
                onClick={() => setOverrideOpen(true)}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("score_override")}
              </button>
            </div>
          ) : undefined
        }
      >
        {o.scored_at == null ? (
          <EmptyState message={t("score_never_scored")} />
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              <DataField label={t("score_label")} value={<span className="num" data-tabular="true">{o.score}/100</span>} />
              <DataField
                label={t("score_tier_label")}
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <StatusPill tone={scoreTierTone(o.score_tier)}>{scoreTierLabel(o.score_tier)}</StatusPill>
                    {o.score_manual_override ? <StatusPill tone="attention">{t("score_overridden_badge")}</StatusPill> : null}
                  </span>
                }
              />
              <DataField label={t("score_confidence_label")} value={humanize(o.score_confidence)} />
              <DataField label={t("score_last_scored")} value={fmtDate(o.scored_at, lang)} />
            </div>

            {o.score_manual_override && o.score_override_reason ? (
              <DataField label={t("score_override_reason_label")} value={o.score_override_reason} />
            ) : null}

            <DataField label={t("score_recommended_action_label")} value={o.score_recommended_action} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t("score_missing_data_label")}</div>
                {o.score_missing_data && o.score_missing_data.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {o.score_missing_data.map((m: string) => <StatusPill key={m} tone="attention">{humanize(m)}</StatusPill>)}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-muted-foreground">{t("score_none")}</div>
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t("score_risk_flags_label")}</div>
                {o.score_risk_flags && o.score_risk_flags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {o.score_risk_flags.map((r: string) => <StatusPill key={r} tone="danger">{humanize(r)}</StatusPill>)}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-muted-foreground">{t("score_none")}</div>
                )}
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t("score_reasons_label")}</div>
              {o.score_reasons && o.score_reasons.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {o.score_reasons.map((r: string) => <StatusPill key={r} tone="muted">{humanize(r)}</StatusPill>)}
                </div>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">{t("score_none")}</div>
              )}
            </div>
          </div>
        )}
      </Panel>
      )}

      {/* 7c. COMMUNICATION HISTORY — Communication Hub Phase 1 */}
      <Panel title={t("comm_history")}>
        <CommunicationTimeline filter={{ opportunityId: o.id }} />
      </Panel>

      {/* Evidence viewer */}
      <EvidenceViewer
        evidence={evidenceOpen}
        onClose={() => setEvidenceOpen(null)}
        t={t}
        lang={lang}
      />

      {/* --- Action dialogs --- */}
      {(() => {
        const channelOpts = [
          { value: "call", label: t("channel_call") },
          { value: "email", label: t("channel_email") },
          { value: "meeting", label: t("channel_meeting") },
          { value: "whatsapp", label: t("channel_whatsapp") },
          { value: "site_visit", label: t("channel_site_visit") },
        ];
        const cadenceOpts = [
          { value: "A", label: `${t("label_tier")} A` },
          { value: "B", label: `${t("label_tier")} B` },
          { value: "C", label: `${t("label_tier")} C` },
        ];
        const teamOpts = [
          { value: "__none__", label: t("field_unassigned") },
          ...(teamQ.data ?? []).map((m) => ({
            value: m.id,
            label: m.full_name || m.email || m.id.slice(0, 8),
          })),
        ];
        const notesField: DialogField = {
          key: "notes",
          type: "textarea",
          label: t("field_notes"),
        };
        const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
        const currentOwner = o.owner_id ?? "__none__";

        return (
          <>
            <ActionDialog
              open={action === "review"}
              onOpenChange={(v) => !v && setAction(null)}
              title={t("dialog_review_title")}
              description={t("dialog_review_desc")}
              submitLabel={t("action_review")}
              fields={[{ ...notesField, required: true }]}
              onSubmit={(v) =>
                runSafe(
                  () =>
                    requestReview({
                      opportunityId: id,
                      approvalType: "management_review",
                      recommendation: "management_review",
                      notes: v.notes,
                    }),
                  "toast_review_ok",
                )
              }
            />
            <ActionDialog
              open={action === "approve"}
              onOpenChange={(v) => !v && setAction(null)}
              title={t("dialog_approve_title")}
              description={t("dialog_approve_desc")}
              submitLabel={t("action_approve")}
              fields={[notesField]}
              onSubmit={(v) =>
                runSafe(
                  async () => {
                    await requestReview({
                      opportunityId: id,
                      approvalType: "quotation",
                      recommendation: "proceed",
                      notes: v.notes,
                    });
                    await updateOpportunityStage({
                      opportunityId: id,
                      stage: "quotation",
                      notes: v.notes,
                    });
                  },
                  "toast_approve_ok",
                )
              }
            />
            <ActionDialog
              open={action === "schedule"}
              onOpenChange={(v) => !v && setAction(null)}
              title={t("dialog_schedule_title")}
              description={t("dialog_schedule_desc")}
              submitLabel={t("action_schedule")}
              fields={[
                { key: "due", type: "date", label: t("field_due_date"), required: true, defaultValue: tomorrow },
                { key: "owner", type: "select", label: t("field_owner"), options: teamOpts, defaultValue: currentOwner },
                { key: "channel", type: "select", label: t("field_channel"), options: channelOpts, defaultValue: "call" },
                { key: "cadence", type: "select", label: t("field_cadence"), options: cadenceOpts, defaultValue: o.tier ?? "B" },
                notesField,
              ]}
              onSubmit={(v) =>
                runSafe(
                  () =>
                    scheduleFollowUp({
                      opportunityId: id,
                      dueDate: v.due,
                      channel: v.channel || undefined,
                      cadenceTier: (v.cadence as "A" | "B" | "C") || "B",
                      notes: v.notes,
                      ownerId: v.owner === "__none__" ? null : v.owner,
                    }),
                  "toast_schedule_ok",
                )
              }
            />
            <ActionDialog
              open={action === "assign"}
              onOpenChange={(v) => !v && setAction(null)}
              title={t("dialog_assign_title")}
              description={t("dialog_assign_desc")}
              submitLabel={t("action_assign")}
              fields={[
                { key: "owner", type: "select", label: t("field_owner"), options: teamOpts, defaultValue: currentOwner, required: true },
                notesField,
              ]}
              onSubmit={(v) =>
                runSafe(
                  () =>
                    assignOwner({
                      opportunityId: id,
                      ownerId: v.owner === "__none__" ? null : v.owner,
                      notes: v.notes,
                    }),
                  "toast_assign_ok",
                )
              }
            />
            <ActionDialog
              open={action === "escalate"}
              onOpenChange={(v) => !v && setAction(null)}
              title={t("dialog_escalate_title")}
              description={t("dialog_escalate_desc")}
              submitLabel={t("action_escalate")}
              destructive
              fields={[{ key: "reason", type: "textarea", label: t("field_reason"), required: true }]}
              onSubmit={(v) =>
                runSafe(
                  () => escalateOpportunity({ opportunityId: id, reason: v.reason }),
                  "toast_escalate_ok",
                )
              }
            />
            <ActionDialog
              open={!!completeId}
              onOpenChange={(v) => !v && setCompleteId(null)}
              title={t("dialog_complete_title")}
              description={t("dialog_complete_desc")}
              submitLabel={t("action_complete")}
              fields={[{ key: "outcome", type: "textarea", label: t("field_outcome"), required: true }]}
              onSubmit={(v) =>
                runSafe(
                  () =>
                    completeFollowUp({
                      followUpId: completeId!,
                      opportunityId: id,
                      outcome: v.outcome,
                    }),
                  "toast_complete_ok",
                )
              }
            />
            <ActionDialog
              open={!!rescheduleId}
              onOpenChange={(v) => !v && setRescheduleId(null)}
              title={t("dialog_reschedule_title")}
              description={t("dialog_reschedule_desc")}
              submitLabel={t("action_reschedule")}
              fields={[
                { key: "due", type: "date", label: t("field_due_date"), required: true, defaultValue: tomorrow },
                notesField,
              ]}
              onSubmit={(v) =>
                runSafe(
                  () =>
                    rescheduleFollowUp({
                      followUpId: rescheduleId!,
                      opportunityId: id,
                      dueDate: v.due,
                      notes: v.notes,
                    }),
                  "toast_reschedule_ok",
                )
              }
            />
            <ActionDialog
              open={!!decideFor}
              onOpenChange={(v) => !v && setDecideFor(null)}
              title={
                decideFor?.kind === "approved"
                  ? t("dialog_approve_title")
                  : t("dialog_return_title")
              }
              description={
                decideFor?.kind === "approved"
                  ? t("dialog_approve_desc")
                  : t("dialog_return_desc")
              }
              submitLabel={
                decideFor?.kind === "approved" ? t("action_approve") : t("action_return")
              }
              destructive={decideFor?.kind === "returned"}
              fields={[
                {
                  key: "notes",
                  type: "textarea",
                  label: t("field_notes"),
                  required: decideFor?.kind === "returned",
                },
              ]}
              onSubmit={(v) =>
                runSafe(
                  () =>
                    decideApproval({
                      approvalId: decideFor!.id,
                      opportunityId: id,
                      decision: decideFor!.kind,
                      notes: v.notes,
                    }),
                  decideFor?.kind === "approved" ? "toast_approve_ok" : "toast_return_ok",
                )
              }
            />
          </>
        );
      })()}

      <ActionDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        title={t("score_override")}
        submitLabel={t("score_override")}
        fields={[
          {
            key: "tier",
            type: "select",
            label: t("score_tier_label"),
            required: true,
            defaultValue: o.score_tier ?? "",
            options: [
              { value: "A", label: "A" },
              { value: "B", label: "B" },
              { value: "C", label: "C" },
              { value: "not_qualified", label: t("score_not_qualified") },
            ],
          },
          { key: "reason", type: "textarea", label: t("score_override_reason_label"), required: true },
        ]}
        onSubmit={async (v) => {
          try {
            await overrideOpportunityScore({ opportunityId: o.id, tier: v.tier as OpportunityScoreTier, reason: v.reason });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["opp", id] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}

function ActionButton({
  children,
  primary,
  onClick,
}: {
  children: React.ReactNode;
  primary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors " +
        (primary
          ? "border-amber/40 bg-amber/10 text-amber-light hover:bg-amber/20"
          : "border-border bg-surface text-foreground hover:bg-muted")
      }
    >
      {children}
    </button>
  );
}

function TimelineFilterBar({
  value,
  onChange,
  t,
}: {
  value: TimelineFilter;
  onChange: (v: TimelineFilter) => void;
  t: (k: any) => string;
}) {
  const items: { key: TimelineFilter; label: string }[] = [
    { key: "all", label: t("timeline_all") },
    { key: "alert", label: t("timeline_alert") },
    { key: "evidence", label: t("timeline_evidence") },
    { key: "decision", label: t("timeline_decision") },
    { key: "assignment", label: t("timeline_assignment") },
    { key: "follow_up", label: t("timeline_follow_up") },
    { key: "outcome", label: t("timeline_outcome") },
  ];
  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface p-1.5">
      {items.map((it) => {
        const active = value === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            className={
              "rounded-md px-3 py-1 text-xs transition-colors " +
              (active
                ? "bg-amber/15 text-amber-light"
                : "text-muted-foreground hover:bg-muted hover:text-foreground")
            }
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function EvidenceViewer({
  evidence,
  onClose,
  t,
  lang,
}: {
  evidence: any | null;
  onClose: () => void;
  t: (k: any) => string;
  lang: Lang;
}) {
  if (!evidence) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border/70 px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("evidence_viewer_title")}
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {evidence.source_title || humanize(evidence.source_type)}
          </div>
        </div>
        <div className="grid gap-3 px-5 py-4 text-sm">
          <DataField label={t("label_source")} value={humanize(evidence.source_type)} />
          <DataField label={t("label_date")} value={fmtDate(evidence.source_date, lang)} />
          {evidence.confidence_level ? (
            <DataField
              label={t("label_confidence")}
              value={humanize(evidence.confidence_level)}
            />
          ) : null}
          {evidence.extracted_summary ? (
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {lang === "ar" ? "الملخص" : "Summary"}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {evidence.extracted_summary}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border/70 px-5 py-3">
          {evidence.source_url ? (
            <a
              href={evidence.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("evidence_open_source")}
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">{t("evidence_no_url")}</span>
          )}
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
