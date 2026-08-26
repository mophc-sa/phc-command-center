// =============================================================================
// Phase 5.1 Package B — action intelligence.
//
// One management item per OPPORTUNITY, never one per issue. The dashboard this
// replaces listed NEW MURABBA ACTIVATION CENTRE twice because it had two
// overdue follow-ups, which is how a queue of four real problems reads as eight
// and a manager stops trusting the count.
//
// Everything here is DETERMINISTIC. The same rows on the same day produce the
// same bands in the same order, with no model in the path — an AI may explain a
// result and suggest a next action, but it cannot change one. That is not
// caution for its own sake: a priority list that reorders itself between two
// page loads is worse than no priority list, because the manager cannot tell
// whether the deal moved or the model did.
//
//   opportunities ─┐
//   follow_ups ────┤
//   activities ────┼──▶ collectReasons() ──▶ scoreOf() ──▶ band ──▶ AttentionItem
//   transitions ───┤         (rules)          (points)    (cuts)     (1 per opp)
//   health ────────┘              │                                      │
//                                 └──────── reasons[] ───────────────────┘
//                                        (the drill-down)
// =============================================================================

import {
  DEFAULT_HEALTH,
  canonicalStageOf,
  opportunityValue,
  resolveProbability,
  type HealthThresholds,
  type OppRow,
} from "@/lib/sales-kpis";
import { CANONICAL_ACTIVE_STAGES, type CanonicalStage } from "@/lib/stage-canonical";

// ---- Inputs -----------------------------------------------------------------

/** `next_action_due` is on the table but was missing from OppRow, so §20's
 *  "Next Action AND Next Action Date" could not be checked. */
export type AttentionOpp = OppRow & {
  next_action_due?: string | null;
  contractor_decision_maker?: string | null;
};

export type FollowUpRow = {
  id: string;
  opportunity_id: string;
  due_date: string;
  status?: string | null;
};

export type ActivityRow = {
  id: string;
  opportunity_id?: string | null;
  activity_type?: string | null;
  status?: string | null;
  created_at: string;
};

export type StageTransitionRow = {
  record_type?: string | null;
  record_id: string;
  from_stage?: string | null;
  to_stage: string;
  created_at: string;
};

// ---- What counts as contact with the client ---------------------------------
//
// A note is something we wrote to ourselves and a draft is something we did not
// send. Counting either as client contact makes a silent deal look attended to,
// which is the precise failure "no client response for nine days" is meant to
// catch.

const ALWAYS_CLIENT_FACING = new Set(["call", "visit", "meeting"]);
const CLIENT_FACING_WHEN_SENT = new Set(["email_draft", "whatsapp_draft"]);

export function isMeaningfulClientActivity(a: ActivityRow): boolean {
  const type = a.activity_type ?? "";
  if (ALWAYS_CLIENT_FACING.has(type)) return true;
  if (CLIENT_FACING_WHEN_SENT.has(type)) return a.status === "sent";
  return false;
}

// ---- Thresholds -------------------------------------------------------------

export type AttentionThresholds = HealthThresholds & {
  /** Days of silence before a deal counts as inactive. */
  inactiveDays: number;
  /** An expected close within this many days is "closing soon". */
  closingSoonDays: number;
  /** Completed stage spells needed before a baseline is trustworthy. */
  minBaselineObservations: number;
  /**
   * Business-set maximum days in a stage. DELIBERATELY EMPTY.
   *
   * This existed briefly as a flat 21-day default, which was a mistake worth
   * recording: stage_transition_history is sparse today (most opportunities
   * have never moved), so almost every baseline resolves to "unavailable" and
   * that 21 would have become the de facto benchmark for the entire book —
   * an invented duration presented as a measured one, which is the same defect
   * as the 0.20 forecast weight in a different costume.
   *
   * When the business sets real per-stage SLAs they belong here, and a
   * configured SLA is evidence in the same way a measured baseline is. Until
   * then a stage with no baseline has no limit, and age alone cannot stall a
   * deal.
   */
  stageSla?: Partial<Record<CanonicalStage, number>>;
};

export const DEFAULT_ATTENTION: AttentionThresholds = {
  ...DEFAULT_HEALTH,
  inactiveDays: 14,
  closingSoonDays: 30,
  minBaselineObservations: 5,
  stageSla: {},
};

export function daysBetween(fromIso: string, today: string): number | null {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

// ---- Stage aging (§10) ------------------------------------------------------

export type BaselineSource = "median" | "unavailable";

export type StageBaseline = {
  stage: CanonicalStage;
  days: number | null;
  observations: number;
  source: BaselineSource;
};

/**
 * Median, not mean, and only from COMPLETED spells.
 *
 * Median because one deal parked for 400 days drags a mean far enough to make
 * every other deal look healthy. Completed spells only because a deal still
 * sitting in a stage tells you it has been there N days, not how long the stage
 * takes — counting it would bias the baseline toward whatever is currently
 * stuck, which is exactly backwards.
 */
export function stageBaselines(
  transitions: StageTransitionRow[],
  t: AttentionThresholds = DEFAULT_ATTENTION,
): Map<CanonicalStage, StageBaseline> {
  const byRecord = new Map<string, StageTransitionRow[]>();
  for (const tr of transitions) {
    if (tr.record_type && tr.record_type !== "opportunity") continue;
    const list = byRecord.get(tr.record_id) ?? [];
    list.push(tr);
    byRecord.set(tr.record_id, list);
  }

  const spells = new Map<string, number[]>();
  for (const list of byRecord.values()) {
    const ordered = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 0; i < ordered.length - 1; i++) {
      const days = daysBetween(ordered[i].created_at, ordered[i + 1].created_at);
      if (days === null || days < 0) continue;
      const stage = ordered[i].to_stage;
      spells.set(stage, [...(spells.get(stage) ?? []), days]);
    }
  }

  const out = new Map<CanonicalStage, StageBaseline>();
  for (const stage of CANONICAL_ACTIVE_STAGES) {
    const observed = spells.get(stage) ?? [];
    if (observed.length < t.minBaselineObservations) {
      // Not "0 days" and not a guess from a neighbouring stage. Absent.
      out.set(stage, { stage, days: null, observations: observed.length, source: "unavailable" });
      continue;
    }
    const sorted = [...observed].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
    out.set(stage, { stage, days: median, observations: observed.length, source: "median" });
  }
  return out;
}

/** Where the stage-entry date came from — the reader is entitled to know. */
export type EnteredAtSource = "transition" | "created" | "unknown";

export type StageAging = {
  opportunityId: string;
  stage: CanonicalStage | null;
  enteredAt: string | null;
  enteredAtSource: EnteredAtSource;
  daysInStage: number | null;
  baseline: StageBaseline | null;
  /** Days above the baseline. Null whenever the baseline is unavailable. */
  deviationDays: number | null;
};

export function stageAgingFor(
  o: AttentionOpp,
  transitions: StageTransitionRow[],
  baselines: Map<CanonicalStage, StageBaseline>,
  today: string,
): StageAging {
  const stage = canonicalStageOf(o);
  const mine = transitions
    .filter((tr) => tr.record_id === o.id && (!tr.record_type || tr.record_type === "opportunity"))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  let enteredAt: string | null = null;
  let source: EnteredAtSource = "unknown";

  const intoCurrent = stage ? mine.filter((tr) => tr.to_stage === stage).at(-1) : undefined;
  if (intoCurrent) {
    enteredAt = intoCurrent.created_at;
    source = "transition";
  } else if (mine.length === 0 && o.created_at) {
    // Never moved, so it has been here since it was created. That is a fact on
    // the record, not an inference — unlike guessing an entry date for a deal
    // that demonstrably moved but whose move was not logged, which stays null.
    enteredAt = o.created_at;
    source = "created";
  }

  const daysInStage = enteredAt ? daysBetween(enteredAt, today) : null;
  const baseline = stage ? (baselines.get(stage) ?? null) : null;
  const deviationDays =
    baseline?.days != null && daysInStage != null ? daysInStage - baseline.days : null;

  return { opportunityId: o.id, stage, enteredAt, enteredAtSource: source, daysInStage, baseline, deviationDays };
}

// ---- Reasons (§9 drill-down) ------------------------------------------------

export type ReasonKind =
  | "follow_up_overdue"
  | "no_next_action"
  | "no_next_action_date"
  | "next_action_overdue"
  | "stalled"
  | "inactive"
  | "expected_close_overdue"
  | "closing_soon"
  | "high_value_low_probability"
  | "unscored"
  | "no_decision_maker";

export type AttentionReason = {
  kind: ReasonKind;
  /** Points this rule contributed. Shown in the drill-down so a band is auditable. */
  points: number;
  detail: string;
  /** The date the condition began, where one exists. */
  since: string | null;
  ageDays: number | null;
  /** The rows that produced it — follow-up ids, activity ids. */
  sourceIds: string[];
};

/**
 * The rule table. Exported because §9 requires the reader to see WHICH rules
 * fired and what each was worth; a band nobody can take apart is a black box
 * wearing a number.
 */
export const RULE_POINTS: Record<ReasonKind, number> = {
  follow_up_overdue: 20,
  stalled: 20,
  expected_close_overdue: 15,
  closing_soon: 15,
  no_next_action: 15,
  next_action_overdue: 10,
  inactive: 10,
  high_value_low_probability: 10,
  no_next_action_date: 5,
  unscored: 5,
  no_decision_maker: 5,
};

/** Extra points for age, so two overdue items of different vintage differ. */
const MAX_AGE_POINTS = 20;

/**
 * Value bands. A flat "value matters" multiplier makes every band unreadable;
 * discrete steps keep the arithmetic something a manager can redo on paper.
 *
 * This is the rule that fixes the complaint the whole section came from: an
 * SAR 8M follow-up two days late must outrank an SAR 100K one ten days late.
 */
export const VALUE_POINTS: Array<{ atLeast: number; points: number }> = [
  { atLeast: 5_000_000, points: 25 },
  { atLeast: 1_000_000, points: 15 },
  { atLeast: 250_000, points: 8 },
];

/** Late-stage work is worth more attention: there is more to lose and less time. */
export const STAGE_POINTS: Partial<Record<CanonicalStage, number>> = {
  verbally_awarded: 15,
  contract_received: 15,
  contract_signed: 15,
  jih_bafo: 10,
  under_negotiation: 10,
};

export type AttentionPriority = "critical" | "high" | "normal" | "low";

/** Band cuts. Documented here rather than inline so they can be tuned in one place. */
export const PRIORITY_CUTS: Array<{ atLeast: number; priority: AttentionPriority }> = [
  { atLeast: 60, priority: "critical" },
  { atLeast: 35, priority: "high" },
  { atLeast: 15, priority: "normal" },
];

export function bandOf(score: number): AttentionPriority {
  return PRIORITY_CUTS.find((c) => score >= c.atLeast)?.priority ?? "low";
}

// ---- At Risk / Stalled / Closing Soon (§3, §4, §5) --------------------------

/**
 * At Risk is a named set of reasons, not a mood. Every classification carries
 * the reasons that produced it, so "why is this at risk" is answered by the
 * record rather than by a model.
 */
export const RISK_REASONS: ReasonKind[] = [
  "stalled",
  "inactive",
  "expected_close_overdue",
  "high_value_low_probability",
];

export type AttentionItem = {
  opportunityId: string;
  label: string;
  ownerId: string | null;
  stage: CanonicalStage | null;
  value: number | null;
  priority: AttentionPriority;
  /** The deterministic total behind the band. */
  score: number;
  reasons: AttentionReason[];
  primaryReason: AttentionReason;
  issueCount: number;
  oldestOverdueDays: number | null;
  lastClientActivity: string | null;
  nextAction: { text: string | null; due: string | null; status: "ok" | "missing" | "no_date" | "overdue" };
  aging: StageAging;
  atRisk: boolean;
  stalled: boolean;
  closingSoon: boolean;
};

export type AttentionInput = {
  opportunities: AttentionOpp[];
  followUps?: FollowUpRow[];
  activities?: ActivityRow[];
  transitions?: StageTransitionRow[];
  today: string;
  ownerId?: string | null;
  thresholds?: AttentionThresholds;
};

const OPEN_FOLLOW_UP = (f: FollowUpRow) => f.status !== "completed" && f.status !== "cancelled";

/**
 * One item per opportunity, with every reason attached.
 *
 * Only ACTIVE stages are considered. `CANONICAL_ACTIVE_STAGES` already excludes
 * won, lost, on_hold and (via canonicalStageOf) archived — a parked deal
 * legitimately has no next action, and nagging about one is how a queue teaches
 * people to ignore it.
 */
export function buildAttention(input: AttentionInput): AttentionItem[] {
  const t = input.thresholds ?? DEFAULT_ATTENTION;
  const { today } = input;
  const transitions = input.transitions ?? [];
  const baselines = stageBaselines(transitions, t);

  const followUpsByOpp = new Map<string, FollowUpRow[]>();
  for (const f of input.followUps ?? []) {
    if (!OPEN_FOLLOW_UP(f)) continue;
    followUpsByOpp.set(f.opportunity_id, [...(followUpsByOpp.get(f.opportunity_id) ?? []), f]);
  }

  const lastContactByOpp = new Map<string, string>();
  for (const a of input.activities ?? []) {
    if (!a.opportunity_id || !isMeaningfulClientActivity(a)) continue;
    const prev = lastContactByOpp.get(a.opportunity_id);
    if (!prev || a.created_at > prev) lastContactByOpp.set(a.opportunity_id, a.created_at);
  }

  const items: AttentionItem[] = [];

  for (const o of input.opportunities) {
    const stage = canonicalStageOf(o);
    if (stage === null || !CANONICAL_ACTIVE_STAGES.includes(stage)) continue;
    if (input.ownerId && o.owner_id !== input.ownerId) continue;

    const value = opportunityValue(o);
    const aging = stageAgingFor(o, transitions, baselines, today);
    const reasons: AttentionReason[] = [];
    const push = (
      kind: ReasonKind,
      detail: string,
      extra: { since?: string | null; ageDays?: number | null; sourceIds?: string[]; agePoints?: number } = {},
    ) =>
      reasons.push({
        kind,
        points: RULE_POINTS[kind] + Math.min(extra.agePoints ?? 0, MAX_AGE_POINTS),
        detail,
        since: extra.since ?? null,
        ageDays: extra.ageDays ?? null,
        sourceIds: extra.sourceIds ?? [],
      });

    // --- overdue follow-ups, aggregated into ONE reason (§8) ---
    const mine = followUpsByOpp.get(o.id) ?? [];
    const overdue = mine
      .map((f) => ({ f, days: daysBetween(f.due_date, today) }))
      .filter((x): x is { f: FollowUpRow; days: number } => x.days !== null && x.days > 0)
      .sort((a, b) => b.days - a.days);
    const oldestOverdueDays = overdue[0]?.days ?? null;

    if (overdue.length > 0) {
      push(
        "follow_up_overdue",
        overdue.length === 1
          ? `1 overdue follow-up, ${overdue[0].days} days late`
          : `${overdue.length} overdue follow-ups, oldest ${overdue[0].days} days late`,
        {
          since: overdue[0].f.due_date,
          ageDays: overdue[0].days,
          sourceIds: overdue.map((x) => x.f.id),
          agePoints: overdue[0].days,
        },
      );
    }

    // --- next action hygiene (§7/§20) ---
    const hasNextAction = !!(o.next_action && o.next_action.trim());
    const hasNextActionDate = !!(o.next_action_due && String(o.next_action_due).trim());
    const nextActionOverdueDays =
      hasNextActionDate && o.next_action_due ? daysBetween(o.next_action_due, today) : null;

    if (!hasNextAction) {
      push("no_next_action", "No next action set");
    } else if (!hasNextActionDate) {
      push("no_next_action_date", "Next action has no date");
    } else if (nextActionOverdueDays !== null && nextActionOverdueDays > 0) {
      push("next_action_overdue", `Next action ${nextActionOverdueDays} days past its date`, {
        since: o.next_action_due ?? null,
        ageDays: nextActionOverdueDays,
        agePoints: nextActionOverdueDays,
      });
    }

    // --- inactivity, measured on real client contact ---
    const lastContact = lastContactByOpp.get(o.id) ?? o.last_activity_at ?? null;
    const silentDays = lastContact ? daysBetween(lastContact, today) : null;
    if (silentDays !== null && silentDays >= t.inactiveDays) {
      push("inactive", `No client contact for ${silentDays} days`, {
        since: lastContact,
        ageDays: silentDays,
      });
    }

    // --- stalled (§4) ---
    //
    // Stage Aging and Stalled are separate on purpose. Aging MEASURES how long
    // a deal has sat somewhere and is always reportable. Stalled is a business
    // verdict that the deal has sat there TOO LONG, and "too long" is
    // meaningless without something to be long relative to.
    //
    // So a limit must come from evidence: a measured median, or an SLA the
    // business actually set. With neither, age alone can never stall a deal —
    // it is reported as a duration and left to the reader. The other signals
    // below (silence, missing action, passed close date) fire independently and
    // are unaffected, so a genuinely neglected deal still surfaces.
    const slaDays = stage ? (t.stageSla?.[stage] ?? null) : null;
    const measuredBaseline = aging.baseline?.source === "median" ? aging.baseline.days : null;
    const stageLimit = slaDays ?? measuredBaseline;
    const limitSource = slaDays !== null ? "SLA" : "baseline";

    const overStage = stageLimit !== null && aging.daysInStage !== null && aging.daysInStage > stageLimit;
    const nothingMoving =
      (silentDays !== null && silentDays >= t.inactiveDays) ||
      !hasNextAction ||
      (nextActionOverdueDays !== null && nextActionOverdueDays > 0);
    const stalled = overStage && nothingMoving;
    if (stalled) {
      push(
        "stalled",
        `${aging.daysInStage} days in ${stage} against a ${stageLimit}-day ${limitSource}, with nothing scheduled`,
        { since: aging.enteredAt, ageDays: aging.daysInStage },
      );
    }

    // --- expected close (§5): only ever from a real date ---
    const closeDays = o.expected_contract_date ? daysBetween(o.expected_contract_date, today) : null;
    if (closeDays !== null && closeDays > 0) {
      push("expected_close_overdue", `Expected close ${o.expected_contract_date} has passed`, {
        since: o.expected_contract_date ?? null,
        ageDays: closeDays,
      });
    }
    const closingSoon = closeDays !== null && closeDays <= 0 && Math.abs(closeDays) <= t.closingSoonDays;
    if (closingSoon) {
      push("closing_soon", `Expected to close in ${Math.abs(closeDays!)} days`, {
        since: o.expected_contract_date ?? null,
        ageDays: closeDays,
      });
    }

    // --- commercial signals already defined by the KPI engine ---
    const prob = resolveProbability(o);
    if (prob.value === null) {
      push("unscored", "No win probability recorded");
    } else if (value !== null && value >= t.highValue && prob.value * 100 <= t.lowProbabilityPct) {
      push("high_value_low_probability", `High value at ${Math.round(prob.value * 100)}% (${prob.label})`);
    }
    if (!o.contractor_decision_maker || !String(o.contractor_decision_maker).trim()) {
      push("no_decision_maker", "No decision maker identified");
    }

    if (reasons.length === 0) continue;

    const score =
      reasons.reduce((s, r) => s + r.points, 0) +
      (value !== null ? (VALUE_POINTS.find((v) => value >= v.atLeast)?.points ?? 0) : 0) +
      (stage ? (STAGE_POINTS[stage] ?? 0) : 0);

    const ranked = [...reasons].sort((a, b) => b.points - a.points || a.kind.localeCompare(b.kind));

    items.push({
      opportunityId: o.id,
      label: o.project_name ?? o.id.slice(0, 8),
      ownerId: o.owner_id ?? null,
      stage,
      value,
      priority: bandOf(score),
      score,
      reasons: ranked,
      primaryReason: ranked[0],
      issueCount: reasons.length,
      oldestOverdueDays,
      lastClientActivity: lastContact,
      nextAction: {
        text: o.next_action ?? null,
        due: o.next_action_due ?? null,
        status: !hasNextAction
          ? "missing"
          : !hasNextActionDate
            ? "no_date"
            : nextActionOverdueDays !== null && nextActionOverdueDays > 0
              ? "overdue"
              : "ok",
      },
      aging,
      atRisk: reasons.some((r) => RISK_REASONS.includes(r.kind)),
      stalled,
      closingSoon,
    });
  }

  // Highest score first. Ties break on id so the order is stable across renders
  // — a list that reshuffles on refresh cannot be worked top to bottom.
  return items.sort((a, b) => b.score - a.score || a.opportunityId.localeCompare(b.opportunityId));
}

// ---- Roll-ups (§9 headline counts) ------------------------------------------

export type AttentionSummary = {
  atRisk: { count: number; value: number; ids: string[] };
  stalled: { count: number; value: number; ids: string[] };
  closingSoon: { count: number; value: number; ids: string[] };
  missingNextAction: { count: number; value: number; ids: string[] };
};

export function summarize(items: AttentionItem[]): AttentionSummary {
  const roll = (pick: (i: AttentionItem) => boolean) => {
    const hit = items.filter(pick);
    return {
      count: hit.length,
      value: hit.reduce((s, i) => s + (i.value ?? 0), 0),
      ids: hit.map((i) => i.opportunityId),
    };
  };
  return {
    atRisk: roll((i) => i.atRisk),
    stalled: roll((i) => i.stalled),
    closingSoon: roll((i) => i.closingSoon),
    missingNextAction: roll((i) => i.nextAction.status === "missing"),
  };
}
