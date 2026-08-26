// =============================================================================
// Phase 5.1 §15 — Sales Execution, replacing the activity-count chart.
//
// The chart this replaces plotted "logged activities per day" over 30 days. A
// manager reading "today: 2" learns nothing they can act on, and the metric
// rewards logging rather than selling.
//
// What replaces it is per-person OUTCOMES: what they are carrying, what they
// have moved, and what has gone quiet on them. Deliberately NOT calls placed or
// emails sent — that is surveillance, it measures activity rather than
// discipline, and it is trivially gamed by someone who logs more.
//
// Every column here comes from data the app already holds. Nothing is
// approximated: a metric with no source is absent, not estimated.
// =============================================================================

import {
  isOpen,
  isWon,
  opportunityValue,
  resolveProbability,
  type OppRow,
} from "@/lib/sales-kpis";
import { isMeaningfulClientActivity, type ActivityRow, type AttentionItem } from "@/lib/attention";

export type FollowUpExecRow = {
  id: string;
  opportunity_id: string;
  owner_id?: string | null;
  due_date: string;
  status?: string | null;
};

export type QuotationExecRow = {
  id: string;
  related_opportunity_id?: string | null;
  status?: string | null;
  value?: number | string | null;
  issued_date?: string | null;
};

export type SalesExecutionRow = {
  ownerId: string;
  /** Open pipeline value they are carrying. */
  openPipeline: number;
  /**
   * Weighted pipeline, or null when none of their open deals carry a
   * probability. Zero would say the pipeline is worthless; null says we cannot
   * weigh it — the same distinction Package A drew for the company total.
   */
  weightedPipeline: number | null;
  /** Open deals with no probability, so the reader can see what the null costs. */
  unscoredCount: number;
  followUpsDue: number;
  followUpsCompleted: number;
  /** Real client-facing meetings, not notes and not unsent drafts. */
  meetings: number;
  /** Value of quotations that actually went out in the period. */
  submittedValue: number;
  wonValue: number;
  /** Value sitting on deals the attention engine deterministically calls stalled. */
  stalledValue: number;
  openCount: number;
};

export type SalesExecutionInput = {
  opportunities: OppRow[];
  followUps?: FollowUpExecRow[];
  activities?: ActivityRow[];
  quotations?: QuotationExecRow[];
  /** Deterministic stalled verdicts, reused rather than recomputed. */
  attention?: AttentionItem[];
  today: string;
  /** Only rows on or after this date count toward period metrics. */
  since?: string | null;
};

const inPeriod = (iso: string | null | undefined, since: string | null | undefined) =>
  !!iso && (!since || iso.slice(0, 10) >= since.slice(0, 10));

/**
 * One row per owner. Owners come from the opportunities themselves, so a
 * salesperson with no pipeline does not appear — this is a view of the book,
 * not a staff roster, and an empty row invites reading absence as failure.
 */
export function salesExecution(input: SalesExecutionInput): SalesExecutionRow[] {
  const { today, since = null } = input;
  const owners = new Set<string>();
  for (const o of input.opportunities) if (o.owner_id) owners.add(o.owner_id);

  const oppOwner = new Map<string, string>();
  for (const o of input.opportunities) if (o.owner_id) oppOwner.set(o.id, o.owner_id);

  const stalledByOpp = new Map(
    (input.attention ?? []).filter((a) => a.stalled).map((a) => [a.opportunityId, a.value ?? 0]),
  );

  return [...owners]
    .sort()
    .map((ownerId) => {
      const mine = input.opportunities.filter((o) => o.owner_id === ownerId);
      const open = mine.filter(isOpen);
      const scored = open.filter((o) => resolveProbability(o).value !== null);

      const weighted =
        scored.length === 0
          ? null
          : scored.reduce((s, o) => s + (opportunityValue(o) ?? 0) * (resolveProbability(o).value ?? 0), 0);

      const myFollowUps = (input.followUps ?? []).filter(
        (f) => (f.owner_id ?? oppOwner.get(f.opportunity_id)) === ownerId,
      );

      const myActivities = (input.activities ?? []).filter(
        (a) => a.opportunity_id && oppOwner.get(a.opportunity_id) === ownerId,
      );

      const myQuotes = (input.quotations ?? []).filter(
        (q) => q.related_opportunity_id && oppOwner.get(q.related_opportunity_id) === ownerId,
      );

      return {
        ownerId,
        openPipeline: open.reduce((s, o) => s + (opportunityValue(o) ?? 0), 0),
        weightedPipeline: weighted,
        unscoredCount: open.length - scored.length,
        followUpsDue: myFollowUps.filter(
          (f) => f.status !== "completed" && f.status !== "cancelled" && f.due_date <= today,
        ).length,
        followUpsCompleted: myFollowUps.filter(
          (f) => f.status === "completed" && inPeriod(f.due_date, since),
        ).length,
        meetings: myActivities.filter(
          (a) => a.activity_type === "meeting" && isMeaningfulClientActivity(a) && inPeriod(a.created_at, since),
        ).length,
        // Issued, not drafted. A quotation with no issued_date never went out.
        submittedValue: myQuotes
          .filter((q) => q.issued_date && inPeriod(q.issued_date, since))
          .reduce((s, q) => s + Number(q.value ?? 0), 0),
        wonValue: mine.filter(isWon).reduce((s, o) => s + (opportunityValue(o) ?? 0), 0),
        stalledValue: mine.reduce((s, o) => s + (stalledByOpp.get(o.id) ?? 0), 0),
        openCount: open.length,
      };
    })
    // Largest book first. This is a management read, not a league table — the
    // order says who carries most, not who is best.
    .sort((a, b) => b.openPipeline - a.openPipeline || a.ownerId.localeCompare(b.ownerId));
}
