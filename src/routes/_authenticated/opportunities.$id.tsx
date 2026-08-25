import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateRfqDetails } from "@/lib/rfq-actions";
import { invalidateSalesData } from "@/lib/invalidate-sales";
import { useI18n, formatCurrency, formatNumber, type Lang } from "@/lib/i18n";
import { Panel } from "@/components/phc/Panel";
import { DataField } from "@/components/phc/DataField";
import { StatusPill } from "@/components/phc/StatusPill";
import { EmptyState } from "@/components/phc/EmptyState";
import { OpportunityTimeline } from "@/components/phc/OpportunityTimeline";
import { DocumentsPanel } from "@/components/phc/DocumentsPanel";
import { CommitmentsPanel } from "@/components/phc/CommitmentsPanel";
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
  setOpportunityMilestone,
  updateOpportunityTechnicalNotes,
  // Faisal, 2026-08-06: the submission deadline and its owner had to become editable.
  OPPORTUNITY_MILESTONES,
  type OpportunityMilestone,
} from "@/lib/opportunity-actions";
import { ArrowLeft, ArrowRight, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { CommunicationActions } from "@/components/phc/CommunicationActions";
import { CommunicationTimeline } from "@/components/phc/CommunicationTimeline";
import { RecordLifecycleMenu } from "@/components/phc/RecordLifecycleMenu";
import { BafoPanel } from "@/components/phc/BafoPanel";
import { getLatestAgentOutput, reviewAgentOutput, type AiAgentOutputRow } from "@/lib/ai-review-actions";
import { runAiAgent } from "@/lib/ai-orchestrator-actions";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canManageSalesPipeline, canReviewAiOutput, canUseDiscussion } from "@/lib/roles";
import type { OpportunityScoreTier } from "@/lib/opportunity-scoring";
import {
  listDiscussion,
  postDiscussionUpdate,
  updateDiscussionPost,
  deleteDiscussionPost,
  updatePersonInCharge,
  uploadEvidenceFile,
  listContracts,
  createContract,
  updateContract,
  upsertClientDetails,
  type ContractRecord,
  type ContractStage,
  type MentionPurpose,
} from "@/lib/opportunity-collab-actions";
import { Upload, Paperclip } from "lucide-react";
import { AttachmentLink } from "@/components/phc/AttachmentLink";

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

// Shared review-status bar for an AI agent's persisted output — used by both
// the Risk Assessment and Opportunity Evaluation panels. Reviewing (accept/
// reject) goes through the same governed sales-os-api action used by
// agent-activity.tsx's global "AI Outputs" tab (src/lib/ai-review-actions.ts)
// — this only adds an in-context view/action next to the run that produced it.
function AiOutputReviewBar({
  output,
  canReview,
  busy,
  onDecide,
}: {
  output: AiAgentOutputRow | null | undefined;
  canReview: boolean;
  busy: boolean;
  onDecide: (output: AiAgentOutputRow, decision: "accepted" | "rejected") => void;
}) {
  if (!output) return null;
  const tone = output.status === "accepted" ? "positive" : output.status === "rejected" ? "danger" : "attention";
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-xs">
      <StatusPill tone={tone}>{humanize(output.status)}</StatusPill>
      {output.status === "pending_review" && canReview ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(output, "accepted")}
            className="rounded-md border border-won/40 bg-won/10 px-2.5 py-1 text-[11px] font-medium text-won transition-colors hover:bg-won/[0.16] disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(output, "rejected")}
            className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive/90 transition-colors hover:bg-destructive/[0.16] disabled:opacity-50"
          >
            Reject
          </button>
        </>
      ) : output.reviewed_at ? (
        <span className="text-muted-foreground">
          Reviewed {new Date(output.reviewed_at).toLocaleDateString()}
        </span>
      ) : null}
    </div>
  );
}

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
  const [clientDetailsOpen, setClientDetailsOpen] = useState(false);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const { user, roles } = useAuth();
  const canScore = canManageSalesPipeline(roles);
  const canReview = canReviewAiOutput(roles);
  const canDiscuss = canUseDiscussion(roles);
  const canEditClientDetails = canManageSalesPipeline(roles);

  const [riskResult, setRiskResult] = useState<any | null>(null);
  const [riskRunning, setRiskRunning] = useState(false);
  const [riskError, setRiskError] = useState<string | null>(null);

  const [evalResult, setEvalResult] = useState<any | null>(null);
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Latest persisted ai_agent_outputs row per agent, so a previous run's
  // review status (pending_review/accepted/rejected) survives navigation —
  // reviewing itself happens on this same page now, not only via the
  // separate global "AI Outputs" tab in agent-activity.tsx.
  const riskOutputQ = useQuery({
    queryKey: ["ai-output", id, "risk_finance"],
    queryFn: () => getLatestAgentOutput("opportunities", id, "risk_finance"),
  });
  const evalOutputQ = useQuery({
    queryKey: ["ai-output", id, "opportunity_evaluation"],
    queryFn: () => getLatestAgentOutput("opportunities", id, "opportunity_evaluation"),
  });

  async function handleRiskAssessment() {
    setRiskRunning(true);
    setRiskError(null);
    try {
      const result = await runAiAgent({ agent: "risk_finance", entityType: "opportunities", entityId: id });
      if (!result.ok) throw new Error(result.message);
      setRiskResult(result.result);
      qc.invalidateQueries({ queryKey: ["ai-output", id, "risk_finance"] });
    } catch (e: any) {
      setRiskError(e.message);
    } finally {
      setRiskRunning(false);
    }
  }

  async function handleOpportunityEvaluation() {
    setEvalRunning(true);
    setEvalError(null);
    try {
      const result = await runAiAgent({ agent: "opportunity_evaluation", entityType: "opportunities", entityId: id });
      if (!result.ok) throw new Error(result.message);
      setEvalResult(result.result);
      qc.invalidateQueries({ queryKey: ["ai-output", id, "opportunity_evaluation"] });
    } catch (e: any) {
      setEvalError(e.message);
    } finally {
      setEvalRunning(false);
    }
  }

  const [reviewingOutputId, setReviewingOutputId] = useState<string | null>(null);
  async function handleReviewOutput(output: AiAgentOutputRow, decision: "accepted" | "rejected") {
    setReviewingOutputId(output.id);
    try {
      await reviewAgentOutput({ outputId: output.id, decision });
      toast.success(decision === "accepted" ? t("toast_ai_output_accepted") : t("toast_ai_output_rejected"));
      qc.invalidateQueries({ queryKey: ["ai-output", id, output.agent_key] });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setReviewingOutputId(null);
    }
  }

  const teamQ = useQuery({ queryKey: ["team"], queryFn: listTeamMembers });

  const discussionQ = useQuery({
    queryKey: ["opp-discussion", id],
    queryFn: () => listDiscussion(id),
    enabled: canDiscuss,
  });

  const contractsQ = useQuery({
    queryKey: ["opp-contracts", id],
    queryFn: () => listContracts(id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["opp", id] });
    qc.invalidateQueries({ queryKey: ["opp-stake", id] });
    qc.invalidateQueries({ queryKey: ["opp-fu", id] });
    qc.invalidateQueries({ queryKey: ["opp-app", id] });
    qc.invalidateQueries({ queryKey: ["opp-milestones", id] });
    qc.invalidateQueries({ queryKey: ["opp-ev", id] });
    qc.invalidateQueries({ queryKey: ["opp-discussion", id] });
    qc.invalidateQueries({ queryKey: ["opp-contracts", id] });
    qc.invalidateQueries({ queryKey: ["cc-metrics"] });
    // The keys above cover this record's own panels. A stage or approval change
    // here is also visible on Opportunities, Command Center and My Workspace,
    // which read the same rows under different keys.
    invalidateSalesData(qc);
    qc.invalidateQueries({ queryKey: ["all-followups"] });
    qc.invalidateQueries({ queryKey: ["approvals"] });
  };

  /* ---------------- Discussion ---------------- */
  const [discussionDraft, setDiscussionDraft] = useState("");
  const [discussionPicId, setDiscussionPicId] = useState<string>("");
  const [discussionPicNote, setDiscussionPicNote] = useState("");
  const [discussionMentionUserId, setDiscussionMentionUserId] = useState<string>("");
  const [discussionMentionPurpose, setDiscussionMentionPurpose] = useState<MentionPurpose | "">("");
  const [postingDiscussion, setPostingDiscussion] = useState(false);
  const [editingDiscussionId, setEditingDiscussionId] = useState<string | null>(null);
  const [editingDiscussionDraft, setEditingDiscussionDraft] = useState("");
  const [savingDiscussionEdit, setSavingDiscussionEdit] = useState(false);
  async function handlePostDiscussion() {
    if (!discussionDraft.trim()) return;
    setPostingDiscussion(true);
    try {
      await postDiscussionUpdate({
        opportunityId: id,
        body: discussionDraft.trim(),
        personInChargeId: discussionPicId || null,
        personInChargeNote: discussionPicNote.trim() || null,
        mentionedUserId: discussionMentionUserId || null,
        mentionPurpose: discussionMentionPurpose || null,
      });
      setDiscussionDraft("");
      setDiscussionPicId("");
      setDiscussionPicNote("");
      setDiscussionMentionUserId("");
      setDiscussionMentionPurpose("");
      toast.success(t("discussion_posted_toast"));
      qc.invalidateQueries({ queryKey: ["opp-discussion", id] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setPostingDiscussion(false);
    }
  }

  async function handleUpdateDiscussion(postId: string) {
    if (!editingDiscussionDraft.trim()) return;
    setSavingDiscussionEdit(true);
    try {
      await updateDiscussionPost(postId, editingDiscussionDraft.trim());
      setEditingDiscussionId(null);
      qc.invalidateQueries({ queryKey: ["opp-discussion", id] });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setSavingDiscussionEdit(false);
    }
  }

  async function handleDeleteDiscussion(postId: string) {
    if (!confirm(lang === "ar" ? "حذف هذا المنشور؟" : "Delete this post?")) return;
    try {
      await deleteDiscussionPost(postId);
      qc.invalidateQueries({ queryKey: ["opp-discussion", id] });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }

  /* ---------------- Assignment: Person in Charge ---------------- */
  const [savingPic, setSavingPic] = useState(false);
  async function handleSetPersonInCharge(personInChargeId: string | null, note: string | null) {
    setSavingPic(true);
    try {
      await updatePersonInCharge({ opportunityId: id, personInChargeId, personInChargeNote: note });
      toast.success(t("crm_saved"));
      qc.invalidateQueries({ queryKey: ["opp", id] });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setSavingPic(false);
    }
  }

  /* ---------------- Evidence file upload ---------------- */
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  async function handleEvidenceFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingEvidence(true);
    try {
      for (const file of Array.from(files)) {
        try {
          await uploadEvidenceFile({ opportunityId: id, file });
        } catch (e) {
          const msg =
            e instanceof Error && e.message === "file_too_large"
              ? t("evidence_upload_error_size")
              : e instanceof Error && e.message === "file_type_not_allowed"
                ? t("evidence_upload_error_type")
                : t("toast_error") + (e instanceof Error ? `: ${e.message}` : "");
          toast.error(`${file.name}: ${msg}`);
          continue;
        }
      }
      toast.success(t("evidence_upload_success"));
      qc.invalidateQueries({ queryKey: ["opp-ev", id] });
    } finally {
      setUploadingEvidence(false);
    }
  }

  /* ---------------- Contract Stage ---------------- */
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<ContractRecord | null>(null);
  const canManageContract = canManageSalesPipeline(roles);
  async function handleSaveContract(v: Record<string, string>) {
    try {
      const payload = {
        contractName: v.contractName || null,
        contractReferenceNumber: v.contractReferenceNumber || null,
        stage: (v.stage || "draft") as ContractStage,
        client: v.client || null,
        contractValue: v.contractValue ? Number(v.contractValue) : null,
        currency: v.currency || "SAR",
        startDate: v.startDate || null,
        endDate: v.endDate || null,
        responsibleUserId: v.responsibleUserId && v.responsibleUserId !== "__none__" ? v.responsibleUserId : null,
        documentUrl: v.documentUrl || null,
        notes: v.notes || null,
      };
      if (editingContract) {
        await updateContract(editingContract.id, id, payload);
      } else {
        await createContract({ opportunityId: id, ...payload });
      }
      toast.success(t("contract_saved_toast"));
      setContractDialogOpen(false);
      setEditingContract(null);
      qc.invalidateQueries({ queryKey: ["opp-contracts", id] });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }

  const [savingMilestone, setSavingMilestone] = useState<OpportunityMilestone | null>(null);
  async function toggleMilestone(milestone: OpportunityMilestone, completed: boolean) {
    setSavingMilestone(milestone);
    try {
      await setOpportunityMilestone({ opportunityId: id, milestone, completed });
      qc.invalidateQueries({ queryKey: ["opp-milestones", id] });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setSavingMilestone(null);
    }
  }

  const [technicalNotesDraft, setTechnicalNotesDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  async function saveTechnicalNotes() {
    if (technicalNotesDraft === null) return;
    setSavingNotes(true);
    try {
      await updateOpportunityTechnicalNotes(id, technicalNotesDraft);
      toast.success(t("crm_saved"));
      qc.invalidateQueries({ queryKey: ["opp", id] });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setSavingNotes(false);
    }
  }

  const runSafe = async (fn: () => Promise<unknown>, okKey: Parameters<typeof t>[0], onDone?: () => void) => {
    try {
      await fn();
      toast.success(t(okKey));
      invalidate();
      onDone?.();
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

  // Source of "JIH or Tender" + sales code for the Client details box — the
  // opportunity itself doesn't carry a classification, but the rfq it
  // originated from does.
  const rfqQ = useQuery({
    queryKey: ["opp-rfq", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("rfqs")
        .select("id, classification, rfq_number, response_due_date, notes, document_url, document_storage_path, assigned_to")
        .eq("opportunity_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
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

  const milestonesQ = useQuery({
    queryKey: ["opp-milestones", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("opportunity_milestones")
        .select("*")
        .eq("opportunity_id", id);
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
            <button
              type="button"
              disabled={riskRunning}
              onClick={handleRiskAssessment}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${riskRunning ? "animate-spin" : ""}`} />
              {riskRunning ? "Assessing…" : "Risk Assessment"}
            </button>
            <button
              type="button"
              disabled={evalRunning}
              onClick={handleOpportunityEvaluation}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${evalRunning ? "animate-spin" : ""}`} />
              {evalRunning ? "Evaluating…" : "Opportunity Evaluation"}
            </button>
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

      {/* 1.5 CLIENT DETAILS — basic identifying info at a glance, requested
          so opening an Opportunity doesn't require hunting through other
          panels for who the client is and what kind of request this was.
          Editable (2026-08-03): writes back to stakeholders/companies/
          opportunities.location instead of just displaying derived data —
          see upsertClientDetails in opportunity-collab-actions.ts. */}
      {/* Submission — the deadline, the document, and who the work is sitting
          with. All of it was write-once before 2026-08-06: a rep who got a
          deadline extension had nowhere to record it, and no way to say the
          quotation was waiting on Estimation. Faisal: "sometime I'll put some
          date for this thing, so I got some extension ... there is no option
          for the edit for this thing." */}
      {show("alert") && rfqQ.data ? (
        <Panel
          title={t("section_submission")}
          subtitle={rfqQ.data.rfq_number ?? undefined}
          action={
            canEditClientDetails ? (
              <button
                type="button"
                onClick={() => setSubmissionOpen(true)}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("crm_edit")}
              </button>
            ) : undefined
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DataField label={t("ibx_deadline")} value={rfqQ.data.response_due_date} />
            <DataField
              label={t("label_pending_on")}
              value={rfqQ.data.assigned_to ? ((teamQ.data ?? []).find((m: any) => m.id === rfqQ.data!.assigned_to)?.full_name ?? "—") : null}
            />
            <DataField label={t("wf_notes")} value={rfqQ.data.notes} />
          </div>
          <AttachmentLink
            storagePath={rfqQ.data.document_storage_path}
            legacyUrl={rfqQ.data.document_url}
            className="mt-3 inline-block text-xs text-amber-light underline underline-offset-2"
          >
            {t("ibx_evidence_url")}
          </AttachmentLink>

          <ActionDialog
            open={submissionOpen}
            onOpenChange={setSubmissionOpen}
            title={t("section_submission")}
            submitLabel={t("action_save")}
            fields={[
              {
                key: "responseDueDate",
                type: "date",
                label: t("ibx_deadline"),
                defaultValue: rfqQ.data.response_due_date ?? "",
              },
              {
                key: "assignedTo",
                type: "select",
                label: t("label_pending_on"),
                defaultValue: rfqQ.data.assigned_to ?? "",
                options: [
                  { value: "", label: "—" },
                  ...(teamQ.data ?? []).map((m: any) => ({
                    value: m.id,
                    label: m.full_name || m.email,
                  })),
                ],
              },
              {
                key: "documentUrl",
                type: "file_or_url",
                label: t("ibx_evidence_url"),
                folder: "rfq",
              },
              {
                key: "notes",
                type: "textarea",
                label: t("wf_notes"),
                defaultValue: rfqQ.data.notes ?? "",
              },
            ]}
            onSubmit={async (v) => {
              try {
                await updateRfqDetails({
                  rfqId: rfqQ.data!.id,
                  responseDueDate: v.responseDueDate || null,
                  assignedTo: v.assignedTo || null,
                  documentUrl: v.documentUrl || undefined,
                  notes: v.notes || null,
                });
                toast.success(t("crm_saved"));
                rfqQ.refetch();
                qc.invalidateQueries({ queryKey: ["ws-urgent-rfqs"] });
              } catch (e) {
                toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
              }
            }}
          />
        </Panel>
      ) : null}

      {show("alert") && (() => {
        const clientContact =
          (stakeholdersQ.data ?? []).find((s: any) => !!s.email) ?? (stakeholdersQ.data ?? [])[0] ?? null;
        const companyName = o.company?.name ?? o.client ?? clientContact?.organization ?? null;
        // "other" is one of the three values the column's CHECK constraint
        // allows and one of the three the edit dialog offers; leaving it out of
        // this map made a deliberate choice render as "—", indistinguishable
        // from never having been asked.
        const classification =
          rfqQ.data?.classification === "jih"
            ? t("class_jih")
            : rfqQ.data?.classification === "tender"
              ? t("class_tender")
              : rfqQ.data?.classification === "other"
                ? t("class_other")
                : null;
        const salesCode = rfqQ.data?.rfq_number ?? null;
        return (
          <Panel
            title={t("section_client_details")}
            action={
              canEditClientDetails ? (
                <button
                  type="button"
                  onClick={() => setClientDetailsOpen(true)}
                  className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("crm_edit")}
                </button>
              ) : undefined
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DataField label={t("label_contact_person")} value={clientContact?.name ?? null} />
              <DataField label={t("label_contact_number")} value={clientContact?.phone ?? null} />
              <DataField label={t("email")} value={clientContact?.email ?? null} />
              <DataField label={t("label_company_name")} value={companyName} />
              <DataField
                label={t("label_jih_or_tender")}
                value={classification ? (salesCode ? `${classification} · ${salesCode}` : classification) : null}
              />
              <DataField label={t("label_location")} value={o.location} />
            </div>
            <ActionDialog
              open={clientDetailsOpen}
              onOpenChange={setClientDetailsOpen}
              title={t("section_client_details")}
              submitLabel={t("action_save")}
              fields={[
                { key: "contactName", type: "text", label: t("label_contact_person"), defaultValue: clientContact?.name ?? "" },
                { key: "contactPhone", type: "text", label: t("label_contact_number"), defaultValue: clientContact?.phone ?? "" },
                { key: "contactEmail", type: "text", label: t("email"), defaultValue: clientContact?.email ?? "" },
                { key: "companyName", type: "text", label: t("label_company_name"), defaultValue: companyName ?? "" },
                { key: "location", type: "text", label: t("label_location"), defaultValue: o.location ?? "" },
                // Client feedback 2026-08-25: "I edited client details, but there
                // was no option to edit JIH or Tender." The card showed the field
                // and the dialog did not offer it.
                {
                  key: "classification",
                  type: "select",
                  label: t("label_jih_or_tender"),
                  options: [
                    { value: "", label: "—" },
                    { value: "jih", label: t("class_jih") },
                    { value: "tender", label: t("class_tender") },
                    { value: "other", label: t("class_other") },
                  ],
                  defaultValue: rfqQ.data?.classification ?? "",
                },
              ]}
              onSubmit={async (v) => {
                try {
                  await upsertClientDetails({
                    opportunityId: id,
                    existingStakeholderId: clientContact?.id ?? null,
                    contactName: v.contactName,
                    contactPhone: v.contactPhone,
                    contactEmail: v.contactEmail,
                    companyName: v.companyName,
                    location: v.location,
                    classification: v.classification,
                    existingRfqId: rfqQ.data?.id ?? null,
                  });
                  toast.success(t("crm_saved"));
                  setClientDetailsOpen(false);
                  invalidate();
                  // The classification lives on the RFQ, which `invalidate()`
                  // does not cover — without this the card still reads "—"
                  // after a save that succeeded.
                  qc.invalidateQueries({ queryKey: ["opp-rfq", id] });
                } catch (e) {
                  toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                }
              }}
            />
          </Panel>
        );
      })()}


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

      {/* 3. ASSIGNMENT — a single card: who to contact, who owns it, and who's
          currently in charge (if different). One data source per fact —
          Client Contact reuses the same "primary stakeholder" derivation as
          the header's communication actions, Primary Person reuses the
          existing opportunity owner, and Person in Charge is the one new
          field (opportunities.person_in_charge_id), also reused by
          Discussion below instead of being duplicated per-post. */}
      {show("assignment") && (() => {
        const clientContact =
          (stakeholdersQ.data ?? []).find((s: any) => !!s.email) ?? (stakeholdersQ.data ?? [])[0] ?? null;
        const primaryPerson = (teamQ.data ?? []).find((m: any) => m.id === o.owner_id) ?? null;
        const picMember = (teamQ.data ?? []).find((m: any) => m.id === o.person_in_charge_id) ?? null;
        const picDiffersFromPrimary = !!o.person_in_charge_id && o.person_in_charge_id !== o.owner_id;
        return (
          <Panel title={t("section_assignment")}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DataField
                label={t("assignment_client_contact")}
                value={
                  clientContact
                    ? [clientContact.name, clientContact.email || clientContact.phone].filter(Boolean).join(" · ")
                    : "—"
                }
              />
              <DataField
                label={t("assignment_primary_person")}
                value={primaryPerson?.full_name ?? primaryPerson?.email ?? t("assignment_unassigned")}
              />
              {picDiffersFromPrimary ? (
                <DataField
                  label={t("assignment_person_in_charge")}
                  value={picMember?.full_name ?? picMember?.email ?? "—"}
                />
              ) : null}
              {o.person_in_charge_note ? (
                <DataField label={t("assignment_pic_note")} value={o.person_in_charge_note} />
              ) : null}
            </div>
            {canManageContract ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                <select
                  value={o.person_in_charge_id ?? ""}
                  disabled={savingPic}
                  onChange={(e) => handleSetPersonInCharge(e.target.value || null, o.person_in_charge_note ?? null)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{t("assignment_set_pic")}</option>
                  {(teamQ.data ?? []).map((m: any) => (
                    <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </Panel>
        );
      })()}

      {/* 3.1. TECHNICAL NOTES — Phase 4 (system-redesign request), same tab
          as Stakeholders. Distinct from evidence_sources and the milestone
          checklist — a single free-form field. */}
      {show("assignment") && (
      <Panel title={t("section_technical_notes")}>
        <textarea
          value={technicalNotesDraft ?? o.technical_notes ?? ""}
          onChange={(e) => setTechnicalNotesDraft(e.target.value)}
          onBlur={saveTechnicalNotes}
          disabled={savingNotes}
          rows={4}
          className="w-full rounded-md border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t("section_technical_notes")}
        />
      </Panel>
      )}

      {/* 3.5. MILESTONE CHECKLIST — Phase 4 (system-redesign request): a
          fixed 7-item evidence checklist, independent of sales_stage. Each
          item can be checked/unchecked regardless of the others or of the
          opportunity's current stage — see opportunity-actions.ts's
          setOpportunityMilestone() and the migration's header comment. */}
      {show("evidence") && (
      <Panel title={t("section_milestone_checklist")}>
        <div className="grid gap-2 sm:grid-cols-2">
          {OPPORTUNITY_MILESTONES.map((m) => {
            const row = milestonesQ.data?.find((r: any) => r.milestone === m);
            const checked = !!row?.completed_at;
            return (
              <label
                key={m}
                className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border/60 px-3 py-2 text-sm hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={savingMilestone === m}
                  onChange={(e) => toggleMilestone(m, e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-won"
                />
                <span className="flex-1 text-foreground">{t(`milestone_${m}` as never)}</span>
                {checked && row?.completed_at ? (
                  <span className="text-[11px] text-muted-foreground">{fmtDate(row.completed_at, lang)}</span>
                ) : null}
              </label>
            );
          })}
        </div>
      </Panel>
      )}

      {/* 4b. FILES — the Phase 6 registry. Sits beside Evidence rather than
          replacing it: evidence_sources carries confidence and source_type that
          a document row does not, so folding one into the other would lose
          fields Phase 3 relies on. */}
      {show("evidence") && (
        <DocumentsPanel entity={{ type: "opportunity", id }} />
      )}

      {/* 4c. COMMITMENTS — Phase 9. Placed with the deal's working material
          rather than in the timeline: a promise is something still owed, and
          the timeline is a record of what already happened. */}
      {show("evidence") && (
        <CommitmentsPanel opportunityId={id} companyId={o.company_id} />
      )}

      {/* 4. EVIDENCE */}
      {show("evidence") && (
      <Panel
        title={t("section_evidence")}
        subtitle={`${formatNumber(evidenceQ.data?.length ?? 0, lang)} · ${humanize(o.source_confidence)}`}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light transition-colors hover:bg-amber/20 aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            <Upload className="h-3.5 w-3.5" />
            {uploadingEvidence ? t("evidence_uploading") : t("evidence_upload_button")}
            <input
              type="file"
              multiple
              disabled={uploadingEvidence}
              onChange={(e) => {
                handleEvidenceFilesSelected(e.target.files);
                e.target.value = "";
              }}
              className="hidden"
            />
          </label>
        </div>
        {evidenceQ.data && evidenceQ.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {evidenceQ.data.map((e: any) => (
              <li
                key={e.id}
                className="-mx-2 grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] gap-3 rounded px-2 py-3 transition-colors hover:bg-muted/40"
                onClick={() => setEvidenceOpen(e)}
              >
                {e.source_type === "file_upload" ? (
                  <Paperclip className="mt-0.5 h-4 w-4 text-muted-foreground" />
                ) : (
                  <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                )}
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
                    {e.file_size ? (
                      <>
                        <span>·</span>
                        <span>{(e.file_size / (1024 * 1024)).toFixed(1)} MB</span>
                      </>
                    ) : e.confidence_level ? (
                      <>
                        <span>·</span>
                        <span>{humanize(e.confidence_level)}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <span onClick={(evt) => evt.stopPropagation()}>
                  <AttachmentLink
                    storagePath={e.vault_path}
                    legacyUrl={e.source_url}
                    className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-label={t("evidence_download")} />
                  </AttachmentLink>
                </span>
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
                <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-4 py-3">
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
                  <RecordLifecycleMenu entityType="follow_ups" entityId={f.id} roles={roles} onDone={invalidate} />
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
          <EmptyState message={t("empty_approvals_record")} />
        )}
      </Panel>
      )}

      {/* 6.2. DISCUSSION — single free-text update box, newest-first cards.
          Restricted to General Manager, Sales Manager, Development Manager,
          and System Administrator both here (UI) and via RLS (server) — see
          can_use_discussion(uuid). Grouped with Decision (not Assignment)
          per feedback: discussion threads are about deciding what happens
          next, not who's assigned. Editable/deletable by the post's own
          author (or system_admin) and mentionable-for-review/approval/
          endorsement as of 2026-08-03 — see updateDiscussionPost/
          deleteDiscussionPost in opportunity-collab-actions.ts; a mention
          creates a pending approval so it shows on the mentioned person's
          own page (My Workspace / notifications). */}
      {show("decision") && (
      <Panel title={t("section_discussion")}>
        {canDiscuss ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <textarea
                value={discussionDraft}
                onChange={(e) => setDiscussionDraft(e.target.value)}
                rows={3}
                placeholder={t("discussion_placeholder")}
                className="w-full rounded-md border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={discussionPicId}
                  onChange={(e) => setDiscussionPicId(e.target.value)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{t("discussion_person_in_charge")}</option>
                  {(teamQ.data ?? []).map((m: any) => (
                    <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
                  ))}
                </select>
                <input
                  value={discussionPicNote}
                  onChange={(e) => setDiscussionPicNote(e.target.value)}
                  placeholder={t("discussion_pic_note")}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={discussionMentionUserId}
                  onChange={(e) => setDiscussionMentionUserId(e.target.value)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{t("discussion_mention_person")}</option>
                  {(teamQ.data ?? []).map((m: any) => (
                    <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
                  ))}
                </select>
                <select
                  value={discussionMentionPurpose}
                  disabled={!discussionMentionUserId}
                  onChange={(e) => setDiscussionMentionPurpose(e.target.value as MentionPurpose | "")}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">{t("discussion_mention_purpose")}</option>
                  <option value="review">{t("discussion_mention_review")}</option>
                  <option value="approval">{t("discussion_mention_approval")}</option>
                  <option value="endorsement">{t("discussion_mention_endorsement")}</option>
                </select>
              </div>
              <div>
                <button
                  type="button"
                  disabled={postingDiscussion || !discussionDraft.trim()}
                  onClick={handlePostDiscussion}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light transition-colors hover:bg-amber/20 disabled:opacity-50"
                >
                  {t("discussion_post")}
                </button>
              </div>
            </div>

            {discussionQ.data && discussionQ.data.length > 0 ? (
              <ul className="grid gap-2.5">
                {discussionQ.data.map((post) => {
                  const isOwnPost = post.created_by === user?.id;
                  const canModerate = isOwnPost || (roles ?? []).includes("system_admin" as never);
                  const isEditing = editingDiscussionId === post.id;
                  return (
                    <li key={post.id} className="rounded-md border border-border/60 bg-surface p-3">
                      {isEditing ? (
                        <div className="grid gap-2">
                          <textarea
                            value={editingDiscussionDraft}
                            onChange={(e) => setEditingDiscussionDraft(e.target.value)}
                            rows={3}
                            className="w-full rounded-md border border-border bg-background p-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={savingDiscussionEdit || !editingDiscussionDraft.trim()}
                              onClick={() => handleUpdateDiscussion(post.id)}
                              className="rounded-md border border-amber/40 bg-amber/10 px-2.5 py-1 text-[11px] font-medium text-amber-light hover:bg-amber/20 disabled:opacity-50"
                            >
                              {t("action_save")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingDiscussionId(null)}
                              className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              {t("cancel")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap text-sm text-foreground">{post.body}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {post.author?.full_name ?? post.author?.email ?? "—"}
                            </span>
                            <span>·</span>
                            <span>{fmtDate(post.created_at, lang)}</span>
                            {post.person_in_charge_note ? (
                              <>
                                <span>·</span>
                                <span>{t("discussion_pic_note")}: {post.person_in_charge_note}</span>
                              </>
                            ) : null}
                            {post.mentioned ? (
                              <>
                                <span>·</span>
                                <StatusPill tone="attention">
                                  {t(`discussion_mention_${post.mention_purpose}` as never)}: {post.mentioned.full_name ?? post.mentioned.email}
                                </StatusPill>
                              </>
                            ) : null}
                            {canModerate ? (
                              <span className="ms-auto flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => { setEditingDiscussionId(post.id); setEditingDiscussionDraft(post.body); }}
                                  className="hover:text-foreground hover:underline"
                                >
                                  {t("crm_edit")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDiscussion(post.id)}
                                  className="hover:text-destructive hover:underline"
                                >
                                  {t("discussion_delete")}
                                </button>
                              </span>
                            ) : null}
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState message={t("discussion_empty")} />
            )}
          </div>
        ) : (
          <EmptyState message={t("discussion_forbidden")} />
        )}
      </Panel>
      )}

      {/* 6.5. CONTRACT STAGE — replaces the former "Log Outcome" concept:
          the deal's current stage plus its linked contract(s), rendered
          from the new `contracts` table. Handles zero/one/many contracts. */}
      {show("outcome") && (
      <Panel title={t("section_contract_stage")} subtitle={t("contract_stage_hint")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <StatusPill tone="muted">{humanize(o.sales_stage ?? o.stage)}</StatusPill>
          {canManageContract ? (
            <button
              type="button"
              onClick={() => { setEditingContract(null); setContractDialogOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t("contract_create")}
            </button>
          ) : null}
        </div>
        {contractsQ.data && contractsQ.data.length > 0 ? (
          <ul className="grid gap-2.5">
            {contractsQ.data.map((c) => {
              const responsible = (teamQ.data ?? []).find((m: any) => m.id === c.responsible_user_id);
              return (
                <li key={c.id} className="rounded-md border border-border/60 bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {c.contract_name || c.contract_reference_number || t("section_contract_stage")}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {c.client ?? o.client ?? "—"}
                      </div>
                    </div>
                    <StatusPill tone={c.stage === "active" || c.stage === "signed" ? "positive" : c.stage === "terminated" ? "danger" : "muted"}>
                      {t(`contract_stage_${c.stage}` as never)}
                    </StatusPill>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <DataField label={t("contract_reference")} value={c.contract_reference_number} />
                    <DataField label={t("contract_value")} value={formatCurrency(c.contract_value, lang, c.currency)} mono />
                    <DataField label={t("contract_start_date")} value={fmtDate(c.start_date, lang)} />
                    <DataField label={t("contract_end_date")} value={fmtDate(c.end_date, lang)} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {responsible ? <span>{t("contract_responsible")}: {responsible.full_name ?? responsible.email}</span> : null}
                    <AttachmentLink legacyUrl={c.document_url} className="inline-flex items-center gap-1 text-amber-light hover:underline">
                      <Paperclip className="h-3 w-3" /> {t("contract_document")}
                    </AttachmentLink>
                  </div>
                  {c.notes ? <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{c.notes}</p> : null}
                  {canManageContract ? (
                    <button
                      type="button"
                      onClick={() => { setEditingContract(c); setContractDialogOpen(true); }}
                      className="mt-2 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {t("contract_edit")}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState message={t("contract_none")} />
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

      {/* 7d. BAFO / COMMERCIAL DISCOUNT APPROVAL CHAIN */}
      {show("decision") && <BafoPanel opportunityId={o.id} />}

      {/* 7c. RISK ASSESSMENT */}
      {(() => {
        const riskDisplay = riskResult ?? (riskOutputQ.data?.structured_output as any);
        return (riskError || riskDisplay) && (
        <Panel title="Risk Assessment">
          {riskError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {riskError}
            </div>
          )}
          {riskDisplay && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {riskDisplay.risk_level && (
                  <span
                    className={
                      "rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide " +
                      (riskDisplay.risk_level === "low"
                        ? "bg-won/15 text-won"
                        : riskDisplay.risk_level === "medium"
                        ? "bg-amber-500/15 text-amber-400"
                        : riskDisplay.risk_level === "high"
                        ? "bg-orange-500/15 text-orange-400"
                        : "bg-destructive/15 text-destructive")
                    }
                  >
                    {riskDisplay.risk_level}
                  </span>
                )}
                {riskDisplay.risk_score != null && (
                  <span className="text-sm text-foreground font-medium">
                    Risk Score: {riskDisplay.risk_score}/100
                  </span>
                )}
              </div>

              {riskDisplay.risk_factors && riskDisplay.risk_factors.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    Risk Factors
                  </div>
                  <ul className="space-y-1.5">
                    {riskDisplay.risk_factors.map((factor: any, i: number) => (
                      <li key={i} className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
                        {factor.impact && (
                          <span
                            className={
                              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                              (factor.impact === "low"
                                ? "bg-won/15 text-won"
                                : factor.impact === "medium"
                                ? "bg-amber-500/15 text-amber-400"
                                : "bg-destructive/15 text-destructive")
                            }
                          >
                            {factor.impact}
                          </span>
                        )}
                        <span className="text-muted-foreground">{factor.description ?? factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {riskDisplay.mitigations && riskDisplay.mitigations.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    Mitigations
                  </div>
                  <ul className="space-y-1.5">
                    {riskDisplay.mitigations.map((m: any, i: number) => (
                      <li key={i} className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
                        {m.priority && (
                          <span
                            className={
                              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                              (m.priority === "low"
                                ? "bg-info/15 text-info"
                                : m.priority === "medium"
                                ? "bg-amber-500/15 text-amber-400"
                                : "bg-destructive/15 text-destructive")
                            }
                          >
                            {m.priority}
                          </span>
                        )}
                        <span className="text-muted-foreground">{m.action ?? m}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                This risk assessment is generated by AI and is intended as decision support only. Always validate with your own judgment and local context before taking action.
              </p>

              <AiOutputReviewBar
                output={riskOutputQ.data}
                canReview={canReview}
                busy={reviewingOutputId === riskOutputQ.data?.id}
                onDecide={handleReviewOutput}
              />
            </div>
          )}
        </Panel>
        );
      })()}

      {/* 7e. OPPORTUNITY EVALUATION */}
      {(() => {
        const evalDisplay = evalResult ?? (evalOutputQ.data?.structured_output as any);
        return (evalError || evalDisplay) && (
        <Panel title="Opportunity Evaluation">
          {evalError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {evalError}
            </div>
          )}
          {evalDisplay && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {evalDisplay.overall_score != null && (
                  <span className="text-sm font-medium text-foreground">
                    Score: {evalDisplay.overall_score}/100
                  </span>
                )}
                {evalDisplay.qualification && (
                  <StatusPill
                    tone={
                      evalDisplay.qualification === "high"
                        ? "positive"
                        : evalDisplay.qualification === "medium"
                          ? "attention"
                          : "muted"
                    }
                  >
                    {humanize(evalDisplay.qualification)} qualification
                  </StatusPill>
                )}
                {evalDisplay.recommended_priority && (
                  <StatusPill tone={evalDisplay.recommended_priority === "critical" ? "danger" : "muted"}>
                    {humanize(evalDisplay.recommended_priority)} priority
                  </StatusPill>
                )}
                {evalDisplay.win_likelihood != null && (
                  <span className="text-xs text-muted-foreground">
                    Win likelihood: {evalDisplay.win_likelihood}%
                  </span>
                )}
              </div>

              {evalDisplay.rationale && (
                <p className="text-sm leading-relaxed text-foreground">{evalDisplay.rationale}</p>
              )}

              {evalDisplay.strengths && evalDisplay.strengths.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Strengths</div>
                  <ul className="space-y-1.5">
                    {evalDisplay.strengths.map((s: string, i: number) => (
                      <li key={i} className="rounded-md border border-won/20 bg-won/5 px-3 py-2 text-xs text-foreground">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {evalDisplay.risks && evalDisplay.risks.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Risks</div>
                  <ul className="space-y-1.5">
                    {evalDisplay.risks.map((r: string, i: number) => (
                      <li key={i} className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-foreground">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {evalDisplay.missing_information && evalDisplay.missing_information.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Missing Information</div>
                  <div className="flex flex-wrap gap-1.5">
                    {evalDisplay.missing_information.map((m: string, i: number) => (
                      <StatusPill key={i} tone="attention">{m}</StatusPill>
                    ))}
                  </div>
                </div>
              )}

              {evalDisplay.recommended_next_actions && evalDisplay.recommended_next_actions.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Recommended Next Actions</div>
                  <ul className="space-y-1.5">
                    {evalDisplay.recommended_next_actions.map((a: string, i: number) => (
                      <li key={i} className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {evalDisplay.suggested_follow_up_date && (
                <DataField label="Suggested Follow-up" value={fmtDate(evalDisplay.suggested_follow_up_date, lang)} />
              )}

              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                {evalDisplay.disclaimer ?? "This evaluation is generated by AI and is intended as decision support only. Always validate with your own judgment before taking action."}
              </p>

              <AiOutputReviewBar
                output={evalOutputQ.data}
                canReview={canReview}
                busy={reviewingOutputId === evalOutputQ.data?.id}
                onDecide={handleReviewOutput}
              />
            </div>
          )}
        </Panel>
        );
      })()}

      {/* 7d. COMMUNICATION HISTORY — Communication Hub Phase 1 */}
      <Panel title={t("comm_history")}>
        <CommunicationTimeline filter={{ opportunityId: o.id }} />
      </Panel>

      {/* 7e. FULL LIFECYCLE TIMELINE — Phase 5.
           CommunicationTimeline above covers contact history only. This is the
           whole story: intake, review, stage moves, approvals, tender lineage,
           award, contract and commercial handoff, projected from the tables
           that already record them rather than a duplicate history of its own. */}
      <OpportunityTimeline opportunityId={o.id} />

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
                  // Jump straight to the Follow-up filter so the new entry is
                  // guaranteed visible — "Add Follow-up" lives in the Alert
                  // panel, but the display panel is gated by a different
                  // filter category (2026-08-03 feedback).
                  () => setFilter("follow_up"),
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
              open={contractDialogOpen}
              onOpenChange={(v) => { setContractDialogOpen(v); if (!v) setEditingContract(null); }}
              title={editingContract ? t("contract_edit") : t("contract_create")}
              submitLabel={editingContract ? t("action_save") : t("contract_create")}
              fields={[
                { key: "contractName", type: "text", label: t("contract_name"), defaultValue: editingContract?.contract_name ?? "" },
                { key: "contractReferenceNumber", type: "text", label: t("contract_reference"), defaultValue: editingContract?.contract_reference_number ?? "" },
                {
                  key: "stage", type: "select", label: t("section_contract_stage"),
                  defaultValue: editingContract?.stage ?? "draft",
                  options: (["draft", "sent_for_signature", "signed", "active", "completed", "terminated"] as const).map((s) => ({
                    value: s, label: t(`contract_stage_${s}` as never),
                  })),
                },
                { key: "client", type: "text", label: t("contract_client"), defaultValue: editingContract?.client ?? o.client ?? "" },
                { key: "contractValue", type: "text", label: t("contract_value"), defaultValue: editingContract?.contract_value != null ? String(editingContract.contract_value) : "" },
                { key: "currency", type: "text", label: t("contract_currency"), defaultValue: editingContract?.currency ?? o.currency ?? "SAR" },
                { key: "startDate", type: "date", label: t("contract_start_date"), defaultValue: editingContract?.start_date ?? "" },
                { key: "endDate", type: "date", label: t("contract_end_date"), defaultValue: editingContract?.end_date ?? "" },
                { key: "responsibleUserId", type: "select", label: t("contract_responsible"), defaultValue: editingContract?.responsible_user_id ?? "", options: teamOpts },
                { key: "documentUrl", type: "file", label: t("contract_document"), folder: "contracts" },
                { key: "notes", type: "textarea", label: t("contract_notes"), defaultValue: editingContract?.notes ?? "" },
              ]}
              onSubmit={handleSaveContract}
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
          {evidence.vault_path || evidence.source_url ? (
            <AttachmentLink
              storagePath={evidence.vault_path}
              legacyUrl={evidence.source_url}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("evidence_open_source")}
            </AttachmentLink>
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
