// =============================================================================
// Phase 5.1 §18 closure — the draft/confirm loop.
//
//   AI ──▶ Draft ──▶ [user reads it] ──▶ [user presses Confirm] ──▶ existing
//                                                                   write path
//
// A draft is inert. It is a plain object with no side effect, and nothing in
// this module writes anything. Confirmation calls scheduleFollowUp() — the same
// function the Add Follow-up button has always called — so there is exactly one
// place that creates a follow-up and one audit trail behind it. A second task
// system would be two places to look when something is missing.
//
// NOTHING IS EVER SENT. A "draft follow-up" produces text for a human to read,
// copy and send themselves. The forbidden-action list already covers send_email
// and send_whatsapp; this module offers no function that could reach them, so
// the guarantee holds by construction rather than by enforcement.
//
// Meeting briefs and next-action suggestions are read-only outputs. They have
// no confirm step because they write nothing at all.
// =============================================================================

import { scheduleFollowUp } from "@/lib/opportunity-actions";
import { checkRecommendation, type AiRecommendation } from "@/lib/sales-ai";
import type { AttentionItem } from "@/lib/attention";

export type DraftKind = "follow_up" | "meeting_brief" | "next_action";

/** What a draft can become. Only `follow_up` has a write behind it. */
export const DRAFT_WRITES: Record<DraftKind, "follow_up" | "none"> = {
  follow_up: "follow_up",
  meeting_brief: "none",
  next_action: "none",
};

export type FollowUpDraft = {
  kind: "follow_up";
  opportunityId: string;
  /** What the user would do. Editable before confirmation. */
  title: string;
  /** Suggested only where a date can be grounded in something real. */
  dueDate: string | null;
  /** Why this is being proposed — the deterministic reasons, not a model's mood. */
  rationale: string[];
  /** Message text for the human to send themselves. Never transmitted. */
  message: string | null;
};

export type MeetingBriefDraft = {
  kind: "meeting_brief";
  opportunityId: string;
  headline: string;
  points: string[];
};

export type NextActionDraft = {
  kind: "next_action";
  opportunityId: string;
  suggestion: string;
  rationale: string[];
};

export type Draft = FollowUpDraft | MeetingBriefDraft | NextActionDraft;

/**
 * A draft carries no authority until a person accepts it.
 *
 * Modelled explicitly rather than by a boolean somewhere, because "did a human
 * agree to this" is the single question every sensitive write turns on and it
 * should be impossible to lose track of.
 */
export type DraftState =
  | { status: "drafted"; draft: Draft }
  | { status: "confirmed"; draft: Draft; resultId: string }
  | { status: "discarded"; draft: Draft };

// ---- Building drafts (pure, no I/O) ----------------------------------------

/**
 * A due date only where one can be grounded.
 *
 * An overdue follow-up suggests today, because it is already late. Otherwise a
 * deal's own expected close date anchors it. With neither, the draft carries
 * NO date and the user supplies one — an invented deadline is the same defect
 * as an invented SLA, and it would land in a real queue.
 */
export function groundedDueDate(item: AttentionItem, today: string): string | null {
  if (item.reasons.some((r) => r.kind === "follow_up_overdue" || r.kind === "next_action_overdue")) {
    return today;
  }
  if (item.closingSoon && item.aging.enteredAt) return today;
  return null;
}

export function draftFollowUp(item: AttentionItem, today: string): FollowUpDraft {
  return {
    kind: "follow_up",
    opportunityId: item.opportunityId,
    title: `Follow up on ${item.label}`,
    dueDate: groundedDueDate(item, today),
    // The reasons the deterministic engine already produced. The draft explains
    // itself from the record, so a reader can disagree with it on the facts.
    rationale: item.reasons.map((r) => r.kind),
    message: null,
  };
}

export function draftMeetingBrief(item: AttentionItem): MeetingBriefDraft {
  return {
    kind: "meeting_brief",
    opportunityId: item.opportunityId,
    headline: item.label,
    points: item.reasons.map((r) => r.kind),
  };
}

export function draftNextAction(item: AttentionItem): NextActionDraft {
  const primary = item.primaryReason.kind;
  return {
    kind: "next_action",
    opportunityId: item.opportunityId,
    suggestion: primary,
    rationale: item.reasons.map((r) => r.kind),
  };
}

// ---- Confirmation ----------------------------------------------------------

export type ConfirmResult =
  | { ok: true; state: DraftState }
  | { ok: false; reason: "not_writable" | "no_due_date" | "forbidden" };

/**
 * The ONLY path from a draft to a record, and it needs a due date.
 *
 * `scheduleFollowUp` is the app's existing creator — the same one the manual
 * button calls — so a confirmed draft is indistinguishable downstream from a
 * follow-up somebody typed, and it inherits that path's audit trail rather
 * than growing a parallel one.
 */
export async function confirmDraft(draft: Draft): Promise<ConfirmResult> {
  if (DRAFT_WRITES[draft.kind] === "none") {
    // Meeting briefs and next-action suggestions are read-only by design.
    // Refusing here rather than silently doing nothing means a caller that
    // wires up the wrong button finds out immediately.
    return { ok: false, reason: "not_writable" };
  }

  const followUp = draft as FollowUpDraft;
  if (!followUp.dueDate) return { ok: false, reason: "no_due_date" };

  const created = await scheduleFollowUp({
    opportunityId: followUp.opportunityId,
    dueDate: followUp.dueDate,
    notes: followUp.title,
  });

  return {
    ok: true,
    state: { status: "confirmed", draft, resultId: (created as { id?: string })?.id ?? "" },
  };
}

/**
 * Guard for anything a model proposes doing.
 *
 * Reuses checkRecommendation so there is one list of forbidden actions in the
 * codebase. A draft surface that grew its own list would drift from the brief's.
 */
export function isProposalAllowed(r: AiRecommendation): boolean {
  return checkRecommendation(r).allowed;
}
