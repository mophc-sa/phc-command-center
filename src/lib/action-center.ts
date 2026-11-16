// =============================================================================
// PHC Sales OS — Unified Action abstraction (Phase 4).
//
// WHY A QUERY LAYER AND NOT A TABLE
// ---------------------------------
// "What needs to be done" is already recorded in five places, each of which is
// the rightful owner of its own lifecycle:
//
//   opportunity_flags  — the automation queue (has its own status machine,
//                        dedupe via condition_key, and start/complete/escalate
//                        /block/dismiss transitions in workflow-actions.ts)
//   tasks              — hand-written to-dos
//   follow_ups         — the contact cadence engine
//   approvals          — the decision queue (owner grants, conversions, deletes)
//   opportunities      — intake review gate (review_state), Phase 2
//
// Physically merging those into one actions table would mean rewriting five
// working state machines and migrating live rows — a large, risky change that
// buys nothing the read model below does not. So Phase 4 adds a *projection*:
// each source is mapped into one `UnifiedAction` shape, and the UI sorts and
// filters that. Sources keep their own writes; nothing here mutates.
//
// Everything in this file is pure. The page passes rows in, this returns the
// projection — so the ranking, overdue, and role rules are unit-testable
// without a database. See action-center.test.ts.
// =============================================================================

import { formatMessage, msg, type MessageRef } from "@/lib/messages";

export type ActionSource =
  | "flag"
  | "task"
  | "follow_up"
  | "approval"
  | "intake_review";

export type ActionEntityType =
  | "opportunity"
  | "rfq"
  | "tender"
  | "approval"
  | "quotation"
  | "inbox_item";

export type ActionPriority = "A" | "B" | "C";

export type ActionStatus = "open" | "in_progress" | "blocked" | "done" | "dismissed";

/** The normalized shape every source is projected into (PRD Phase 4 §3). */
export type UnifiedAction = {
  id: string;
  type: string;
  source: ActionSource;
  sourceRecordId: string;
  entityType: ActionEntityType;
  entityId: string;
  title: string;
  /** Raw source text explaining the item (a flag's reason), when there is one. */
  reason: string | null;
  /** Why this item is on the list, rendered in the reader's language. Every projection sets it. */
  why?: MessageRef;
  context: string | null;
  ownerUserId: string | null;
  /**
   * The action's OWN priority (task priority, flag priority, follow-up
   * cadence). Null when the source records none. Not the deal's tier and not
   * urgency — those are `dealTier` and the due date.
   */
  priority: ActionPriority | null;
  /** opportunities.tier of the deal the action is about, once attached. */
  dealTier?: ActionPriority | null;
  /** "code · project · client", or the company name. Never a task title or a note. */
  recordLabel?: string | null;
  dueAt: string | null;
  status: ActionStatus;
  createdAt: string;
  resolvedAt: string | null;
  /** Deep link to the originating entity. */
  href: string;
  /** True when this action cannot proceed until someone unblocks it. */
  blocking: boolean;
};

// ---- Row shapes accepted from the five sources ------------------------------
// Deliberately structural and permissive: these mirror what the existing page
// queries already select, so no query has to change shape to feed this layer.

export type FlagRowIn = {
  id: string;
  linked_record_type: string;
  linked_record_id: string;
  flag_kind: string | null;
  action_type: string | null;
  risk_flag: string | null;
  queue_action_type: string | null;
  recommended_action: string | null;
  action_owner_id: string | null;
  due_date: string | null;
  priority: string | null;
  reason: string | null;
  status: string;
  created_at: string;
  completed_at?: string | null;
};

export type TaskRowIn = {
  id: string;
  title: string;
  related_opportunity_id: string | null;
  owner_id: string | null;
  priority: string | null;
  due_date: string | null;
  status: string | null;
  created_at: string;
  completed_at?: string | null;
};

export type FollowUpRowIn = {
  id: string;
  opportunity_id: string | null;
  /** A reminder about a client rather than a deal (group 5). */
  company_id?: string | null;
  companies?: { id: string; name: string | null } | null;
  owner_id: string | null;
  due_date: string | null;
  cadence_tier: string | null;
  channel: string | null;
  status: string | null;
  notes: string | null;
  created_at: string;
};

export type ApprovalRowIn = {
  id: string;
  approval_type: string | null;
  related_opportunity_id: string | null;
  linked_record_type: string | null;
  linked_record_id: string | null;
  requested_by: string | null;
  assigned_approver: string | null;
  status: string | null;
  created_at: string;
  decided_at?: string | null;
};

/**
 * Intake rows come from `inbox_items`, not `opportunities` — the Phase 2 review
 * gate runs before a request becomes an opportunity, which is the point of the
 * gate. Note `assigned_owner_id`, not `owner_id`.
 */
export type IntakeRowIn = {
  id: string;
  project_name: string | null;
  company_name?: string | null;
  review_state: string | null;
  assigned_owner_id: string | null;
  created_by?: string | null;
  request_type: string | null;
  info_due_date: string | null;
  info_responsible_id: string | null;
  created_at: string;
  reviewed_at?: string | null;
};

// ---- Status normalization ---------------------------------------------------

const FLAG_DONE = new Set(["completed", "resolved"]);
const FLAG_ACTIVE = new Set(["open", "in_progress", "escalated", "blocked"]);

function flagStatus(s: string): ActionStatus {
  if (FLAG_DONE.has(s)) return "done";
  if (s === "dismissed") return "dismissed";
  if (s === "in_progress") return "in_progress";
  if (s === "blocked" || s === "escalated") return "blocked";
  return "open";
}

/** priority_tier is A/B/C across the schema; anything else is "none recorded". */
function normalizePriority(p: string | null | undefined): ActionPriority | null {
  return p === "A" || p === "B" || p === "C" ? p : null;
}

/** Free text from a source row, carried through the translation layer untouched. */
const text = (t: string): MessageRef => msg("ac_why_text", { text: t });

/**
 * A follow-up's title: the first meaningful line of its note, without a
 * leading import tag like "[targets-2026-11]", capped. Imported notes run to
 * ~1,900 characters and must never become a row title whole.
 */
export function followUpTitle(notes: string | null | undefined, max = 80): string | null {
  for (const raw of (notes ?? "").split(/\r?\n/)) {
    const line = raw.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/^[\s•\-–*]+/, "").trim();
    if (!line) continue;
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return null;
}

/** The identity line for a deal: "code · project · client". */
export function opportunityLabel(o: {
  project_code?: string | null;
  project_name?: string | null;
  client?: string | null;
  main_contractor?: string | null;
}): string | null {
  const parts = [o.project_code, o.project_name, o.client || o.main_contractor]
    .map((p) => p?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Columns the UI fetches to attach deal identity and tier to actions. */
export const OPPORTUNITY_RECORD_COLUMNS = "id, project_name, project_code, client, main_contractor, tier";

export type OpportunityRecord = {
  id: string;
  project_name?: string | null;
  project_code?: string | null;
  client?: string | null;
  main_contractor?: string | null;
  tier?: string | null;
};

/** Attach deal identity + tier. Pure; actions not about a known deal are returned unchanged. */
export function attachRecords(actions: UnifiedAction[], opportunities: OpportunityRecord[]): UnifiedAction[] {
  const byId = new Map(opportunities.map((o) => [o.id, o]));
  return actions.map((a) => {
    const o = a.entityType === "opportunity" && a.entityId ? byId.get(a.entityId) : undefined;
    return o ? { ...a, recordLabel: opportunityLabel(o) ?? a.recordLabel ?? null, dealTier: normalizePriority(o.tier) } : a;
  });
}

/** True for a task that is not about any deal — it has no record to open. */
export const isUnlinkedTask = (a: UnifiedAction) => a.source === "task" && !a.entityId;

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
  intake_review: "acty_intake_review",
  intake_need_information: "acty_intake_need_information",
};

export const SOURCE_KEY: Record<ActionSource, string> = {
  flag: "ac_source_flag",
  task: "ac_source_task",
  follow_up: "ac_source_follow_up",
  approval: "ac_source_approval",
  intake_review: "ac_source_intake_review",
};

/**
 * The "why" line in the reader's language. `t` follows the i18n contract of
 * returning the key itself when there is no translation, so a string slot is
 * translated only when a channel label exists and otherwise shown as written.
 */
export function whyText(a: UnifiedAction, t: (k: string) => string, num: (n: number) => string): string {
  return (
    formatMessage(a.why ?? msg(actionTypeKey(a)), t, (v) => {
      if (typeof v === "number") return num(v);
      const key = `channel_${v}`;
      const label = t(key);
      return label === key ? v : label;
    }) ?? ""
  );
}

/** i18n key for an action's type; unknown codes fall back to the source label, never the raw code. */
export function actionTypeKey(a: Pick<UnifiedAction, "type" | "source">): string {
  return TYPE_KEY[a.type] ?? SOURCE_KEY[a.source];
}

// ---- Deep links -------------------------------------------------------------
// Every action must open the originating entity, not a list page, whenever the
// entity has its own route. Only `opportunity` currently has a detail route;
// the rest deep-link to their list, which is the existing behaviour.

const LIST_ROUTE: Record<string, string> = {
  opportunity: "/opportunities",
  rfq: "/quotations",
  tender: "/tenders",
  approval: "/approvals",
  quotation: "/quotations",
  inbox_item: "/lead-tender-inbox",
};

export function actionHref(entityType: string, entityId: string): string {
  if (entityType === "inbox_item" && entityId) return `/lead-tender-inbox?item=${encodeURIComponent(entityId)}`;
  if (entityType === "opportunity" && entityId) return `/opportunities/${entityId}`;
  return LIST_ROUTE[entityType] ?? "/action-center";
}

function asEntityType(t: string | null | undefined): ActionEntityType {
  switch (t) {
    case "opportunity":
    case "rfq":
    case "tender":
    case "approval":
    case "quotation":
    case "inbox_item":
      return t;
    default:
      return "opportunity";
  }
}

// ---- Projections ------------------------------------------------------------

export function fromFlag(f: FlagRowIn): UnifiedAction {
  const entityType = asEntityType(f.linked_record_type);
  const status = flagStatus(f.status);
  return {
    id: `flag:${f.id}`,
    type: f.queue_action_type ?? f.action_type ?? f.risk_flag ?? f.flag_kind ?? "flag",
    source: "flag",
    sourceRecordId: f.id,
    entityType,
    entityId: f.linked_record_id,
    title: f.reason ?? f.recommended_action ?? f.queue_action_type ?? "Action required",
    reason: f.reason,
    why: f.reason ? text(f.reason) : f.recommended_action ? text(f.recommended_action) : msg("ac_why_queue"),
    context: f.recommended_action,
    ownerUserId: f.action_owner_id,
    // The flag's own priority column. A risk flag is NOT promoted to "A" here:
    // urgency comes from the due date and blocking from status, and inventing
    // a priority made every risk row read as top-tier work.
    priority: normalizePriority(f.priority),
    dueAt: f.due_date,
    status,
    createdAt: f.created_at,
    resolvedAt: f.completed_at ?? null,
    href: actionHref(entityType, f.linked_record_id),
    blocking: status === "blocked",
  };
}

export function fromTask(t: TaskRowIn): UnifiedAction {
  const entityId = t.related_opportunity_id ?? "";
  return {
    id: `task:${t.id}`,
    type: "task",
    source: "task",
    sourceRecordId: t.id,
    entityType: "opportunity",
    entityId,
    title: t.title,
    reason: null,
    why: msg(entityId ? "ac_why_task" : "ac_why_task_unlinked"),
    context: null,
    ownerUserId: t.owner_id,
    priority: normalizePriority(t.priority),
    dueAt: t.due_date,
    status:
      t.status === "done" ? "done"
      : t.status === "cancelled" ? "dismissed"
      : t.status === "in_progress" ? "in_progress"
      : "open",
    createdAt: t.created_at,
    resolvedAt: t.completed_at ?? null,
    // An unlinked task has no deal to open; /opportunities/ with an empty id is a dead page.
    href: entityId ? actionHref("opportunity", entityId) : "/my-workspace",
    blocking: false,
  };
}

export function fromFollowUp(f: FollowUpRowIn): UnifiedAction {
  const entityId = f.opportunity_id ?? "";
  const done = f.status === "completed" || f.status === "cancelled";
  return {
    id: `follow_up:${f.id}`,
    type: "follow_up",
    source: "follow_up",
    sourceRecordId: f.id,
    entityType: "opportunity",
    entityId,
    title: followUpTitle(f.notes) ?? "",
    reason: null,
    why: f.channel ? msg("ac_why_follow_up_channel", { channel: f.channel }) : msg("ac_why_follow_up"),
    context: f.notes,
    recordLabel: !f.opportunity_id && f.companies?.name ? f.companies.name : null,
    ownerUserId: f.owner_id,
    priority: normalizePriority(f.cadence_tier),
    dueAt: f.due_date,
    status: f.status === "cancelled" ? "dismissed" : done ? "done" : "open",
    createdAt: f.created_at,
    resolvedAt: null,
    href: f.opportunity_id || !f.company_id ? actionHref("opportunity", entityId) : `/accounts/${f.company_id}`,
    blocking: false,
  };
}

export function fromApproval(a: ApprovalRowIn): UnifiedAction {
  // An approval's own row is the entity a decision is taken on, but the useful
  // deep link is the opportunity it concerns when there is one.
  const entityType = asEntityType(a.linked_record_type ?? "approval");
  const entityId = a.related_opportunity_id ?? a.linked_record_id ?? a.id;
  const pending = a.status === "pending";
  return {
    id: `approval:${a.id}`,
    type: a.approval_type ?? "approval",
    source: "approval",
    sourceRecordId: a.id,
    entityType: a.related_opportunity_id ? "opportunity" : entityType,
    entityId,
    title: a.approval_type ?? "Approval",
    reason: pending ? "Awaiting decision" : null,
    why: msg(pending ? "ac_why_approval_pending" : "ac_why_approval"),
    context: null,
    ownerUserId: a.assigned_approver,
    // An approval has no priority of its own. A pending one is BLOCKING (below),
    // which already ranks it first — it is not also "tier A".
    priority: null,
    dueAt: null,
    status: pending ? "open" : a.status === "escalated" ? "blocked" : "done",
    createdAt: a.created_at,
    resolvedAt: a.decided_at ?? null,
    href: a.related_opportunity_id
      ? actionHref("opportunity", a.related_opportunity_id)
      : "/approvals",
    blocking: pending,
  };
}

/**
 * Intake review (Phase 2). Two distinct actions live on the same row and they
 * belong to different people, so they must not collapse into one item:
 *   pending_review   → the reviewer must decide
 *   need_information → the requester must supply what was asked for
 */
export function fromIntake(o: IntakeRowIn): UnifiedAction | null {
  const state = o.review_state;
  const label = o.project_name ?? o.company_name ?? "New request";
  if (state === "pending_review") {
    return {
      id: `intake_review:${o.id}`,
      type: "intake_review",
      source: "intake_review",
      sourceRecordId: o.id,
      entityType: "inbox_item",
      entityId: o.id,
      title: label,
      reason: "Awaiting intake review",
      why: msg("ac_why_intake_review"),
      recordLabel: label,
      context: o.request_type,
      // Reviewer is role-derived, not a column. Left null so the item counts as
      // unowned-and-blocking, which is what puts it in every reviewer's queue.
      ownerUserId: null,
      priority: null,
      dueAt: null,
      status: "open",
      createdAt: o.created_at,
      resolvedAt: o.reviewed_at ?? null,
      href: actionHref("inbox_item", o.id),
      blocking: true,
    };
  }
  if (state === "need_information") {
    return {
      id: `intake_info:${o.id}`,
      type: "intake_need_information",
      source: "intake_review",
      sourceRecordId: o.id,
      entityType: "inbox_item",
      entityId: o.id,
      title: label,
      reason: "Information requested",
      why: msg("ac_why_intake_info"),
      recordLabel: label,
      context: o.request_type,
      ownerUserId: o.info_responsible_id ?? o.assigned_owner_id ?? o.created_by ?? null,
      priority: null,
      dueAt: o.info_due_date,
      status: "open",
      createdAt: o.created_at,
      resolvedAt: null,
      href: actionHref("inbox_item", o.id),
      blocking: true,
    };
  }
  return null;
}

// ---- Urgency ----------------------------------------------------------------

export type Urgency = "overdue" | "due_today" | "due_soon" | "upcoming" | "none";

/** `today` and `dueAt` are both YYYY-MM-DD; string compare is correct and TZ-free. */
export function urgencyOf(dueAt: string | null, today: string, soonDays = 7): Urgency {
  if (!dueAt) return "none";
  const due = dueAt.slice(0, 10);
  if (due < today) return "overdue";
  if (due === today) return "due_today";
  const soon = addDays(today, soonDays);
  if (due <= soon) return "due_soon";
  return "upcoming";
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days past due, or null when not overdue. */
export function overdueDays(dueAt: string | null, today: string): number | null {
  if (!dueAt || urgencyOf(dueAt, today) !== "overdue") return null;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueAt.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/**
 * Overdue for longer than this is "stale": still owed, but no longer today's
 * work. 224 imported company follow-ups landed months overdue at once; ranking
 * them as today's top items buried everything actually due.
 */
export const STALE_OVERDUE_DAYS = 30;

export const isStaleOverdue = (a: UnifiedAction, today: string) =>
  !a.blocking && (overdueDays(a.dueAt, today) ?? 0) > STALE_OVERDUE_DAYS;

// ---- Ranking ----------------------------------------------------------------
// PRD Phase 4 §2 order:
//   1 critical/blocking · 2 overdue (most recent first) · 3 due today
//   4 deal tier A · 5 upcoming · 6 stale overdue (> STALE_OVERDUE_DAYS)
// "Tier" is the deal's tier, falling back to the action's own priority when
// the action is not about a deal. Ties break on tier, due date, then creation,
// so the list is stable across renders.

const URGENCY_RANK: Record<Urgency, number> = {
  overdue: 0,
  due_today: 1,
  due_soon: 2,
  upcoming: 3,
  none: 4,
};

const TIER_RANK: Record<ActionPriority, number> = { A: 0, B: 1, C: 2 };
const tierOf = (a: UnifiedAction) => a.dealTier ?? a.priority;
const tierRank = (a: UnifiedAction) => {
  const t = tierOf(a);
  return t ? TIER_RANK[t] : 3;
};

export function rankOf(a: UnifiedAction, today: string): number {
  if (a.blocking) return 0;
  const u = urgencyOf(a.dueAt, today);
  if (u === "overdue") return isStaleOverdue(a, today) ? 9 : 1;
  if (u === "due_today") return 2;
  if (tierOf(a) === "A") return 3;
  return 4 + URGENCY_RANK[u];
}

export function sortActions(actions: UnifiedAction[], today: string): UnifiedAction[] {
  return [...actions].sort((a, b) => {
    const r = rankOf(a, today) - rankOf(b, today);
    if (r !== 0) return r;
    const p = tierRank(a) - tierRank(b);
    if (p !== 0) return p;
    // Overdue: the most recently missed first — yesterday's miss is still
    // recoverable, a two-month-old one will keep. Everything else: soonest first.
    const late = urgencyOf(a.dueAt, today) === "overdue" ? -1 : 1;
    if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -late : late;
    if (a.dueAt && !b.dueAt) return -1;
    if (!a.dueAt && b.dueAt) return 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

// ---- Filtering --------------------------------------------------------------

export type ScopeFilter = "mine" | "team" | "all";
export type UrgencyFilter = "all" | "overdue" | "due_today" | "upcoming";
export type StatusFilter = "active" | "done" | "dismissed" | "all";

export type ActionFilters = {
  scope: ScopeFilter;
  urgency: UrgencyFilter;
  status: StatusFilter;
  type: string | "all";
  entityType: string | "all";
  priority: ActionPriority | "all";
  owner: string | "all";
};

export const DEFAULT_FILTERS: ActionFilters = {
  scope: "mine",
  urgency: "all",
  status: "active",
  type: "all",
  entityType: "all",
  priority: "all",
  owner: "all",
};

const ACTIVE_STATUSES = new Set<ActionStatus>(["open", "in_progress", "blocked"]);

export function filterActions(
  actions: UnifiedAction[],
  filters: ActionFilters,
  ctx: { uid: string; today: string },
): UnifiedAction[] {
  return actions.filter((a) => {
    if (filters.status === "active" && !ACTIVE_STATUSES.has(a.status)) return false;
    if (filters.status === "done" && a.status !== "done") return false;
    if (filters.status === "dismissed" && a.status !== "dismissed") return false;

    // "mine" includes unassigned blocking work: an unowned blocker is nobody's
    // job by definition, and hiding it from every personal queue is how it
    // stays unowned. "team" is everything else that is owned by someone else.
    if (filters.scope === "mine") {
      const mine = a.ownerUserId === ctx.uid || (a.ownerUserId === null && a.blocking);
      if (!mine) return false;
    }
    if (filters.scope === "team" && a.ownerUserId === ctx.uid) return false;

    if (filters.urgency !== "all") {
      const u = urgencyOf(a.dueAt, ctx.today);
      if (filters.urgency === "overdue" && u !== "overdue") return false;
      if (filters.urgency === "due_today" && u !== "due_today") return false;
      if (filters.urgency === "upcoming" && u !== "due_soon" && u !== "upcoming") return false;
    }

    if (filters.type !== "all" && a.type !== filters.type) return false;
    if (filters.entityType !== "all" && a.entityType !== filters.entityType) return false;
    if (filters.priority !== "all" && a.priority !== filters.priority) return false;
    if (filters.owner !== "all" && a.ownerUserId !== filters.owner) return false;
    return true;
  });
}

// ---- Counters ---------------------------------------------------------------

export type ActionCounts = {
  total: number;
  blocking: number;
  overdue: number;
  dueToday: number;
  upcoming: number;
};

export function countActions(actions: UnifiedAction[], today: string): ActionCounts {
  let blocking = 0;
  let overdue = 0;
  let dueToday = 0;
  let upcoming = 0;
  for (const a of actions) {
    if (!ACTIVE_STATUSES.has(a.status)) continue;
    if (a.blocking) blocking++;
    const u = urgencyOf(a.dueAt, today);
    if (u === "overdue") overdue++;
    else if (u === "due_today") dueToday++;
    else if (u === "due_soon" || u === "upcoming") upcoming++;
  }
  return { total: actions.filter((a) => ACTIVE_STATUSES.has(a.status)).length, blocking, overdue, dueToday, upcoming };
}

/**
 * The "what do I need to do today" slice for My Workspace — the personal queue
 * only, already ranked, capped so the panel stays a to-do list and not a
 * second Action Center. `total` is everything that would have been shown
 * uncapped (for "+N more"); stale overdue work is returned apart so it does not
 * inflate today.
 */
export function todaysWork(
  actions: UnifiedAction[],
  ctx: { uid: string; today: string },
  limit = 8,
): { items: UnifiedAction[]; total: number; stale: UnifiedAction[] } {
  const mine = sortActions(filterActions(actions, { ...DEFAULT_FILTERS, scope: "mine" }, ctx), ctx.today);
  const current = mine.filter((a) => !isStaleOverdue(a, ctx.today));
  return {
    items: current.slice(0, limit),
    total: current.length,
    stale: mine.filter((a) => isStaleOverdue(a, ctx.today)),
  };
}

// ---- Role-aware assembly ----------------------------------------------------

/**
 * Which sources a viewer is allowed to see at all.
 *
 * This exists because two action types are addressed to an *authority* rather
 * than to a person, so they carry no owner column:
 *
 *   intake_review — belongs to whoever may review intake
 *   approval      — belongs to whoever may decide it
 *
 * `filterActions` treats an unowned blocking item as "mine" (so it is never
 * invisible to everyone). That rule is right for the people who hold the
 * authority and wrong for everyone else — without this gate a salesperson's
 * personal queue would fill with reviews they cannot action, which is exactly
 * what PRD §8 forbids. Authorization itself still lives in the database; this
 * only decides what is worth showing.
 */
export type ActionVisibility = {
  canReviewIntake: boolean;
  canDecideApprovals: boolean;
};

export function visibleActions(
  actions: UnifiedAction[],
  v: ActionVisibility,
): UnifiedAction[] {
  return actions.filter((a) => {
    if (a.source === "intake_review" && a.type === "intake_review") {
      return v.canReviewIntake;
    }
    // A need-information item is addressed to a named person, not to the
    // reviewer role, so it is not gated here — its owner column does the work.
    if (a.source === "approval" && a.ownerUserId === null) {
      return v.canDecideApprovals;
    }
    return true;
  });
}

/** Convenience: project every source, gate by role, rank. */
export function assembleActions(
  sources: {
    flags?: FlagRowIn[];
    tasks?: TaskRowIn[];
    followUps?: FollowUpRowIn[];
    approvals?: ApprovalRowIn[];
    intake?: IntakeRowIn[];
  },
  visibility: ActionVisibility,
  today: string,
): UnifiedAction[] {
  const all: UnifiedAction[] = [
    ...(sources.flags ?? []).map(fromFlag),
    ...(sources.tasks ?? []).map(fromTask),
    ...(sources.followUps ?? []).map(fromFollowUp),
    ...(sources.approvals ?? []).map(fromApproval),
    ...(sources.intake ?? []).map(fromIntake).filter((a): a is UnifiedAction => a !== null),
  ];
  return sortActions(visibleActions(all, visibility), today);
}
