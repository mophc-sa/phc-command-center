// PHC Sales OS — Pure helper functions for the Salesperson Dashboard.
// Extracted from the dashboard route so they can be unit-tested in isolation.
// No Supabase, no React, no side-effects.

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the number of whole days from today (midnight) until `dateStr`.
 * Negative = past / overdue. Null when no date is provided.
 */
export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns the number of whole days from `dateStr` until today.
 * Positive = past. Null when no date is provided.
 */
export function daysSince(dateStr: string | null | undefined): number | null {
  const d = daysUntil(dateStr);
  // `|| 0` coerces -0 → 0 to satisfy strict equality checks (Object.is(-0, 0) === false)
  return d === null ? null : (-d || 0);
}

// ─── Urgency classification ───────────────────────────────────────────────────

export type UrgencyTone = "danger" | "attention" | "neutral";

/**
 * Maps days-until-due to a display tone.
 *  <= 0  → danger   (overdue or due today)
 *  1-5   → attention
 *  > 5   → neutral
 */
export function urgencyTone(days: number | null): UrgencyTone {
  if (days === null) return "neutral";
  if (days <= 0) return "danger";
  if (days <= 5) return "attention";
  return "neutral";
}

/**
 * Maps days-until-due to a human-readable label.
 * lang = "ar" | "en"
 */
export function urgencyLabel(days: number | null, lang: "ar" | "en"): string {
  if (days === null) return "—";
  if (days < 0) return lang === "ar" ? `متأخر ${Math.abs(days)}ي` : `${Math.abs(days)}d overdue`;
  if (days === 0) return lang === "ar" ? "اليوم" : "Due today";
  return lang === "ar" ? `${days} يوم` : `${days}d left`;
}

// ─── Awarded value calculation ────────────────────────────────────────────────

export type OpportunityStageRow = {
  id: string;
  stage: string;        // opportunity_stage: won | lost | discovery | etc.
  sales_stage: string | null; // sales_stage: won | verbally_awarded | contract_received | etc.
  estimated_value_max: number | null;
  contract_value: number | null;
};

/**
 * Computes the total officially-awarded value.
 *
 * Only opportunities with `stage = 'won'` (the macro-level opportunity_stage)
 * are counted. Sub-stages such as verbally_awarded, contract_received, or
 * contract_signed do NOT contribute until the official 'won' status is set.
 *
 * Uses `contract_value` when available, falls back to `estimated_value_max`.
 */
export function computeAwardedTotal(opps: OpportunityStageRow[]): number {
  return opps
    .filter(o => o.stage === "won")
    .reduce((sum, o) => sum + (Number(o.contract_value ?? o.estimated_value_max) || 0), 0);
}

/**
 * Returns only the officially-awarded opportunities (stage = 'won').
 * Verbally awarded, contract received/signed are excluded.
 */
export function filterAwardedOpps(opps: OpportunityStageRow[]): OpportunityStageRow[] {
  return opps.filter(o => o.stage === "won");
}

// ─── Pipeline totals ─────────────────────────────────────────────────────────

export const JIH_ACTIVE_STAGES = new Set([
  "jih", "jih_bafo", "verbally_awarded", "contract_received", "contract_signed",
]);

export const TENDER_TERMINAL_STAGES = new Set([
  "converted_to_jih", "tender_lost_or_archived",
]);

export type TenderPipelineRow = {
  id: string;
  tender_stage: string;
  estimated_project_value: number | null;
};

/**
 * Returns the total active JIH pipeline value.
 * Includes: jih, jih_bafo, verbally_awarded, contract_received, contract_signed.
 * Excludes: won (already awarded), lost, on_hold.
 */
export function computeJihPipelineTotal(
  opps: Array<{ sales_stage: string | null; estimated_value_max: number | null }>,
): number {
  return opps
    .filter(o => o.sales_stage !== null && JIH_ACTIVE_STAGES.has(o.sales_stage))
    .reduce((sum, o) => sum + (o.estimated_value_max || 0), 0);
}

/**
 * Returns the total active tender pipeline value.
 * Excludes terminal stages: converted_to_jih, tender_lost_or_archived.
 */
export function computeTenderPipelineTotal(tenders: TenderPipelineRow[]): number {
  return tenders
    .filter(t => !TENDER_TERMINAL_STAGES.has(t.tender_stage))
    .reduce((sum, t) => sum + (t.estimated_project_value || 0), 0);
}

// ─── 90-day Tender conversion review ─────────────────────────────────────────

/**
 * Determines whether a tender requires conversion review.
 *
 * Age is calculated from:
 *   1. `submissionDate` (actual quotation submission date), when available.
 *   2. `receivedDate` (RFQ / tender created date) as fallback.
 *
 * A tender is flagged for review when its age >= 90 days AND it is not in a
 * terminal stage (converted_to_jih or tender_lost_or_archived).
 */
export function requiresConversionReview(tender: {
  tender_stage: string;
  submissionDate: string | null | undefined;
  receivedDate: string | null | undefined;
}, thresholdDays = 90): boolean {
  if (TENDER_TERMINAL_STAGES.has(tender.tender_stage)) return false;
  const referenceDate = tender.submissionDate ?? tender.receivedDate;
  const age = daysSince(referenceDate);
  if (age === null) return false;
  return age >= thresholdDays;
}

/**
 * Computes the age of a tender in days (using submission date if available,
 * otherwise received/created date).
 */
export function tenderAgeDays(tender: {
  submissionDate: string | null | undefined;
  receivedDate: string | null | undefined;
}): number | null {
  const referenceDate = tender.submissionDate ?? tender.receivedDate;
  return daysSince(referenceDate);
}

// ─── RFQ submission urgency ───────────────────────────────────────────────────

export type SubmissionUrgencyCategory =
  | "overdue"
  | "critical"  // due today
  | "high"      // 1-2 days
  | "warning"   // 3-5 days
  | "upcoming"  // 6-7 days
  | "ok";       // > 7 days

/**
 * Categorises an RFQ submission deadline per the spec urgency rules:
 *   Overdue     → critical
 *   Due today   → critical
 *   Within 2d   → high
 *   Within 3-5d → warning
 *   Within 6-7d → upcoming
 *   Beyond 7d   → ok
 */
export function submissionUrgencyCategory(
  responsedueDays: number | null,
): SubmissionUrgencyCategory {
  if (responsedueDays === null) return "ok";
  if (responsedueDays < 0) return "overdue";
  if (responsedueDays === 0) return "critical";
  if (responsedueDays <= 2) return "high";
  if (responsedueDays <= 5) return "warning";
  if (responsedueDays <= 7) return "upcoming";
  return "ok";
}

// ─── Target achievement ───────────────────────────────────────────────────────

/**
 * Computes the target achievement percentage.
 * Returns null when no target is set (salesTarget <= 0).
 */
export function targetAchievementPct(
  awardedValue: number,
  salesTarget: number,
): number | null {
  if (salesTarget <= 0) return null;
  return Math.round((awardedValue / salesTarget) * 100);
}

/**
 * Computes the remaining target.
 * Returns null when no target is set (salesTarget <= 0).
 * Never returns a negative value (floored at 0).
 */
export function remainingTarget(
  awardedValue: number,
  salesTarget: number,
): number | null {
  if (salesTarget <= 0) return null;
  return Math.max(0, salesTarget - awardedValue);
}
