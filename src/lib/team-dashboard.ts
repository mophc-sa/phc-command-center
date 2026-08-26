// =============================================================================
// PHC Sales OS — Team Life Dashboard (Phase 5).
//
// Answers the sales manager's real question — "what happened today, and who
// needs me?" — rather than showing another grid of totals.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO
// ----------------------------------------
// 1. It does not rank people by volume. Counting completed tasks and sorting
//    descending measures typing, not selling, and the moment a number like that
//    is visible people optimise for it. The per-member summary therefore reports
//    activity WITHOUT a score, an ordering by output, or a "top performer".
//    Ordering is by pipeline value, which is a fact about the work, not a
//    judgement about the person.
//
// 2. It does not invent an action system. "Needs your attention" is a filter
//    over the Phase 4 UnifiedAction projection plus the deterministic findings
//    from pipelineHealth — one source of truth for what needs doing, shared
//    with My Workspace and the Action Center.
//
// Pure. See team-dashboard.test.ts.
// =============================================================================

import {
  filterActions,
  urgencyOf,
  DEFAULT_FILTERS,
  type UnifiedAction,
} from "@/lib/action-center";
import {
  openPipeline,
  pipelineHealth,
  type HealthFinding,
  type KpiContext,
  type OppRow,
} from "@/lib/sales-kpis";
import { buildTimeline, type TimelineEvent, type TimelineSources } from "@/lib/opportunity-timeline";

// ---- Per-member daily summary (PRD §8, §12) --------------------------------

export type MemberSummary = {
  userId: string;
  /** Current state, not a period count. */
  activeOpportunities: number;
  openPipelineValue: number;
  openActions: number;
  overdueActions: number;
  dueTodayActions: number;
  /** Things that happened today. Reported, never scored. */
  actionsCompletedToday: number;
  followUpsCompletedToday: number;
  stageMovesToday: number;
  approvalsSubmittedToday: number;
  approvalsDecidedToday: number;
  /** Standing gaps worth a manager's attention. */
  opportunitiesWithNoNextAction: number;
  stalledOpportunities: number;
};

const isToday = (iso: string | null | undefined, today: string) => !!iso && iso.slice(0, 10) === today;

export function memberSummary(input: {
  userId: string;
  opportunities: OppRow[];
  actions: UnifiedAction[];
  events: TimelineEvent[];
  today: string;
}): MemberSummary {
  const { userId, today } = input;
  const ctx: KpiContext = { today, period: null, ownerId: userId };

  const mine = input.opportunities.filter((o) => o.owner_id === userId);
  const pipeline = openPipeline(mine, { today, period: null });
  const health = pipelineHealth(mine, { today, period: null });

  const myActions = input.actions.filter((a) => a.ownerUserId === userId);
  const active = myActions.filter((a) => a.status === "open" || a.status === "in_progress" || a.status === "blocked");

  // Events are already attributed to a user by the timeline projection; an event
  // with no recorded actor is counted for nobody rather than guessed at.
  const myEvents = input.events.filter((e) => e.actorId === userId && isToday(e.at, today));

  return {
    userId,
    activeOpportunities: pipeline.recordCount,
    openPipelineValue: pipeline.value ?? 0,
    openActions: active.length,
    overdueActions: active.filter((a) => urgencyOf(a.dueAt, today) === "overdue").length,
    dueTodayActions: active.filter((a) => urgencyOf(a.dueAt, today) === "due_today").length,
    actionsCompletedToday: myActions.filter((a) => a.status === "done" && isToday(a.resolvedAt, today)).length,
    followUpsCompletedToday: myEvents.filter((e) => e.type === "follow_up_completed").length,
    stageMovesToday: myEvents.filter((e) => e.type === "stage_changed" || e.type === "tender_stage_changed").length,
    approvalsSubmittedToday: myEvents.filter((e) => e.type === "approval_requested").length,
    approvalsDecidedToday: myEvents.filter((e) => e.type.startsWith("approval_") && e.type !== "approval_requested").length,
    opportunitiesWithNoNextAction: health.filter((h) => h.issue === "no_next_action").length,
    stalledOpportunities: health.filter((h) => h.issue === "no_recent_crm_activity").length,
  };
}

/**
 * A plain-language line per member, built only from counted facts.
 *
 * Deterministic on purpose: this is the sentence a manager reads first, so it
 * must be something they can verify by clicking, not something a model wrote.
 */
export function summarySentence(s: MemberSummary, lang: "en" | "ar"): string {
  const parts: string[] = [];
  if (lang === "ar") {
    if (s.actionsCompletedToday) parts.push(`${s.actionsCompletedToday} إجراء مكتمل`);
    if (s.followUpsCompletedToday) parts.push(`${s.followUpsCompletedToday} متابعة`);
    if (s.stageMovesToday) parts.push(`${s.stageMovesToday} تحرّك في المراحل`);
    if (s.overdueActions) parts.push(`${s.overdueActions} متأخر`);
    if (s.approvalsSubmittedToday) parts.push(`${s.approvalsSubmittedToday} طلب اعتماد`);
    return parts.length ? parts.join(" · ") : "لا نشاط مسجل اليوم";
  }
  if (s.actionsCompletedToday) parts.push(`${s.actionsCompletedToday} action${s.actionsCompletedToday > 1 ? "s" : ""} completed`);
  if (s.followUpsCompletedToday) parts.push(`${s.followUpsCompletedToday} follow-up${s.followUpsCompletedToday > 1 ? "s" : ""}`);
  if (s.stageMovesToday) parts.push(`${s.stageMovesToday} stage move${s.stageMovesToday > 1 ? "s" : ""}`);
  if (s.overdueActions) parts.push(`${s.overdueActions} overdue`);
  if (s.approvalsSubmittedToday) parts.push(`${s.approvalsSubmittedToday} approval requested`);
  return parts.length ? parts.join(" · ") : "No recorded activity today";
}

// ---- Workload (PRD §11) -----------------------------------------------------

export type WorkloadRow = MemberSummary & {
  highPriorityActions: number;
  highValueOpportunities: number;
  /** Drilldown for the whole row. */
  drilldown: { to: string; search: Record<string, string> };
};

export function teamWorkload(input: {
  userIds: string[];
  opportunities: OppRow[];
  actions: UnifiedAction[];
  events: TimelineEvent[];
  today: string;
  highValue?: number;
}): WorkloadRow[] {
  const highValue = input.highValue ?? 500_000;
  return input.userIds
    .map((userId) => {
      const s = memberSummary({ ...input, userId });
      const myActions = input.actions.filter((a) => a.ownerUserId === userId);
      const mine = input.opportunities.filter((o) => o.owner_id === userId);
      return {
        ...s,
        highPriorityActions: myActions.filter(
          (a) => a.priority === "A" && (a.status === "open" || a.status === "in_progress" || a.status === "blocked"),
        ).length,
        highValueOpportunities: mine.filter((o) => {
          const v = Number(o.contract_value ?? o.quotation_value ?? o.estimated_value_max ?? 0);
          return Number.isFinite(v) && v >= highValue;
        }).length,
        drilldown: { to: "/opportunities", search: { owner: userId, stage: "open" } },
      };
    })
    // Ordered by pipeline value — a fact about the work, not a ranking of people.
    .sort((a, b) => b.openPipelineValue - a.openPipelineValue);
}

// ---- Needs your attention (PRD §10) ----------------------------------------

export type AttentionSeverity = "critical" | "high" | "watch";

export type AttentionItem = {
  id: string;
  severity: AttentionSeverity;
  reason: string;
  entityLabel: string;
  ownerUserId: string | null;
  href: string;
  value: number | null;
  source: "action" | "health";
};

const HEALTH_SEVERITY: Record<HealthFinding["issue"], AttentionSeverity> = {
  no_next_action: "high",
  // A dated action that has slipped is a worse signal than an undated one is a
  // gap, so this sits a band lower than a missing action outright.
  no_next_action_date: "watch",
  no_recent_crm_activity: "watch",
  expected_close_overdue: "critical",
  high_value_low_probability: "high",
  unscored: "watch",
};

const HEALTH_REASON: Record<HealthFinding["issue"], string> = {
  no_next_action: "No next action set",
  no_next_action_date: "Next action has no date",
  no_recent_crm_activity: "No CRM activity logged recently",
  expected_close_overdue: "Expected close date has passed",
  high_value_low_probability: "High value, low probability",
  unscored: "No probability recorded",
};

/**
 * One queue, assembled from the Phase 4 actions the manager owns plus the
 * deterministic health findings. Ordered critical first, then by value — a
 * blocked half-million deal outranks a blocked small one.
 */
export function needsAttention(input: {
  actions: UnifiedAction[];
  opportunities: OppRow[];
  managerId: string;
  today: string;
  limit?: number;
}): AttentionItem[] {
  const { managerId, today } = input;
  const out: AttentionItem[] = [];

  // Actions addressed to the manager, plus unowned blockers, which is exactly
  // what filterActions' "mine" scope already means.
  const mine = filterActions(input.actions, { ...DEFAULT_FILTERS, scope: "mine" }, { uid: managerId, today });
  for (const a of mine) {
    const overdue = urgencyOf(a.dueAt, today) === "overdue";
    if (!a.blocking && !overdue && a.priority !== "A") continue;
    out.push({
      id: a.id,
      severity: a.blocking || overdue ? "critical" : "high",
      reason: a.blocking ? (a.reason ?? "Blocking") : overdue ? `Overdue since ${a.dueAt}` : (a.reason ?? "High priority"),
      entityLabel: a.title,
      ownerUserId: a.ownerUserId,
      href: a.href,
      value: null,
      source: "action",
    });
  }

  for (const h of pipelineHealth(input.opportunities, { today, period: null })) {
    out.push({
      id: `health:${h.issue}:${h.opportunityId}`,
      severity: HEALTH_SEVERITY[h.issue],
      reason: `${HEALTH_REASON[h.issue]} — ${h.detail}`,
      entityLabel: h.label,
      ownerUserId: null,
      href: `/opportunities/${h.opportunityId}`,
      value: h.value,
      source: "health",
    });
  }

  const rank: Record<AttentionSeverity, number> = { critical: 0, high: 1, watch: 2 };
  const sorted = out.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (b.value ?? 0) - (a.value ?? 0),
  );
  return input.limit ? sorted.slice(0, input.limit) : sorted;
}

// ---- Team activity feed (PRD §9) -------------------------------------------

/**
 * The team's chronological history, assembled from the same timeline projection
 * a single opportunity uses — so an event reads identically wherever it appears
 * and there is no second definition of "what happened".
 */
export function teamActivityFeed(
  sourcesPerEntity: TimelineSources[],
  opts: { limit?: number } = {},
): TimelineEvent[] {
  const all = sourcesPerEntity.flatMap((s) => buildTimeline(s));
  const sorted = all.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
  return opts.limit ? sorted.slice(0, opts.limit) : sorted;
}

// ---- Daily rollup (PRD §12) -------------------------------------------------

export type TeamDay = {
  actionsCompleted: number;
  followUpsCompleted: number;
  stageMoves: number;
  approvalsRequested: number;
  approvalsDecided: number;
  membersActive: number;
  membersWithNoActivity: string[];
};

export function teamDay(summaries: MemberSummary[]): TeamDay {
  const active = summaries.filter(
    (s) =>
      s.actionsCompletedToday + s.followUpsCompletedToday + s.stageMovesToday + s.approvalsSubmittedToday > 0,
  );
  return {
    actionsCompleted: summaries.reduce((n, s) => n + s.actionsCompletedToday, 0),
    followUpsCompleted: summaries.reduce((n, s) => n + s.followUpsCompletedToday, 0),
    stageMoves: summaries.reduce((n, s) => n + s.stageMovesToday, 0),
    approvalsRequested: summaries.reduce((n, s) => n + s.approvalsSubmittedToday, 0),
    approvalsDecided: summaries.reduce((n, s) => n + s.approvalsDecidedToday, 0),
    membersActive: active.length,
    // Surfaced as a fact to look into, not as a verdict on anyone.
    membersWithNoActivity: summaries.filter((s) => !active.includes(s)).map((s) => s.userId),
  };
}
