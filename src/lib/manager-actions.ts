// =============================================================================
// The manager's five actions — the rules behind each card on /command-center.
//
// Asked for 2026-10-19: a home page that steers the manager to the top five
// actions — call, meeting, email, follow up with the team, approve. Each card
// shows what the system already knows; nothing here writes or guesses.
// Spec: docs/superpowers/specs/2026-10-19-manager-actions-info-mail-design.md
// =============================================================================

import { daysBetween, type AttentionItem } from "@/lib/attention";
import { effectiveRole, type StakeholderRow } from "@/lib/stakeholder-roles";
import { isManagerDecision } from "@/lib/approval-labels";
import type { RepDay } from "@/lib/daily-tasks";
import type { UnifiedApproval } from "@/lib/approvals-center";

/** A deal is quiet after this many days without verified client contact. */
export const QUIET_DAYS = 14;
/** How far back the command center reads activity; older contact shows as "30+". */
export const ACTIVITY_WINDOW_DAYS = 30;

export type ContactRow = StakeholderRow & { contact_order?: number | null };

export type CallItem = {
  opportunityId: string;
  projectName: string;
  contactName: string | null;
  phone: string | null;
  /** Days since the last client contact; null = none in the activity window. */
  quietDays: number | null;
  score: number;
};

const hasPhone = (s: ContactRow) => Boolean(s.phone?.trim());

/** Who to call on a deal: the decision maker with a phone, else anyone with a phone, else the first listed. */
export function pickContact(rows: ContactRow[]): { name: string | null; phone: string | null } | null {
  const ordered = [...rows].sort((a, b) => (a.contact_order ?? 999) - (b.contact_order ?? 999));
  const chosen =
    ordered.find((s) => effectiveRole(s) === "decision_maker" && hasPhone(s)) ??
    ordered.find(hasPhone) ??
    ordered[0];
  if (!chosen) return null;
  return { name: chosen.name?.trim() || null, phone: chosen.phone?.trim() || null };
}

/** Top-priority deals (at risk, stalled, closing soon) that have gone quiet, highest score first. */
export function callItems(
  attention: AttentionItem[],
  stakeholdersByOpp: Map<string, ContactRow[]>,
  today: string,
): CallItem[] {
  return attention
    .filter((a) => a.atRisk || a.stalled || a.closingSoon)
    .map((a) => ({ a, quiet: a.lastClientActivity ? daysBetween(a.lastClientActivity, today) : null }))
    .filter(({ quiet }) => quiet === null || quiet >= QUIET_DAYS)
    .sort((x, y) => y.a.score - x.a.score)
    .map(({ a, quiet }) => {
      const contact = pickContact(stakeholdersByOpp.get(a.opportunityId) ?? []);
      return {
        opportunityId: a.opportunityId,
        projectName: a.label,
        contactName: contact?.name ?? null,
        phone: contact?.phone ?? null,
        quietDays: quiet,
        score: a.score,
      };
    });
}

/** Reps who need a nudge today: anything overdue, or work due and nothing done yet. */
export function teamItems(rows: RepDay[]): RepDay[] {
  return rows
    .filter((r) => r.overdue > 0 || (r.open_due > 0 && r.done === 0))
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.open_due - a.open_due ||
        (a.full_name ?? "").localeCompare(b.full_name ?? ""),
    );
}

/** Pending decisions that are genuinely the manager's (see approval-labels.ts), oldest first. */
export function approveItems(list: UnifiedApproval[]): UnifiedApproval[] {
  return list
    .filter((a) => a.state === "pending" && isManagerDecision(a.kind, a.approvalType))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/**
 * `startLocal` is Outlook's Riyadh-time "YYYY-MM-DDTHH:mm"; `today` is the Riyadh date.
 * An event that started before today is still running (a multi-day or all-day one
 * the calendar window returned), so it counts as today.
 */
export function meetingDay(startLocal: string, today: string): "today" | "tomorrow" | "later" {
  const day = startLocal.slice(0, 10);
  if (day <= today) return "today";
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return day === next.toISOString().slice(0, 10) ? "tomorrow" : "later";
}
