// =============================================================================
// Commitments — the client side of Phase 9.
//
// A commitment is a promise with a counterparty and a date. "We'll have the
// revised drawing to you Thursday" and "they'll confirm the mounting height by
// the 5th" are the two things a deal actually dies on, and before Phase 9 both
// lived in the free text of a note where nothing could ask "what have we
// promised that is now late".
//
// WHAT THIS MODULE DOES NOT ENFORCE
// ---------------------------------
// Almost nothing, deliberately. The database owns every rule here:
//
//   * the terms are immutable once made — description, direction, due date and
//     the deal it belongs to cannot be edited, so there is no edit function
//     below to write
//   * closing stamps who and when from the session, so the caller cannot
//     name someone else
//   * waiving requires a reason
//   * a closed commitment cannot be reopened
//   * nothing is ever deleted
//
// The UI mirrors those rules to give a better error, and the trigger is what
// actually holds. If this file and the database ever disagree, the database is
// right — that is the point of putting it there.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import { audit } from "@/lib/audit";

export type CommitmentDirection = "we_owe_client" | "client_owes_us";
export type CommitmentStatus = "open" | "met" | "missed" | "waived" | "cancelled";

export type Commitment = {
  id: string;
  opportunity_id: string;
  company_id: string | null;
  contact_id: string | null;
  direction: CommitmentDirection;
  description: string;
  due_date: string;
  owner_id: string | null;
  status: CommitmentStatus;
  source_activity_id: string | null;
  closed_at: string | null;
  closed_by: string | null;
  outcome_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OverdueCommitment = {
  id: string;
  opportunity_id: string;
  company_id: string | null;
  direction: CommitmentDirection;
  description: string;
  due_date: string;
  owner_id: string | null;
  days_overdue: number;
};

export type NextAction = {
  opportunity_id: string;
  source: "follow_up" | "task" | "commitment";
  source_id: string;
  due_date: string;
  owner_id: string | null;
  description: string;
  is_overdue: boolean;
  days_until_due: number;
};

/** Every commitment on one deal, soonest first, with closed ones last. */
export async function listCommitments(opportunityId: string): Promise<Commitment[]> {
  const { data, error } = await supabase
    .from("commitments")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .order("status", { ascending: true })   // 'open' sorts before the rest
    .order("due_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Commitment[];
}

/**
 * Open commitments past their date, both directions.
 *
 * Reads the `overdue_commitments` view rather than filtering here: lateness is
 * computed against the database's clock, not the browser's. A laptop with a
 * skewed date would otherwise show a different set of overdue promises to its
 * owner than to anyone else.
 */
export async function listOverdueCommitments(): Promise<OverdueCommitment[]> {
  const { data, error } = await supabase
    .from("overdue_commitments")
    .select("*")
    .order("days_overdue", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as OverdueCommitment[];
}

/** The single next thing due on each deal, across follow-ups, tasks and commitments. */
export async function listNextActions(): Promise<NextAction[]> {
  const { data, error } = await supabase
    .from("opportunity_next_action")
    .select("*")
    .order("due_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as NextAction[];
}

export async function createCommitment(input: {
  opportunityId: string;
  direction: CommitmentDirection;
  description: string;
  dueDate: string;
  companyId?: string | null;
  contactId?: string | null;
  ownerId?: string | null;
}): Promise<Commitment> {
  const description = input.description.trim();
  if (!description) throw new Error("Say what was promised.");
  if (!input.dueDate) throw new Error("A commitment needs a date.");

  const { data, error } = await supabase
    .from("commitments")
    .insert({
      opportunity_id: input.opportunityId,
      direction: input.direction,
      description,
      due_date: input.dueDate,
      company_id: input.companyId ?? null,
      contact_id: input.contactId ?? null,
      owner_id: input.ownerId ?? null,   // the trigger falls back to the session
    })
    .select()
    .single();
  if (error) throw error;

  await audit("commitment.created", "opportunity", input.opportunityId, null, {
    direction: input.direction, description, due_date: input.dueDate,
  });
  return data as unknown as Commitment;
}

/**
 * Close a commitment. One way, once.
 *
 * `outcome_note` is required for a waiver by database constraint, and asked for
 * on every close by this function — a met promise with no note is still worth
 * recording how it was met, and a missed one is worth recording why.
 */
export async function closeCommitment(input: {
  id: string;
  opportunityId: string;
  status: Exclude<CommitmentStatus, "open">;
  note?: string;
}): Promise<Commitment> {
  const note = (input.note ?? "").trim();
  if (input.status === "waived" && !note) {
    throw new Error("Waiving a commitment needs a reason.");
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({ status: input.status, outcome_note: note || null })
    .eq("id", input.id)
    .select()
    .single();
  if (error) throw error;

  await audit("commitment.closed", "opportunity", input.opportunityId, null, {
    commitment_id: input.id, status: input.status, note: note || null,
  });
  return data as unknown as Commitment;
}

// ---- Pure helpers, so the rules are testable without a browser -------------

/** Days from today to a due date. Negative means overdue. */
export function daysUntil(dueDate: string, today = new Date()): number {
  const due = new Date(`${dueDate}T00:00:00Z`);
  const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return Math.round((due.getTime() - now.getTime()) / 86_400_000);
}

export type CommitmentUrgency = "overdue" | "today" | "soon" | "later" | "closed";

/**
 * How loudly to render one commitment.
 *
 * "soon" is three days rather than a week: a signage lead time is measured in
 * weeks, so a promise due in six days is not yet actionable, while one due in
 * two needs to be on today's list.
 */
export function commitmentUrgency(c: Pick<Commitment, "status" | "due_date">,
                                  today = new Date()): CommitmentUrgency {
  if (c.status !== "open") return "closed";
  const d = daysUntil(c.due_date, today);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 3) return "soon";
  return "later";
}

/** Open first by soonest date, then closed by most recently closed. */
export function sortCommitments(rows: Commitment[]): Commitment[] {
  return [...rows].sort((a, b) => {
    const ao = a.status === "open" ? 0 : 1;
    const bo = b.status === "open" ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (ao === 0) return a.due_date.localeCompare(b.due_date);
    return (b.closed_at ?? "").localeCompare(a.closed_at ?? "");
  });
}

/**
 * What a person needs to see at a glance: how many promises are ours, how many
 * are theirs, and how many of each are late. Direction is kept separate all the
 * way through — a promise we broke and a client who has gone quiet are
 * different problems and collapsing them is why neither gets chased.
 */
export function summariseCommitments(rows: Commitment[], today = new Date()) {
  const open = rows.filter((r) => r.status === "open");
  const late = open.filter((r) => commitmentUrgency(r, today) === "overdue");
  return {
    open: open.length,
    weOwe: open.filter((r) => r.direction === "we_owe_client").length,
    theyOwe: open.filter((r) => r.direction === "client_owes_us").length,
    overdue: late.length,
    weOweOverdue: late.filter((r) => r.direction === "we_owe_client").length,
    theyOweOverdue: late.filter((r) => r.direction === "client_owes_us").length,
    met: rows.filter((r) => r.status === "met").length,
    missed: rows.filter((r) => r.status === "missed").length,
  };
}
