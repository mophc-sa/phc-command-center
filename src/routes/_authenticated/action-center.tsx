import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ShieldAlert,
  PlayCircle,
  Sparkles,
  PlayIcon,
  CheckIcon,
  XIcon,
  ArrowUpCircle,
  PauseCircle,
  Ban,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n, formatNumber } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import {
  startAction,
  completeAction,
  dismissAction,
  escalateAction,
  blockAction,
  runAutomations,
} from "@/lib/workflow-actions";
import {
  canManageSalesPipeline,
  canReviewIntake,
  canApproveCommercialAction,
} from "@/lib/roles";
import {
  assembleActions,
  countActions,
  filterActions,
  urgencyOf,
  DEFAULT_FILTERS,
  type ActionFilters,
  type UnifiedAction,
  type ApprovalRowIn,
  type FlagRowIn,
  type FollowUpRowIn,
  type IntakeRowIn,
  type TaskRowIn,
} from "@/lib/action-center";
import { humanize } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/action-center")({
  head: () => ({ meta: [{ title: "Sales Action Queue — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ActionCenter,
});

const TYPE_KEY: Record<string, string> = {
  follow_up_due: "acty_follow_up_due",
  follow_up_overdue: "acty_follow_up_overdue",
  missing_data: "acty_missing_data",
  rfq_review_needed: "acty_rfq_review_needed",
  tender_review_needed: "acty_tender_review_needed",
  approval_needed: "acty_approval_needed",
  quotation_follow_up: "acty_quotation_follow_up",
  no_next_action: "acty_no_next_action",
  inactive_tier_a_opportunity: "acty_inactive_tier_a_opportunity",
  contract_evidence_missing: "acty_contract_evidence_missing",
  submission_pending_on: "acty_submission_pending_on",
};

const SOURCE_KEY: Record<string, string> = {
  flag: "ac_source_flag",
  task: "ac_source_task",
  follow_up: "ac_source_follow_up",
  approval: "ac_source_approval",
  intake_review: "ac_source_intake_review",
};

const ENTITY_KEY: Record<string, string> = {
  opportunity: "acrt_opportunity",
  rfq: "acrt_rfq",
  tender: "acrt_tender",
  approval: "acrt_approval",
  quotation: "acrt_quotation",
};

function ActionCenter() {
  const { t, lang } = useI18n();
  const { user, roles } = useAuth();
  const uid = user?.id ?? "";
  const qc = useQueryClient();
  const isManager = canManageSalesPipeline(roles);
  const today = new Date().toISOString().slice(0, 10);

  const [filters, setFilters] = useState<ActionFilters>(DEFAULT_FILTERS);
  const [dialog, setDialog] = useState<{
    kind: "complete" | "dismiss" | "escalate" | "block";
    flagId: string;
  } | null>(null);

  const set = <K extends keyof ActionFilters>(k: K, v: ActionFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  // ── Sources ────────────────────────────────────────────────────────────────
  // Each source keeps its own table and lifecycle; this page only projects them.
  // Fetched together so one refetch key invalidates the whole queue.
  const { data: sources, isLoading } = useQuery({
    queryKey: ["unified-actions", filters.status],
    staleTime: 30_000,
    queryFn: async () => {
      const [flags, tasks, followUps, approvals, intake] = await Promise.all([
        supabase.from("opportunity_flags").select("*").order("created_at", { ascending: false }).limit(300),
        supabase
          .from("tasks")
          .select("id, title, related_opportunity_id, owner_id, priority, due_date, status, created_at, completed_at")
          .order("due_date", { ascending: true })
          .limit(200),
        supabase
          .from("follow_ups")
          .select("id, opportunity_id, owner_id, due_date, cadence_tier, channel, status, notes, created_at")
          .order("due_date", { ascending: true })
          .limit(200),
        supabase
          .from("approvals")
          .select(
            "id, approval_type, related_opportunity_id, linked_record_type, linked_record_id, requested_by, assigned_approver, status, created_at, decided_at",
          )
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("inbox_items")
          .select(
            "id, project_name, company_name, review_state, assigned_owner_id, created_by, request_type, info_due_date, info_responsible_id, created_at, reviewed_at",
          )
          .in("review_state", ["pending_review", "need_information"])
          .limit(200),
      ]);
      return {
        flags: (flags.data ?? []) as unknown as FlagRowIn[],
        tasks: (tasks.data ?? []) as unknown as TaskRowIn[],
        followUps: (followUps.data ?? []) as unknown as FollowUpRowIn[],
        approvals: (approvals.data ?? []) as unknown as ApprovalRowIn[],
        intake: (intake.data ?? []) as unknown as IntakeRowIn[],
      };
    },
  });

  const actions = useMemo(
    () =>
      assembleActions(sources ?? {}, {
        canReviewIntake: canReviewIntake(roles),
        canDecideApprovals: canApproveCommercialAction(roles),
      }, today),
    [sources, roles, today],
  );

  const visible = useMemo(
    () => filterActions(actions, filters, { uid, today }),
    [actions, filters, uid, today],
  );

  // KPIs describe the personal queue — a team-wide count is not something an
  // individual can act on, and this page's job is "what do I do next".
  const counts = useMemo(
    () => countActions(filterActions(actions, { ...DEFAULT_FILTERS, scope: "mine" }, { uid, today }), today),
    [actions, uid, today],
  );

  // Owner filter options come from whatever is actually in the queue.
  const ownerIds = useMemo(
    () => [...new Set(actions.map((a) => a.ownerUserId).filter(Boolean) as string[])],
    [actions],
  );
  const { data: owners } = useQuery({
    queryKey: ["action-owners", ownerIds.join(",")],
    staleTime: 60_000,
    enabled: ownerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ownerIds);
      return new Map((data ?? []).map((p) => [p.id, p.full_name || p.email || p.id.slice(0, 8)]));
    },
  });

  const typeOptions = useMemo(() => [...new Set(actions.map((a) => a.type))].sort(), [actions]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["unified-actions"] });

  async function handleStart(flagId: string) {
    try {
      await startAction(flagId);
      invalidate();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }

  const dialogFields: DialogField[] =
    dialog?.kind === "complete"
      ? [{ key: "note", type: "textarea", label: t("ac_complete_note") }]
      : dialog?.kind === "dismiss"
        ? [{ key: "reason", type: "textarea", label: t("ac_dismiss_reason"), required: true }]
        : dialog?.kind === "escalate"
          ? [{ key: "note", type: "textarea", label: t("ac_escalate_note") }]
          : [{ key: "reason", type: "textarea", label: t("ac_block_reason"), required: true }];

  async function handleDialogSubmit(values: Record<string, string>) {
    if (!dialog) return;
    try {
      if (dialog.kind === "complete") await completeAction(dialog.flagId, values.note);
      else if (dialog.kind === "dismiss") await dismissAction(dialog.flagId, values.reason);
      else if (dialog.kind === "escalate") await escalateAction(dialog.flagId, values.note);
      else await blockAction(dialog.flagId, values.reason);
      invalidate();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
      throw e;
    }
  }

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
      active
        ? "border-amber/40 bg-amber/10 text-amber-light"
        : "border-border/70 bg-surface/60 text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={lang === "ar" ? "أولوية العمل" : "Priority work"}
        title={t("ac_title")}
        description={t("ac_subtitle")}
        actions={
          isManager ? (
            <button
              onClick={async () => {
                try {
                  const r = (await runAutomations()) as { raised?: number };
                  toast.success(`${t("wf_run_automations")}: ${r.raised ?? 0}`);
                  invalidate();
                } catch (e) {
                  toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                }
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/70 bg-surface/60 px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <PlayCircle className="h-3.5 w-3.5" /> {t("wf_run_automations")}
            </button>
          ) : null
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <KpiCard label={t("ac_kpi_open")} value={formatNumber(counts.total, lang)} hint={lang === "ar" ? "في قائمتك" : "In your queue"} />
        <KpiCard
          label={t("ac_kpi_blocking")}
          value={formatNumber(counts.blocking, lang)}
          hint={lang === "ar" ? "توقف العمل" : "Work is stopped"}
          trend={counts.blocking > 0 ? "down" : "flat"}
        />
        <KpiCard
          label={t("ac_kpi_overdue")}
          value={formatNumber(counts.overdue, lang)}
          hint={lang === "ar" ? "تجاوزت التاريخ" : "Past due date"}
          trend={counts.overdue > 0 ? "down" : "flat"}
        />
        <KpiCard label={t("ac_kpi_due_today")} value={formatNumber(counts.dueToday, lang)} hint={lang === "ar" ? "اليوم" : "Today"} />
      </section>

      {/* Scope + urgency */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(["mine", "team", "all"] as const).map((s) => (
          <button key={s} onClick={() => set("scope", s)} className={pill(filters.scope === s)}>
            {t(`ac_scope_${s}` as never)}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border/70" aria-hidden="true" />
        {(["all", "overdue", "due_today", "upcoming"] as const).map((u) => (
          <button key={u} onClick={() => set("urgency", u)} className={pill(filters.urgency === u)}>
            {t(`ac_urgency_${u}` as never)}
          </button>
        ))}
      </div>

      {/* Status + dropdown filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {(["active", "done", "dismissed", "all"] as const).map((s) => (
            <button key={s} onClick={() => set("status", s)} className={pill(filters.status === s)}>
              {t((s === "active" ? "ac_tab_active" : s === "done" ? "ac_tab_completed" : s === "dismissed" ? "ac_tab_dismissed" : "ac_tab_all") as never)}
            </button>
          ))}
        </div>

        <div className="ms-auto flex flex-wrap gap-2">
          <Select value={filters.type} onValueChange={(v) => set("type", v)}>
            <SelectTrigger className="h-8 w-auto min-w-[9rem] border-border/70 bg-surface/60 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("crm_filter_all_types")}</SelectItem>
              {typeOptions.map((ty) => (
                <SelectItem key={ty} value={ty}>
                  {TYPE_KEY[ty] ? t(TYPE_KEY[ty] as never) : humanize(ty)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.entityType} onValueChange={(v) => set("entityType", v)}>
            <SelectTrigger className="h-8 w-auto min-w-[8rem] border-border/70 bg-surface/60 text-[11px]">
              <SelectValue placeholder={t("ac_filter_entity")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("ac_filter_entity")}</SelectItem>
              {["opportunity", "rfq", "tender", "approval", "quotation", "inbox_item"].map((e) => (
                <SelectItem key={e} value={e}>
                  {ENTITY_KEY[e] ? t(ENTITY_KEY[e] as never) : humanize(e)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.priority} onValueChange={(v) => set("priority", v as ActionFilters["priority"])}>
            <SelectTrigger className="h-8 w-auto min-w-[7rem] border-border/70 bg-surface/60 text-[11px]">
              <SelectValue placeholder={t("ac_filter_priority")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("ac_filter_priority")}</SelectItem>
              {(["A", "B", "C"] as const).map((p) => (
                <SelectItem key={p} value={p}>
                  {t("label_tier")} {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {ownerIds.length > 0 && (
            <Select value={filters.owner} onValueChange={(v) => set("owner", v)}>
              <SelectTrigger className="h-8 w-auto min-w-[8rem] border-border/70 bg-surface/60 text-[11px]">
                <SelectValue placeholder={t("ac_filter_owner")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ac_filter_owner")}</SelectItem>
                {ownerIds.map((o) => (
                  <SelectItem key={o} value={o}>
                    {owners?.get(o) ?? o.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={CheckIcon}
          title={t("empty_title_action_center")}
          description={t("empty_desc_action_center")}
        />
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          {visible.map((a) => (
            <ActionRow
              key={a.id}
              a={a}
              today={today}
              ownerName={a.ownerUserId ? owners?.get(a.ownerUserId) : undefined}
              t={t}
              lang={lang}
              onStart={() => handleStart(a.sourceRecordId)}
              onDialog={(kind) => setDialog({ kind, flagId: a.sourceRecordId })}
            />
          ))}
        </ul>
      )}

      {dialog ? (
        <ActionDialog
          open={!!dialog}
          onOpenChange={(v) => !v && setDialog(null)}
          title={t(
            (dialog.kind === "complete"
              ? "ac_complete_title"
              : dialog.kind === "dismiss"
                ? "ac_dismiss_title"
                : dialog.kind === "escalate"
                  ? "ac_escalate_title"
                  : "ac_block_title") as never,
          )}
          fields={dialogFields}
          submitLabel={t(
            (dialog.kind === "complete"
              ? "ac_complete"
              : dialog.kind === "dismiss"
                ? "ac_dismiss"
                : dialog.kind === "escalate"
                  ? "ac_escalate"
                  : "ac_block") as never,
          )}
          destructive={dialog.kind === "dismiss" || dialog.kind === "block"}
          onSubmit={handleDialogSubmit}
        />
      ) : null}
    </div>
  );
}

function ActionRow({
  a,
  today,
  ownerName,
  t,
  lang,
  onStart,
  onDialog,
}: {
  a: UnifiedAction;
  today: string;
  ownerName?: string;
  t: (k: never) => string;
  lang: "en" | "ar";
  onStart: () => void;
  onDialog: (k: "complete" | "dismiss" | "escalate" | "block") => void;
}) {
  const urgency = urgencyOf(a.dueAt, today);
  const overdue = urgency === "overdue";
  const high = a.priority === "A";
  // Only flag-sourced rows have the start/complete/escalate/block lifecycle.
  // Everything else is resolved on its own entity, so we link instead of
  // offering buttons that would silently do nothing.
  const actionable = a.source === "flag" && (["open", "in_progress", "blocked"] as string[]).includes(a.status);

  return (
    <li className="border-t border-border/60 first:border-t-0">
      <div className="grid grid-cols-[3px_minmax(0,1fr)_auto] items-stretch">
        <div
          className={a.blocking ? "bg-destructive/60" : high ? "bg-amber/70" : "bg-transparent"}
          aria-label={a.blocking ? (lang === "ar" ? "معطِّل" : "Blocking") : high ? (lang === "ar" ? "أولوية عالية" : "High priority") : undefined}
        />
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={a.blocking ? "danger" : "attention"}>
              {a.blocking ? <ShieldAlert className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {TYPE_KEY[a.type] ? t(TYPE_KEY[a.type] as never) : humanize(a.type)}
            </StatusPill>
            <StatusPill tone="muted">{t(SOURCE_KEY[a.source] as never)}</StatusPill>
            <StatusPill tone={high ? "attention" : "muted"}>
              {t("label_tier" as never)} {a.priority}
            </StatusPill>
            {a.status === "blocked" ? (
              <StatusPill tone="danger">
                <Ban className="h-3 w-3" />
                {t("acst_blocked" as never)}
              </StatusPill>
            ) : null}
            {a.dueAt ? (
              <span
                className={`num inline-flex items-center gap-1 text-[11px] ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
                data-tabular="true"
              >
                {overdue ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                {overdue ? t("urgency_overdue" as never) : t("ac_due" as never)}: {a.dueAt}
              </span>
            ) : null}
          </div>

          <Link to={a.href as never} className="mt-1.5 block truncate text-[13px] font-medium text-foreground hover:underline">
            {a.title}
          </Link>

          {/* Why this is on the list — required by PRD §2. */}
          {a.reason ? (
            <div className="mt-1 text-[12px] text-muted-foreground">
              <span className="text-amber-light">{t("ac_why" as never)}:</span> {a.reason}
            </div>
          ) : null}
          {a.context && a.context !== a.reason ? (
            <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{a.context}</div>
          ) : null}
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t("ac_owner" as never)}: {ownerName ?? t("ac_unassigned" as never)}
          </div>
        </div>

        <div className="flex items-center gap-1.5 pe-4">
          {actionable ? (
            <>
              {a.status === "open" ? (
                <button
                  onClick={onStart}
                  aria-label={t("ac_start" as never)}
                  title={t("ac_start" as never)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                >
                  <PlayIcon className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                onClick={() => onDialog("complete")}
                aria-label={t("ac_complete" as never)}
                title={t("ac_complete" as never)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-won/40 bg-won/10 text-won transition-colors duration-150 hover:bg-won/[0.16]"
              >
                <CheckIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onDialog("escalate")}
                aria-label={t("ac_escalate" as never)}
                title={t("ac_escalate" as never)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                <ArrowUpCircle className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onDialog("block")}
                aria-label={t("ac_block" as never)}
                title={t("ac_block" as never)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                <PauseCircle className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onDialog("dismiss")}
                aria-label={t("ac_dismiss" as never)}
                title={t("ac_dismiss" as never)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

