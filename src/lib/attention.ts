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
import { msg, type MessageRef } from "@/lib/messages";

// ---- Inputs -----------------------------------------------------------------

/** `next_action_due` is on the table but was missing from OppRow, so §20's
 *  "Next Action AND Next Action Date" could not be checked. */
export type AttentionOpp = OppRow & {
  next_action_due?: string | null;
  contractor_decision_maker?: string | null;
  client?: string | null;
  main_contractor?: string | null;
  company?: { name?: string | null } | null;
};

/** Any of the three columns that can name the client. */
const companyOf = (o: AttentionOpp) =>
  o.company?.name?.trim() || o.client?.trim() || o.main_contractor?.trim() || null;

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
  /**
   * Days of measured silence before inactivity is worth reporting.
   *
   * This is a REPORTING threshold, not a business SLA — it decides when a
   * duration is interesting enough to surface, and nothing more. It cannot
   * make a deal At Risk on its own; see RISK_REASONS. An approved SLA belongs
   * in sla_policies (subject `follow_up`), which ships empty.
   */
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

    // A zero-day median is not a measurement, it is an import artifact.
    //
    // Seen on screen 2026-08-26: "28 days in rfq_received against a 0-day
    // baseline". Enough opportunities had been transitioned into and out of
    // that stage on the SAME DAY — a bulk backfill, not lived history — that
    // the median came out 0. Every deal older than zero days then cleared the
    // "too long" bar, which is how a benchmark nobody measured came back in a
    // new costume after we deleted the 21-day one.
    //
    // A stage that genuinely takes no time is not a stage anyone waits in, so
    // there is nothing for a deal to be late against. Unavailable.
    if (median < 1) {
      out.set(stage, { stage, days: null, observations: observed.length, source: "unavailable" });
      continue;
    }
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
  | "no_engagement_history"
  | "missing_value"
  | "missing_owner"
  | "missing_company"
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

/**
 * What KIND of problem a reason is. This is the distinction the 49/49 At Risk
 * reading was missing.
 *
 *   risk          Evidence that the DEAL is endangered. Only these make an
 *                 opportunity At Risk.
 *   discipline    Work that has not been done (no next action). Needs
 *                 Attention, but the deal itself may be perfectly healthy.
 *   data_quality  Something we do not KNOW. A gap in the CRM is not a
 *                 statement about the client.
 *   engagement    A measured fact about contact. Informative, and it stays out
 *                 of At Risk until a business SLA exists to judge it against.
 */
export type ReasonCategory = "risk" | "discipline" | "data_quality" | "engagement";

export const REASON_CATEGORY: Record<ReasonKind, ReasonCategory> = {
  // Real commitments that were made and missed, and dates that have passed.
  follow_up_overdue: "risk",
  next_action_overdue: "risk",
  expected_close_overdue: "risk",
  stalled: "risk",
  high_value_low_probability: "risk",
  closing_soon: "risk",
  // Work not done.
  no_next_action: "discipline",
  no_next_action_date: "discipline",
  // Things we do not know. Never, on their own, a statement about the deal.
  unscored: "data_quality",
  no_decision_maker: "data_quality",
  no_engagement_history: "data_quality",
  missing_value: "data_quality",
  missing_owner: "data_quality",
  missing_company: "data_quality",
  // A measured duration, judged by nobody yet.
  inactive: "engagement",
};

export type AttentionReason = {
  kind: ReasonKind;
  category: ReasonCategory;
  /** Points this rule contributed. Shown in the drill-down so a band is auditable. */
  points: number;
  /** A fact and its slots. Rendered in the reader's language by the UI. */
  detail: MessageRef;
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
  no_engagement_history: 5,
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
  missing_value: 5,
  missing_owner: 5,
  missing_company: 5,
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
 * At Risk is a named set of reasons, not a mood — and it is now derived from
 * the category table above rather than kept by hand, so a new reason cannot be
 * added without someone deciding what kind of thing it is.
 *
 * WHY `inactive` LEFT THIS LIST
 * ----------------------------
 * On 2026-08-26 the dashboard read "AT RISK 49 · SAR 63,407,478" — the entire
 * book, every opportunity, the whole pipeline. A flag that fires on everything
 * is not a flag.
 *
 * The cause was not a threshold being slightly wrong. It was treating an
 * ABSENCE OF EVIDENCE as EVIDENCE OF ABSENCE: nothing in the CRM said anyone
 * had spoken to the client, so the system concluded nobody had. For the
 * historical opportunities promoted into the pipeline that is simply false —
 * they carry years of real relationship that predates this system existing.
 *
 * Inactivity is still measured and still shown. It just does not, by itself,
 * declare a deal endangered — because the 14 days it would be judged against
 * is a number this codebase invented, not one the business approved.
 * sla_policies is where an approved one would live, and it is empty.
 */
export const RISK_REASONS: ReasonKind[] = (Object.keys(REASON_CATEGORY) as ReasonKind[]).filter(
  (k) => REASON_CATEGORY[k] === "risk",
);

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
      detail: MessageRef,
      extra: { since?: string | null; ageDays?: number | null; sourceIds?: string[]; agePoints?: number } = {},
    ) =>
      reasons.push({
        kind,
        category: REASON_CATEGORY[kind],
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
          ? msg("rsn_follow_up_overdue_one", { days: overdue[0].days })
          : msg("rsn_follow_up_overdue_many", { count: overdue.length, days: overdue[0].days }),
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
      push("no_next_action", msg("rsn_no_next_action"));
    } else if (!hasNextActionDate) {
      push("no_next_action_date", msg("rsn_no_next_action_date"));
    } else if (nextActionOverdueDays !== null && nextActionOverdueDays > 0) {
      push("next_action_overdue", msg("rsn_next_action_overdue", { days: nextActionOverdueDays }), {
        since: o.next_action_due ?? null,
        ageDays: nextActionOverdueDays,
        agePoints: nextActionOverdueDays,
      });
    }

    // --- engagement: a measured fact, or an admitted gap ---
    //
    // `last_activity_at` is NOT used as the reference, though it is tempting.
    // It is stamped by logActivity() for ANY activity — including a note
    // somebody wrote to themselves and an email draft that was never sent — so
    // reading it as client contact contradicts the rule two functions above
    // that says exactly those two things are not contact. It is a
    // "someone touched this record" timestamp, not a "we spoke to the client"
    // one, and it is also null on every historically promoted opportunity
    // because the importer never writes it.
    //
    // So inactivity is computed ONLY from a verified client-facing activity.
    // With none, we do not know when the client was last spoken to — and the
    // honest report of that is a data gap, not a claim that nobody called.
    const lastContact = lastContactByOpp.get(o.id) ?? null;
    const silentDays = lastContact ? daysBetween(lastContact, today) : null;

    if (lastContact === null) {
      // Data quality, deliberately: a CRM with no record of a conversation is a
      // statement about the CRM. The promoted historical deals carry years of
      // real relationship that predates this system.
      push("no_engagement_history", msg("rsn_no_engagement_history"));
    } else if (silentDays !== null && silentDays >= t.inactiveDays) {
      // Reported as the measured duration it is. Category "engagement", not
      // "risk": the threshold it is compared against is one this codebase
      // chose, not one the business approved, and sla_policies — the table
      // built to hold approved thresholds — is empty.
      push("inactive", msg("rsn_inactive", { days: silentDays }), {
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
    // Unknown engagement is not evidence that nothing is moving. Only a
    // MEASURED silence, or a missing/late action, counts.
    const nothingMoving =
      (silentDays !== null && silentDays >= t.inactiveDays) ||
      !hasNextAction ||
      (nextActionOverdueDays !== null && nextActionOverdueDays > 0);
    const stalled = overStage && nothingMoving;
    if (stalled) {
      push(
        "stalled",
        msg("rsn_stalled", {
          days: aging.daysInStage ?? 0,
          stage: stage ?? "",
          limit: stageLimit ?? 0,
          source: limitSource,
        }),
        { since: aging.enteredAt, ageDays: aging.daysInStage },
      );
    }

    // --- expected close (§5): only ever from a real date ---
    const closeDays = o.expected_contract_date ? daysBetween(o.expected_contract_date, today) : null;
    if (closeDays !== null && closeDays > 0) {
      push("expected_close_overdue", msg("rsn_expected_close_overdue", { date: o.expected_contract_date ?? "" }), {
        since: o.expected_contract_date ?? null,
        ageDays: closeDays,
      });
    }
    const closingSoon = closeDays !== null && closeDays <= 0 && Math.abs(closeDays) <= t.closingSoonDays;
    if (closingSoon) {
      push("closing_soon", msg("rsn_closing_soon", { days: Math.abs(closeDays!) }), {
        since: o.expected_contract_date ?? null,
        ageDays: closeDays,
      });
    }

    // --- commercial signals already defined by the KPI engine ---
    const prob = resolveProbability(o);
    if (prob.value === null) {
      push("unscored", msg("rsn_unscored"));
    } else if (value !== null && value >= t.highValue && prob.value * 100 <= t.lowProbabilityPct) {
      push("high_value_low_probability", msg("rsn_high_value_low_probability", { pct: Math.round(prob.value * 100), source: prob.label }));
    }
    if (!o.contractor_decision_maker || !String(o.contractor_decision_maker).trim()) {
      push("no_decision_maker", msg("rsn_no_decision_maker"));
    }

    // Pure data-quality gaps. Each is a fact about the RECORD, never about the
    // deal — none of them is categorised as risk, so none can make an
    // opportunity At Risk on its own.
    if (value === null) push("missing_value", msg("rsn_missing_value"));
    if (!o.owner_id) push("missing_owner", msg("rsn_missing_owner"));
    if (!companyOf(o)) push("missing_company", msg("rsn_missing_company"));

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

// ---- Data Quality (Phase 5.1 §13) ------------------------------------------
//
// Derived from the SAME reasons the attention engine already produces, filtered
// to category "data_quality". That is deliberate and structural: a separate
// data-quality pass would be a second definition of "missing probability", and
// the two would drift. It also makes the guarantee the spec asks for impossible
// to break by accident — Data Quality reads only non-risk categories, so a data
// gap cannot become At Risk without someone recategorising it on purpose.
//
// No score. A composite "CRM health is 61%" needs a weighting nobody has
// agreed, and an invented weighting is the same defect as an invented SLA
// wearing a percentage sign. Counts reconcile to records; that is enough to act
// on, and every count carries the ids behind it.

export type DataQualityIssue = {
  kind: ReasonKind;
  count: number;
  /** The exact opportunities — this is what makes the count auditable. */
  opportunityIds: string[];
  /** Value at stake, where the affected records carry one. */
  value: number;
};

export type DataQualityReport = {
  issues: DataQualityIssue[];
  /** Distinct opportunities with at least one data gap. NOT the sum of counts:
   *  one opportunity missing three things is one incomplete record. */
  affectedOpportunities: number;
  /** Active opportunities considered, so a count reads against a denominator. */
  totalConsidered: number;
};

export function dataQuality(items: AttentionItem[], totalConsidered: number): DataQualityReport {
  const byKind = new Map<ReasonKind, { ids: Set<string>; value: number }>();
  const affected = new Set<string>();

  for (const item of items) {
    for (const r of item.reasons) {
      if (REASON_CATEGORY[r.kind] !== "data_quality") continue;
      affected.add(item.opportunityId);
      const entry = byKind.get(r.kind) ?? { ids: new Set<string>(), value: 0 };
      // A Set, so one opportunity raising the same issue twice cannot inflate
      // the count — the no-double-counting rule, enforced by the structure.
      if (!entry.ids.has(item.opportunityId)) entry.value += item.value ?? 0;
      entry.ids.add(item.opportunityId);
      byKind.set(r.kind, entry);
    }
  }

  return {
    issues: [...byKind.entries()]
      .map(([kind, e]) => ({
        kind,
        count: e.ids.size,
        opportunityIds: [...e.ids].sort(),
        value: e.value,
      }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    affectedOpportunities: affected.size,
    totalConsidered,
  };
}
