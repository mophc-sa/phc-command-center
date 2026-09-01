// =============================================================================
// The numbers a wall board is allowed to show.
//
// A wall board is not a dashboard. It is read from three to five metres, for
// about three seconds, by someone who cannot click. Two consequences shape
// everything here:
//
//   1. Nothing may depend on a tooltip, a drill-down, or a hover. A figure that
//      is not understandable on its own has no place on the board.
//   2. **A stale number is worse than no number.** The board runs unattended
//      for weeks; if the network drops, a screen still confidently showing
//      yesterday's pipeline is actively misleading the one person who acts on
//      it. Freshness is therefore part of the payload, not a detail of the UI.
//
// The computation reuses the same canonical rules the rest of the app runs on
// -- `opportunityValue`, `canonicalStageOf` -- rather than re-deriving them.
// A board that disagrees with the Opportunities page is a bug in the board, and
// re-implementing the arithmetic here is how that bug gets written.
//
// Pure: `now` is passed in, never read. A test can ask what any month looked
// like, and the poll cadence cannot smear a month boundary.
// =============================================================================

import { canonicalStageOf } from "@/lib/sales-kpis";
// Through the shared resolver, never a bare "ar-*": Arabic locales default to
// Arabic-Indic digits, and this app pinned Western ones with -u-nu-latn.
// `arabic-digits.test.ts` enforces that, and caught this line when it hardcoded
// the locale -- correctly, since the next person to copy it would drop the
// extension and quietly reintroduce ٠١٢٣ on one screen.
import { localeFor } from "@/lib/i18n";
import type { CanonicalStage } from "@/lib/stage-canonical";
import { opportunityValue, sumOpportunityValue } from "@/lib/opportunity-value";

/** The seven pipeline stages, in the order the ramp draws them. */
export const BOARD_STAGES: CanonicalStage[] = [
  "rfq_received",
  "jih",
  "jih_bafo",
  "under_negotiation",
  "verbally_awarded",
  "contract_received",
  "contract_signed",
];

/** Stages that are committed and still losable -- the number worth watching. */
const LATE_STAGE: CanonicalStage[] = [
  "jih_bafo",
  "under_negotiation",
  "verbally_awarded",
  "contract_received",
  "contract_signed",
];

export type BoardOpp = {
  id: string;
  owner_id: string | null;
  stage: string;
  sales_stage?: string | null;
  contract_value: number | null;
  quotation_value: number | null;
  estimated_value_max: number | null;
  won_at?: string | null;
  created_at?: string | null;
};

export type Pulse = {
  /** Approvals waiting on a human. The one thing a manager unblocks. */
  approvalsPending: number;
  /** Age in days of the oldest waiting approval, or null when none wait. */
  oldestApprovalDays: number | null;
  followUpsOverdue: number;
  /**
   * null when NO quotation carries a validity date at all -- which is the
   * production state today. A "0" here reads as "nothing is due this week";
   * the truth is "nobody records when a quotation expires", and those send a
   * reader to two different places. This board was built to keep them apart
   * and printed a zero here anyway.
   */
  quotationsDueSoon: number | null;
  /** Rows the count was drawn from. Zero means the input does not exist. */
  quotationsWithDates: number;
  tendersNeedingReview: number;
  inboxUnclassified: number;
};

export type StageSlice = {
  stage: CanonicalStage;
  count: number;
  value: number;
  /** Share of the valued total, 0-1. Zero when nothing is valued. */
  share: number;
};

/**
 * How far back a deal can have arrived and still count as open pipeline.
 *
 * Without a window the board read 633.7M against a 25M target -- because the
 * import carried four years of quotations, and a proposal sent in 2023 that was
 * never answered is not a live opportunity. It sits in an open STAGE only
 * because nobody ever closed it, which is a record-keeping fact, not a
 * commercial one.
 */
export const OPEN_WINDOW_MONTHS = 12;

export type Standing = {
  openTotal: number;
  openCount: number;
  /**
   * Open-stage deals that arrived before the window and are excluded above.
   * Printed on the board, never silently dropped: a filtered figure shown as a
   * total is the quiet kind of lie this file exists to avoid.
   */
  openExcludedCount: number;
  openExcludedValue: number;
  /** Open opportunities carrying no value at all -- printed, never hidden. */
  openUnvalued: number;
  wonThisMonth: number;
  wonThisMonthCount: number;
  lateStageExposure: number;
  composition: StageSlice[];
  /** null when no deal has closed either way -- a rate needs a denominator. */
  winRate: number | null;
};

export type PersonRow = {
  ownerId: string;
  /** Already reduced to initials or a first name by the caller. */
  label: string;
  won: number;
  target: number | null;
  /** null when there is no target to divide by. Never a stand-in zero. */
  achievement: number | null;
  open: number;
  openCount: number;
};

const dayMs = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / dayMs);

/** Month containing `now`, as a half-open [start, end) pair of ISO dates. */
export function monthBounds(now: Date): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(new Date(Date.UTC(y, m, 1))), end: iso(new Date(Date.UTC(y, m + 1, 1))) };
}

export function computePulse(input: {
  approvalsPendingAt: ReadonlyArray<string | null>;
  followUpDueDates: ReadonlyArray<string | null>;
  quotationDueDates: ReadonlyArray<string | null>;
  /**
   * Already counted by the caller with `requiresConversionReview` from
   * dashboard-helpers. Deliberately NOT recomputed here: that helper owns the
   * rule (age from submission, falling back to received; terminal stages
   * exempt), and a second implementation on the board is how the wall and the
   * Tenders page start disagreeing about the same tender.
   */
  tendersNeedingReview: number;
  inboxUnclassified: number;
  now: Date;
}): Pulse {
  const today = input.now.toISOString().slice(0, 10);
  const ages = input.approvalsPendingAt
    .filter((d): d is string => !!d)
    .map((d) => daysBetween(input.now, new Date(d)))
    .filter((n) => Number.isFinite(n));

  const soon = new Date(input.now.getTime() + 7 * dayMs).toISOString().slice(0, 10);
  const dated = input.quotationDueDates.filter((d): d is string => !!d);

  return {
    approvalsPending: input.approvalsPendingAt.length,
    // Math.max of an empty list is -Infinity, which would print as a number.
    oldestApprovalDays: ages.length ? Math.max(...ages) : null,
    followUpsOverdue: input.followUpDueDates.filter((d) => !!d && d < today).length,
    quotationsDueSoon: dated.length === 0 ? null : dated.filter((d) => d >= today && d <= soon).length,
    quotationsWithDates: dated.length,
    tendersNeedingReview: input.tendersNeedingReview,
    inboxUnclassified: input.inboxUnclassified,
  };
}

export function computeStanding(
  opps: readonly BoardOpp[],
  now: Date,
  windowMonths: number = OPEN_WINDOW_MONTHS,
): Standing {
  const month = monthBounds(now);
  // Half-open [cutoff, now). A deal received exactly on the boundary day is in.
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - windowMonths, now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
  const arrivedRecently = (o: BoardOpp) => {
    const d = (o.created_at ?? "").slice(0, 10);
    // No date at all counts as recent. Excluding it would hide a live deal on
    // the strength of a missing field, and the board must not lose work to a
    // blank cell.
    return !d || d >= cutoff;
  };
  const open: BoardOpp[] = [];
  const won: BoardOpp[] = [];
  const lost: BoardOpp[] = [];
  const stale: BoardOpp[] = [];
  const byStage = new Map<CanonicalStage, BoardOpp[]>();

  for (const o of opps) {
    const st = canonicalStageOf(o as never);
    if (st === "won") {
      won.push(o);
      continue;
    }
    if (st === "lost") {
      lost.push(o);
      continue;
    }
    if (!st) continue;
    if (!arrivedRecently(o)) {
      stale.push(o);
      continue;
    }
    open.push(o);
    const bucket = byStage.get(st);
    if (bucket) bucket.push(o);
    else byStage.set(st, [o]);
  }

  const openSum = sumOpportunityValue(open);
  const wonThisMonth = won.filter((o) => {
    const d = (o.won_at ?? "").slice(0, 10);
    return d >= month.start && d < month.end;
  });

  const composition: StageSlice[] = BOARD_STAGES.map((stage) => {
    const rows = byStage.get(stage) ?? [];
    const value = sumOpportunityValue(rows).total;
    return { stage, count: rows.length, value, share: 0 };
  });
  const valued = composition.reduce((a, s) => a + s.value, 0);
  for (const s of composition) s.share = valued > 0 ? s.value / valued : 0;

  const lateStage = open.filter((o) => {
    const st = canonicalStageOf(o as never);
    return !!st && LATE_STAGE.includes(st);
  });

  const decided = won.length + lost.length;

  const staleSum = sumOpportunityValue(stale);

  return {
    openTotal: openSum.total,
    openCount: open.length,
    openExcludedCount: stale.length,
    openExcludedValue: staleSum.total,
    openUnvalued: openSum.unvalued,
    wonThisMonth: sumOpportunityValue(wonThisMonth).total,
    wonThisMonthCount: wonThisMonth.length,
    lateStageExposure: sumOpportunityValue(lateStage).total,
    composition,
    // A win rate with no decided deals is not 0%, it is unanswerable.
    winRate: decided > 0 ? won.length / decided : null,
  };
}

export function computeTeam(
  opps: readonly BoardOpp[],
  targets: ReadonlyMap<string, number>,
  labels: ReadonlyMap<string, string>,
  now: Date,
  windowMonths: number = OPEN_WINDOW_MONTHS,
): PersonRow[] {
  const month = monthBounds(now);
  // Same window as the headline. A per-person pipeline computed on different
  // rows than the total is a column that will never add up to the number above
  // it, and someone will eventually notice and trust neither.
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - windowMonths, now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
  const owners = new Set<string>();
  for (const o of opps) if (o.owner_id) owners.add(o.owner_id);
  for (const id of targets.keys()) owners.add(id);

  const rows: PersonRow[] = [];
  for (const ownerId of owners) {
    const mine = opps.filter((o) => o.owner_id === ownerId);
    const won = mine.filter((o) => {
      if (canonicalStageOf(o as never) !== "won") return false;
      const d = (o.won_at ?? "").slice(0, 10);
      return d >= month.start && d < month.end;
    });
    const open = mine.filter((o) => {
      const st = canonicalStageOf(o as never);
      if (!st || st === "won" || st === "lost") return false;
      const d = (o.created_at ?? "").slice(0, 10);
      return !d || d >= cutoff;
    });
    const wonValue = sumOpportunityValue(won).total;
    const target = targets.get(ownerId) ?? null;
    rows.push({
      ownerId,
      label: labels.get(ownerId) ?? "—",
      won: wonValue,
      target,
      // Dividing by a target nobody set produces a confident lie.
      achievement: target && target > 0 ? wonValue / target : null,
      open: sumOpportunityValue(open).total,
      openCount: open.length,
    });
  }
  // Achievement first where it exists, then by open pipeline. A person with no
  // target still appears -- absence of a target is not absence of work.
  return rows.sort((a, b) => (b.achievement ?? -1) - (a.achievement ?? -1) || b.open - a.open);
}

export type MonthPoint = {
  /** `YYYY-MM`, so a caller can label it in either language. */
  key: string;
  /** 1-12, for month-name lookup without re-parsing. */
  month: number;
  value: number;
  count: number;
};

/**
 * Won value per month for the last `months` months, oldest first.
 *
 * A wall board shows totals, and a total has no direction: 3.2M means nothing
 * without last month beside it. This is the cheapest honest way to give the
 * figure a slope -- and every bucket is a real month, so an empty one renders
 * as an empty bar rather than being dropped and silently flattering the trend.
 */
export function wonTrend(opps: readonly BoardOpp[], now: Date, months = 6): MonthPoint[] {
  const out: MonthPoint[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    const start = d.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    const inMonth = opps.filter((o) => {
      if (canonicalStageOf(o as never) !== "won") return false;
      const w = (o.won_at ?? "").slice(0, 10);
      return w >= start && w < end;
    });
    out.push({
      key: start.slice(0, 7),
      month: d.getUTCMonth() + 1,
      value: sumOpportunityValue(inMonth).total,
      count: inMonth.length,
    });
  }
  return out;
}

export type YearProgress = {
  won: number;
  target: number | null;
  /** null when no annual target exists. A ratio needs a denominator. */
  ratio: number | null;
  /** Fraction of the year elapsed, 0-1 -- the pace line the bar is judged against. */
  yearElapsed: number;
};

/**
 * Year-to-date won against the annual target.
 *
 * `yearElapsed` is what makes the bar readable: 40% of target in January is
 * ahead, the same 40% in November is behind. A progress bar without a pace
 * marker invites exactly the wrong reading, on a screen nobody can question.
 */
export function yearProgress(
  opps: readonly BoardOpp[],
  annualTarget: number | null,
  now: Date,
): YearProgress {
  const y = now.getUTCFullYear();
  const start = `${y}-01-01`;
  const won = sumOpportunityValue(
    opps.filter((o) => {
      if (canonicalStageOf(o as never) !== "won") return false;
      const w = (o.won_at ?? "").slice(0, 10);
      return w >= start;
    }),
  ).total;
  const yearStart = Date.UTC(y, 0, 1);
  const yearEnd = Date.UTC(y + 1, 0, 1);
  return {
    won,
    target: annualTarget,
    ratio: annualTarget && annualTarget > 0 ? won / annualTarget : null,
    yearElapsed: (now.getTime() - yearStart) / (yearEnd - yearStart),
  };
}

/**
 * A person's display label for a screen a visitor may see.
 *
 * First name where one word is enough to identify them to the team, initials
 * otherwise. Note what this does NOT claim: in a team of fourteen, initials are
 * not anonymity -- anyone who knows the team can undo them. It lowers what a
 * passing glance discloses, and that is all it is for.
 */
export function displayLabel(fullName: string | null | undefined): string {
  const clean = (fullName ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "—";
  const parts = clean.split(" ");
  if (parts.length === 1) return parts[0];
  return parts.map((p) => p[0]).join("").slice(0, 3).toUpperCase();
}

/**
 * 633,705,805 is nine digits. At wall size it is a wall of digits: the reader
 * counts groups instead of reading a magnitude, and the four headline figures
 * stop being comparable at a glance because they are different LENGTHS rather
 * than different sizes.
 *
 * Compact notation fixes both -- 633.7M reads as one quantity. Precision below
 * a tenth of a million is not a thing anyone acts on from across a room, and
 * the exact figure is one click away on the Opportunities page for anyone who
 * needs it. Under a thousand it stays exact, because there rounding would be
 * the only thing the reader sees.
 */
export function compactValue(n: number | null | undefined, lang: "ar" | "en"): string | null {
  if (n === null || n === undefined) return null;
  const abs = Math.abs(n);
  const fmt = (v: number, d: number) =>
    new Intl.NumberFormat(localeFor(lang), {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(v);
  if (abs >= 1_000_000_000) return fmt(n / 1_000_000_000, 2) + (lang === "ar" ? " مليار" : "B");
  if (abs >= 1_000_000) return fmt(n / 1_000_000, 1) + (lang === "ar" ? " مليون" : "M");
  if (abs >= 1_000) return fmt(n / 1_000, 0) + (lang === "ar" ? " ألف" : "k");
  return fmt(n, 0);
}

/**
 * The same figure, split into the number and its unit.
 *
 * The card design puts "7.9" at 3vw and "مليون ر.س" small beneath it, so the
 * eye lands on the magnitude and the unit stays available without competing.
 * `compactValue` glues them together, which is right in a table cell and wrong
 * in a headline card -- so this returns the two parts rather than a caller
 * pulling a string apart and guessing where the boundary is.
 */
export function splitCompact(
  n: number | null | undefined,
  lang: "ar" | "en",
): { n: string; unit: string | null } | null {
  if (n === null || n === undefined) return null;
  const abs = Math.abs(n);
  const fmt = (v: number, d: number) =>
    new Intl.NumberFormat(localeFor(lang), {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(v);
  if (abs >= 1_000_000_000) return { n: fmt(n / 1e9, 2), unit: lang === "ar" ? "مليار ر.س" : "SAR bn" };
  if (abs >= 1_000_000) return { n: fmt(n / 1e6, 1), unit: lang === "ar" ? "مليون ر.س" : "SAR m" };
  if (abs >= 1_000) return { n: fmt(n / 1e3, 0), unit: lang === "ar" ? "ألف ر.س" : "SAR k" };
  return { n: fmt(n, 0), unit: lang === "ar" ? "ر.س" : "SAR" };
}

export type YearOnYear = {
  thisYear: number;
  priorYear: number;
  thisCount: number;
  priorCount: number;
  /** null when last year's same window held nothing -- growth from zero is not a percentage. */
  ratio: number | null;
};

/**
 * This year to date against the SAME WINDOW last year.
 *
 * Not against last year's full total, which would flatter every January and
 * damn every December. The comparison is only fair if both sides cover the
 * same slice of the calendar.
 */
export function yearOnYear(opps: readonly BoardOpp[], now: Date): YearOnYear {
  const y = now.getUTCFullYear();
  const md = now.toISOString().slice(4, 10); // "-MM-DD"
  const inWindow = (year: number) => (o: BoardOpp) => {
    const w = (o.won_at ?? "").slice(0, 10);
    return !!w && w >= `${year}-01-01` && w <= `${year}${md}`;
  };
  const cur = opps.filter(inWindow(y));
  const prev = opps.filter(inWindow(y - 1));
  const thisYear = sumOpportunityValue(cur).total;
  const priorYear = sumOpportunityValue(prev).total;
  return {
    thisYear,
    priorYear,
    thisCount: cur.length,
    priorCount: prev.length,
    // Going from nothing to something is a start, not a percentage.
    ratio: priorYear > 0 ? (thisYear - priorYear) / priorYear : null,
  };
}

/** How the board describes its own freshness. See the file header. */
export type Freshness = "live" | "slow" | "stale";

/**
 * `updatedAt` is when the last successful fetch resolved.
 *
 * Past `staleAfterMs` the board must visibly stop asserting its numbers. The
 * thresholds are generous relative to the poll interval on purpose: one missed
 * poll is a blip, three is a problem worth showing.
 */
export function freshnessOf(updatedAt: number | null, now: number, pollMs: number): Freshness {
  if (updatedAt === null) return "stale";
  const age = now - updatedAt;
  if (age <= pollMs * 2) return "live";
  if (age <= pollMs * 4) return "slow";
  return "stale";
}
