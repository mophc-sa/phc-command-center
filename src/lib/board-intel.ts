// =============================================================================
// What the board is allowed to CLAIM, as opposed to what it can compute.
//
// This module exists because a product review asked for a weighted forecast,
// pipeline coverage, per-deal probability and a 30/60/90 outlook -- and the
// production data cannot support any of them:
//
//     win_confidence          0 / 739
//     human_win_probability   0 / 739
//     next_action             0 / 739
//     next_action_due         0 / 739
//     last_activity_at       46 / 739
//     any value field       641 / 739
//
// Every one of those figures is a function of a column nobody has filled. The
// review anticipated exactly this and answered it in advance: do not print
// "SAR 0" for a number that has no inputs, print what is missing. So each
// calculation here returns a STATE alongside its value, and "there is no
// probability on any deal" is a first-class result rather than a zero.
//
// The distinction the review asks for, kept literally:
//   ok             a real number, computed from real inputs
//   no_data        the inputs exist as columns, no rows carry them yet
//   not_configured a setting nobody has made (no target row, no thresholds)
//   not_applicable meaningless in this context
//
// Pure. `now` is passed in; nothing here reads a clock.
// =============================================================================

import { canonicalStageOf } from "@/lib/sales-kpis";
import type { CanonicalStage } from "@/lib/stage-canonical";
import { opportunityValue, sumOpportunityValue } from "@/lib/opportunity-value";

export type IntelState = "ok" | "no_data" | "not_configured" | "not_applicable";

export type Figure = {
  value: number | null;
  state: IntelState;
  /** Why, in the reader's own terms. Never a code. */
  reasonAr?: string;
  reasonEn?: string;
  /** How many rows are missing the input, when that is the reason. */
  missing?: number;
};

const ok = (value: number): Figure => ({ value, state: "ok" });
const missing = (n: number, ar: string, en: string): Figure => ({
  value: null,
  state: "no_data",
  reasonAr: ar,
  reasonEn: en,
  missing: n,
});

export type IntelOpp = {
  id: string;
  project_name?: string | null;
  client?: string | null;
  owner_id: string | null;
  stage: string;
  sales_stage?: string | null;
  contract_value: number | null;
  quotation_value: number | null;
  estimated_value_max: number | null;
  /** When the deal is expected to close. NOT next_action_due -- see below. */
  expected_contract_date?: string | null;
  /** 0-100. Empty on every production row today -- see the header. */
  human_win_probability?: number | null;
  win_confidence?: string | null;
  next_action?: string | null;
  next_action_due?: string | null;
  last_activity_at?: string | null;
  won_at?: string | null;
  created_at?: string | null;
};

// ---------------------------------------------------------------------------
// Pipeline, split the way the review asked -- and one correction to it
// ---------------------------------------------------------------------------

/**
 * The five commercial positions, kept apart so a forecast cannot quietly count
 * money the company has not won.
 *
 * ONE CORRECTION TO THE BRIEF. The review assumed `jih` means the deal is
 * awarded to PHC and should therefore leave Open Pipeline. In this system it
 * does not: JIH ("Job In Hand") describes the CONTRACTOR's situation -- they
 * already hold the main project, so the signage package is real -- not PHC's.
 * The opposite of JIH is Tender, where the contractor is still bidding. So a
 * JIH opportunity is an open opportunity with better odds, and moving it out of
 * open pipeline would understate the book.
 *
 * The review's second point stands and is acted on: the LABEL is misleading.
 * "Job in hand" reads in English as "we have the job". The board now says
 * "contractor holds the project" instead, which is what it means.
 */
export const PIPELINE_BUCKETS = {
  /** Not won. Includes JIH -- see above. */
  open: ["rfq_received", "jih"] as CanonicalStage[],
  /** Committed effort, decision imminent. */
  lateStage: ["jih_bafo", "under_negotiation"] as CanonicalStage[],
  /** Won on a handshake. Losable: nothing is signed. */
  awardedPendingContract: ["verbally_awarded"] as CanonicalStage[],
  /** Paper exists. */
  contractedBacklog: ["contract_received", "contract_signed"] as CanonicalStage[],
} as const;

export type BucketKey = keyof typeof PIPELINE_BUCKETS;

export type Bucket = {
  key: BucketKey;
  count: number;
  value: number;
  /** Deals in this bucket carrying no value at all. Printed, never hidden. */
  unvalued: number;
};

export function pipelineBuckets(opps: readonly IntelOpp[]): Bucket[] {
  return (Object.keys(PIPELINE_BUCKETS) as BucketKey[]).map((key) => {
    const stages = PIPELINE_BUCKETS[key];
    const rows = opps.filter((o) => {
      const st = canonicalStageOf(o as never);
      return !!st && (stages as readonly string[]).includes(st);
    });
    const sum = sumOpportunityValue(rows);
    return { key, count: rows.length, value: sum.total, unvalued: sum.unvalued };
  });
}

// ---------------------------------------------------------------------------
// The figures that need inputs nobody has entered
// ---------------------------------------------------------------------------

/**
 * Probability-weighted pipeline.
 *
 * Returns `no_data` rather than a number when no open deal carries a
 * probability -- which is every deal, today. A weighted pipeline of "SAR 0"
 * would read as "nothing is likely to close", and the truth is "nobody has said
 * how likely anything is".
 */
export function weightedPipeline(opps: readonly IntelOpp[]): Figure {
  const openStages = [...PIPELINE_BUCKETS.open, ...PIPELINE_BUCKETS.lateStage] as readonly string[];
  const open = opps.filter((o) => {
    const st = canonicalStageOf(o as never);
    return !!st && openStages.includes(st);
  });
  if (open.length === 0) return { value: null, state: "no_data", reasonAr: "لا فرص مفتوحة", reasonEn: "no open deals" };

  const withProb = open.filter((o) => typeof o.human_win_probability === "number");
  if (withProb.length === 0) {
    return missing(
      open.length,
      `لا احتمالية مُدخَلة على أي من ${open.length} فرصة مفتوحة`,
      `No probability entered on any of ${open.length} open deals`,
    );
  }

  const total = withProb.reduce((sum, o) => {
    const v = opportunityValue(o as never);
    return v === null ? sum : sum + v * ((o.human_win_probability as number) / 100);
  }, 0);
  return { ...ok(total), missing: open.length - withProb.length };
}

/**
 * Weighted pipeline against the target -- "2.2x coverage".
 *
 * Two ways to be unanswerable, and they are different facts: no target set is a
 * configuration gap, no probability is a data gap. Collapsing both to one
 * message would send someone to fix the wrong thing.
 */
export function pipelineCoverage(weighted: Figure, target: number | null): Figure {
  if (target === null || target <= 0) {
    return {
      value: null,
      state: "not_configured",
      reasonAr: "لم يُضبط هدف",
      reasonEn: "no target set",
    };
  }
  if (weighted.state !== "ok" || weighted.value === null) {
    return { value: null, state: weighted.state, reasonAr: weighted.reasonAr, reasonEn: weighted.reasonEn };
  }
  return ok(weighted.value / target);
}

// ---------------------------------------------------------------------------
// Needs attention -- one row per opportunity, ranked by consequence
// ---------------------------------------------------------------------------

export type AttentionReason =
  | "followups_overdue"
  | "no_next_action"
  | "stalled"
  | "quotation_expiring";

export type AttentionItem = {
  opportunityId: string;
  projectName: string;
  client: string | null;
  ownerId: string | null;
  value: number | null;
  /** Every reason this opportunity is on the list, not one row each. */
  reasons: AttentionReason[];
  /** Days of the worst offence -- oldest overdue follow-up, or days idle. */
  worstAgeDays: number;
  /** Count of overdue follow-ups on this opportunity, if any. */
  overdueCount: number;
  score: number;
  priority: "critical" | "high" | "normal";
};

/**
 * Rank by consequence, not by date.
 *
 * The review's example is the whole argument: a follow-up on an 8M deal two
 * days late matters more than one on a 100K deal ten days late. Sorting by due
 * date puts them the wrong way round and makes the list actively misleading
 * about what to do first.
 *
 * The score is deliberately simple and readable: value carries the weight,
 * lateness scales it, and stage adds a multiplier because a stalled BAFO is
 * worse than a stalled enquiry. It is not a model, and it does not pretend to
 * be one -- every term is something a sales manager would name unprompted.
 *
 * DEDUPLICATED BY OPPORTUNITY. The old list showed the same project twice when
 * it had two overdue follow-ups. One row, two reasons, and the count beside it.
 */
const STAGE_WEIGHT: Record<string, number> = {
  rfq_received: 1,
  jih: 1.2,
  jih_bafo: 1.8,
  under_negotiation: 2,
  verbally_awarded: 2.2,
  contract_received: 1.5,
  contract_signed: 1,
};

export function attentionItems(
  opps: readonly IntelOpp[],
  followUps: ReadonlyArray<{ opportunity_id: string; due_date: string | null; status?: string | null }>,
  now: Date,
  opts: { stalledAfterDays?: number } = {},
): AttentionItem[] {
  const stalledAfter = opts.stalledAfterDays ?? 10;
  const dayMs = 86_400_000;
  const today = now.toISOString().slice(0, 10);

  const overdueByOpp = new Map<string, { count: number; oldestDays: number }>();
  for (const f of followUps) {
    const d = (f.due_date ?? "").slice(0, 10);
    if (!d || d >= today) continue;
    const age = Math.floor((now.getTime() - new Date(d).getTime()) / dayMs);
    const cur = overdueByOpp.get(f.opportunity_id);
    overdueByOpp.set(f.opportunity_id, {
      count: (cur?.count ?? 0) + 1,
      oldestDays: Math.max(cur?.oldestDays ?? 0, age),
    });
  }

  const items: AttentionItem[] = [];
  for (const o of opps) {
    const st = canonicalStageOf(o as never);
    if (!st || st === "won" || st === "lost") continue;

    const reasons: AttentionReason[] = [];
    const od = overdueByOpp.get(o.id);
    if (od) reasons.push("followups_overdue");

    // Only counted as a reason when SOME opportunity has a next action. With
    // the column empty on every row it is a configuration gap, not 739
    // individual problems, and listing them all would bury the real ones.
    const anyoneHasNextAction = opps.some((x) => !!x.next_action);
    if (anyoneHasNextAction && !o.next_action) reasons.push("no_next_action");

    let idleDays = 0;
    if (o.last_activity_at) {
      idleDays = Math.floor((now.getTime() - new Date(o.last_activity_at).getTime()) / dayMs);
      if (idleDays > stalledAfter) reasons.push("stalled");
    }

    if (reasons.length === 0) continue;

    const value = opportunityValue(o as never);
    const worstAgeDays = Math.max(od?.oldestDays ?? 0, reasons.includes("stalled") ? idleDays : 0);
    // Value in millions, so a 8M deal scores 8 before the multipliers rather
    // than eight million and drowning every other term.
    const valueTerm = (value ?? 0) / 1_000_000;
    const ageTerm = 1 + Math.min(worstAgeDays, 60) / 30;
    const score = (valueTerm + 0.5) * ageTerm * (STAGE_WEIGHT[st] ?? 1) * (1 + reasons.length * 0.15);

    items.push({
      opportunityId: o.id,
      projectName: o.project_name ?? "—",
      client: o.client ?? null,
      ownerId: o.owner_id,
      value,
      reasons,
      worstAgeDays,
      overdueCount: od?.count ?? 0,
      score,
      priority: score >= 8 ? "critical" : score >= 3 ? "high" : "normal",
    });
  }

  return items.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// The list a manager actually reads first
// ---------------------------------------------------------------------------

export type HotOpportunity = {
  id: string;
  projectName: string;
  value: number | null;
  stage: CanonicalStage;
  /** null until somebody records one -- never a stand-in number. */
  probability: number | null;
  ownerId: string | null;
};

/** Top open deals by value. Value only: probability does not exist yet. */
export function hotOpportunities(opps: readonly IntelOpp[], limit = 5): HotOpportunity[] {
  const openStages = [
    ...PIPELINE_BUCKETS.open,
    ...PIPELINE_BUCKETS.lateStage,
    ...PIPELINE_BUCKETS.awardedPendingContract,
  ] as readonly string[];
  return opps
    .map((o) => ({ o, st: canonicalStageOf(o as never), v: opportunityValue(o as never) }))
    .filter((x) => !!x.st && openStages.includes(x.st) && x.v !== null)
    .sort((a, b) => (b.v as number) - (a.v as number))
    .slice(0, limit)
    .map((x) => ({
      id: x.o.id,
      projectName: x.o.project_name ?? "—",
      value: x.v,
      stage: x.st as CanonicalStage,
      probability: typeof x.o.human_win_probability === "number" ? x.o.human_win_probability : null,
      ownerId: x.o.owner_id,
    }));
}

// ---------------------------------------------------------------------------
// The 30/60/90 outlook
// ---------------------------------------------------------------------------

/**
 * Expected value inside each horizon.
 *
 * Needs two things per deal: a probability and an expected close date. Neither
 * exists on any row today, so this returns `no_data` and names both -- rather
 * than three confident zeros in a row, which is what the mockup would otherwise
 * show and the worst possible thing for a screen nobody can interrogate.
 */
export function horizonForecast(
  opps: readonly IntelOpp[],
  now: Date = new Date(),
): { d30: Figure; d60: Figure; d90: Figure } {
  const openStages = [...PIPELINE_BUCKETS.open, ...PIPELINE_BUCKETS.lateStage] as readonly string[];
  const open = opps.filter((o) => {
    const st = canonicalStageOf(o as never);
    return !!st && openStages.includes(st);
  });

  const hasProb = (o: IntelOpp) => typeof o.human_win_probability === "number";
  // `expected_contract_date`, not `next_action_due`. They were treated as the
  // same field and they are not: "call them Tuesday" is a next action, and a
  // forecast built on it would place a deal in the 30-day column because
  // somebody scheduled a phone call, not because the deal closes then. The
  // message already said "expected close date"; now the code reads one.
  const hasDate = (o: IntelOpp) => !!o.expected_contract_date;
  const usable = open.filter((o) => hasProb(o) && hasDate(o));

  if (usable.length === 0) {
    // Name what is ACTUALLY absent. The old text said "neither is entered"
    // unconditionally, so the moment one of them was filled the board would
    // have gone on reporting that neither was -- the precise failure this
    // module exists to avoid.
    const probs = open.filter(hasProb).length;
    const dates = open.filter(hasDate).length;
    const [ar, en] =
      probs === 0 && dates === 0
        ? ["يحتاج احتمالية وتاريخ إغلاق متوقّعًا — وكلاهما غير مُدخَل",
           "Needs a probability and an expected close date — neither is entered"]
        : probs === 0
          ? ["يحتاج احتمالية — لا صفقة مفتوحة تحملها",
             "Needs a probability — no open deal carries one"]
          : dates === 0
            ? ["يحتاج تاريخ إغلاق متوقّعًا — لا صفقة مفتوحة تحمله",
               "Needs an expected close date — no open deal carries one"]
            : ["لا صفقة تحمل الاثنين معًا",
               "No deal carries both a probability and a close date"];
    const f = missing(open.length, ar, en);
    return { d30: f, d60: f, d90: f };
  }

  const day = 86_400_000;
  const at = (days: number) => new Date(now.getTime() + days * day).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  /**
   * Weighted value of everything expected to close by `to`.
   *
   * Cumulative on purpose: what closes inside 30 days also closes inside 60,
   * so the three figures nest rather than partition. A reader comparing 30 to
   * 90 is asking "how much more", and three disjoint buckets answer a question
   * nobody asked.
   *
   * Anything already past its expected date still counts in the 30-day figure.
   * A deal whose close date slipped has not left the pipeline, and dropping it
   * would quietly shrink the nearest horizon — the one people act on.
   */
  const upTo = (days: number): Figure => {
    const to = at(days);
    const inWindow = usable.filter((o) => (o.expected_contract_date as string) <= to);
    const value = inWindow.reduce((sum, o) => {
      const v = opportunityValue(o as never);
      return v === null ? sum : sum + v * ((o.human_win_probability as number) / 100);
    }, 0);
    const unvalued = inWindow.filter((o) => opportunityValue(o as never) === null).length;
    return {
      value: Math.round(value),
      state: "ok",
      missing: open.length - usable.length,
      ...(unvalued > 0
        ? {
            reasonAr: `${unvalued} صفقة بلا قيمة مسجَّلة غير محسوبة`,
            reasonEn: `${unvalued} deal(s) carry no value and are not counted`,
          }
        : {}),
    };
  };

  return { d30: upTo(30), d60: upTo(60), d90: upTo(90) };
}

// ---------------------------------------------------------------------------
// The two panels the mockup shows and the data only half supports
// ---------------------------------------------------------------------------

export type Horizon = { todayCount: number; tomorrowCount: number; weekCount: number };

/**
 * "Today / the next seven days", from scheduled follow-ups.
 *
 * Returns null when NOT ONE follow-up is scheduled ahead -- which is the state
 * today: every follow-up in the system is already overdue. Three zeros in a row
 * would read as a clear week; the truth is that nobody has scheduled anything,
 * and a clear week and an empty calendar are opposite problems.
 */
export function upcoming(
  followUpDueDates: ReadonlyArray<string | null>,
  now: Date,
): Horizon | null {
  const day = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const today = iso(now.getTime());
  const tomorrow = iso(now.getTime() + day);
  const weekEnd = iso(now.getTime() + 7 * day);

  const ahead = followUpDueDates.filter((d): d is string => !!d && d.slice(0, 10) >= today);
  if (ahead.length === 0) return null;

  return {
    todayCount: ahead.filter((d) => d.slice(0, 10) === today).length,
    tomorrowCount: ahead.filter((d) => d.slice(0, 10) === tomorrow).length,
    weekCount: ahead.filter((d) => d.slice(0, 10) > tomorrow && d.slice(0, 10) <= weekEnd).length,
  };
}

export type Movement = {
  advanced: number;
  won: number;
  wonValue: number;
  lost: number;
  newDeals: number;
  /** What the new deals are worth. Zero when none of them carries a value. */
  newValue: number;
};

/**
 * What moved in the last `days` days.
 *
 * `newDeals` counts by created_at, which is why `excludeImported` exists: 88
 * rows arrived with no received date and were stamped with the import time, so
 * counting them as "new this week" would report a week of record-keeping as a
 * week of selling. They are identified by their import marker, not guessed at
 * from the timestamp.
 */
export function movement(
  opps: readonly IntelOpp[],
  transitions: ReadonlyArray<{ changed_at: string | null }>,
  now: Date,
  days = 1,
  opts: { importedSource?: string } = {},
): Movement {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const src = opts.importedSource;
  const isImported = (o: IntelOpp) =>
    !!src && (o as unknown as { extra_data?: { source?: string } }).extra_data?.source === src;

  const won = opps.filter((o) => (o.won_at ?? "") >= since);
  const fresh = opps.filter((o) => !isImported(o) && (o.created_at ?? "") >= since);
  return {
    advanced: transitions.filter((t) => (t.changed_at ?? "") >= since).length,
    won: won.length,
    wonValue: sumOpportunityValue(won).total,
    lost: opps.filter(
      (o) => canonicalStageOf(o as never) === "lost" && (o.created_at ?? "") >= since,
    ).length,
    newDeals: fresh.length,
    newValue: sumOpportunityValue(fresh as never).total,
  };
}

// =============================================================================
// The news wire.
//
// A ticker is the one element on the board that a passer-by reads without
// meaning to, so what it says has to be worth the interruption. Three rules
// hold it to that:
//
//   1. It is built from the SAME figures the panels show. A wire computing its
//      own numbers would be a second source of truth, and the first argument on
//      this floor would be about which one is right.
//   2. It leads with consequence -- what is late and large, then what was won,
//      then what is biggest -- because a scrolling line is read in fragments
//      and the fragment most likely to be caught should be the one that matters.
//   3. It never pads. A missing figure is omitted, never printed as a dash or
//      a zero, and if nothing at all is known the wire says so in words.
// =============================================================================

export type WireInput = {
  attention: AttentionItem[];
  hot: HotOpportunity[];
  movement: Movement;
  year: { ratio: number | null; target: number | null };
  upcoming: { todayCount: number; tomorrowCount: number } | null;
};

export function wireItems(
  m: WireInput,
  lang: "ar" | "en",
  money: (n: number) => string,
): string[] {
  const ar = lang === "ar";
  const out: string[] = [];

  for (const a of m.attention.filter((x) => x.priority === "critical").slice(0, 4)) {
    const size = a.value === null ? null : money(a.value);
    out.push(
      ar
        ? `⚠ ${a.projectName}${size ? ` · ${size}` : ""} · متأخّر ${a.worstAgeDays} يومًا`
        : `⚠ ${a.projectName}${size ? ` · ${size}` : ""} · ${a.worstAgeDays} days late`,
    );
  }

  if (m.movement.won > 0) {
    // "This week" until 2026-09-01, when the panel it draws from was measured
    // and found to use a ONE-day window. The wire was widening a day into a
    // week every time it scrolled past.
    out.push(
      ar
        ? `🏆 فوز منذ الأمس · ${m.movement.won} · ${money(m.movement.wonValue)}`
        : `🏆 Won since yesterday · ${m.movement.won} · ${money(m.movement.wonValue)}`,
    );
  }
  if (m.movement.newDeals > 0) {
    out.push(ar ? `✚ فرص جديدة · ${m.movement.newDeals}` : `✚ New opportunities · ${m.movement.newDeals}`);
  }
  if (m.movement.advanced > 0) {
    out.push(ar ? `▲ تقدّمت مرحلة · ${m.movement.advanced}` : `▲ Advanced a stage · ${m.movement.advanced}`);
  }

  if (m.upcoming && m.upcoming.todayCount + m.upcoming.tomorrowCount > 0) {
    out.push(
      ar
        ? `📅 اليوم ${m.upcoming.todayCount} · غدًا ${m.upcoming.tomorrowCount}`
        : `📅 Today ${m.upcoming.todayCount} · tomorrow ${m.upcoming.tomorrowCount}`,
    );
  }

  for (const h of m.hot.slice(0, 5)) {
    // hotOpportunities already drops valueless deals; the guard is for the type,
    // and costs nothing if that ever changes.
    if (h.value === null) continue;
    out.push(`${h.projectName} · ${money(h.value)}`);
  }

  if (m.year.ratio !== null && m.year.target !== null) {
    const pct = Math.round(m.year.ratio * 100);
    out.push(
      ar
        ? `◔ تحقيق الهدف ${pct}% من ${money(m.year.target)}`
        : `◔ Target achievement ${pct}% of ${money(m.year.target)}`,
    );
  }

  // Never an empty wire and never a wire of dashes: a blank strip on a wall
  // reads as a broken screen, and a strip of dashes reads as bad news.
  if (out.length === 0) {
    out.push(ar ? "لا مستجدّات في هذه الجولة" : "Nothing new this round");
  }
  return out;
}

/**
 * One reason, printed once -- or every reason, printed each.
 *
 * The 30/60/90 panel showed three horizons, all uncomputable, each carrying the
 * identical eight-word explanation. Twenty-four words to say one thing, in the
 * box with the least room on the board.
 *
 * Collapsing is only honest when there is genuinely one thing to say, so the
 * bar is deliberately high: EVERY horizon must be uncomputable AND carry the
 * SAME reason. If one of them can be computed, or two of them fail differently,
 * the shared line would be describing a situation that does not exist and each
 * chip keeps its own words.
 */
export function sharedReason(figures: Figure[], lang: "ar" | "en"): string | null {
  if (figures.length === 0) return null;
  if (figures.some((f) => f.state === "ok")) return null;
  const reasons = figures.map((f) => (lang === "ar" ? f.reasonAr : f.reasonEn));
  if (reasons.some((r) => !r)) return null;
  return reasons.every((r) => r === reasons[0]) ? reasons[0]! : null;
}

/**
 * The age of the oldest overdue follow-up, in whole days.
 *
 * "5 follow-ups overdue" and "the oldest is 160 days old" are different
 * severities of the same count, and the second is the one that decides whether
 * this is today's problem or this quarter's.
 *
 * Computed from the SAME list that produced the count, deliberately: the
 * attention list carries an age too, but it is filtered to open opportunities
 * and pairing its age with this count would report two populations as one.
 */
export function oldestOverdueDays(dueDates: (string | null)[], now: Date): number | null {
  let worst: number | null = null;
  for (const d of dueDates) {
    if (!d) continue;
    const days = Math.floor((now.getTime() - new Date(d).getTime()) / 86_400_000);
    if (days <= 0) continue;
    if (worst === null || days > worst) worst = days;
  }
  return worst;
}
