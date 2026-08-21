// =============================================================================
// PHC Sales OS — Opportunity / Project timeline (Phase 5).
//
// A READ PROJECTION, NOT A NEW EVENT STORE
// ----------------------------------------
// The history already exists, scattered across the tables that own each part of
// the workflow:
//
//   stage_transition_history  stage moves, with from/to, actor, evidence
//   inbox_items               the Phase 2 intake gate (review_state, resubmits)
//   approvals                 requests and decisions
//   bafo_requests             the four-step discount chain
//   follow_ups                contact cadence
//   opportunity_flags         the automation queue
//   notifications             Phase 4 events
//   opportunities             award/contract dates written by applySalesStage
//
// Building an event store would mean writing every one of those a second time
// and keeping the copy honest forever — a duplicate audit trail that can drift
// from the records it claims to describe. So this module projects what is
// already recorded into one ordered list.
//
// The cost of that choice is honest: the timeline can only show what the source
// tables actually captured. Where a source records a date but not an actor,
// the actor is null rather than guessed. Nothing here invents an event.
//
// Pure. See opportunity-timeline.test.ts.
// =============================================================================

export type TimelineCategory = "sales" | "approvals" | "communication" | "commercial" | "documents";

export type TimelineEvent = {
  id: string;
  at: string;
  category: TimelineCategory;
  type: string;
  title: string;
  detail: string | null;
  actorId: string | null;
  from: string | null;
  to: string | null;
  /** Which table this came from — shown so a reader can go verify it. */
  source: string;
  evidence: string | null;
  href: string | null;
};

// ---- Source row shapes ------------------------------------------------------

export type StageTransitionRow = {
  id: string;
  record_type: string;
  record_id: string;
  from_stage: string | null;
  to_stage: string | null;
  actor_id: string | null;
  notes: string | null;
  evidence: string | null;
  approval_id: string | null;
  created_at: string;
};

export type IntakeRow = {
  id: string;
  project_name: string | null;
  company_name: string | null;
  review_state: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  reject_reason: string | null;
  info_comment: string | null;
  info_requested_at: string | null;
  resubmitted_at: string | null;
  resubmit_count: number | null;
  converted_record_type: string | null;
  converted_record_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type ApprovalRow = {
  id: string;
  approval_type: string | null;
  status: string | null;
  requested_by: string | null;
  assigned_approver: string | null;
  decision_notes: string | null;
  created_at: string;
  decided_at: string | null;
};

export type FollowUpRow = {
  id: string;
  owner_id: string | null;
  channel: string | null;
  notes: string | null;
  status: string | null;
  due_date: string | null;
  last_contact_at: string | null;
  created_at: string;
};

export type OpportunityFactsRow = {
  id: string;
  project_name: string | null;
  created_at: string;
  verbal_award_date: string | null;
  contract_received_date: string | null;
  contract_signed_date: string | null;
  commercial_handoff_status: string | null;
  commercial_handoff_at: string | null;
  commercial_handoff_by: string | null;
  source_tender_id: string | null;
  loss_reason: string | null;
  lost_to_competitor: string | null;
};

export type TimelineSources = {
  transitions?: StageTransitionRow[];
  intake?: IntakeRow[];
  approvals?: ApprovalRow[];
  followUps?: FollowUpRow[];
  opportunity?: OpportunityFactsRow | null;
  documents?: DocumentTimelineRow[];
};

// ---- Projection -------------------------------------------------------------

const humanStage = (s: string | null) => (s ? s.replace(/_/g, " ") : "—");

function stageEvents(rows: StageTransitionRow[]): TimelineEvent[] {
  return rows.map((r) => ({
    id: `transition:${r.id}`,
    at: r.created_at,
    category: "sales" as const,
    // A conversion is a different story from an ordinary stage move.
    type: r.record_type === "tender" ? "tender_stage_changed" : "stage_changed",
    title:
      r.to_stage === "won"
        ? "Won"
        : r.to_stage === "lost"
          ? "Lost"
          : r.to_stage === "on_hold"
            ? "Put on hold"
            : `Stage → ${humanStage(r.to_stage)}`,
    detail: r.notes,
    actorId: r.actor_id,
    from: r.from_stage,
    to: r.to_stage,
    source: "stage_transition_history",
    evidence: r.evidence,
    href: null,
  }));
}

function intakeEvents(rows: IntakeRow[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const i of rows) {
    const label = i.project_name ?? i.company_name ?? "Request";

    out.push({
      id: `intake_created:${i.id}`,
      at: i.created_at,
      category: "sales",
      type: "intake_created",
      title: "Intake created",
      detail: label,
      actorId: i.created_by,
      from: null,
      to: "pending_review",
      source: "inbox_items",
      evidence: null,
      href: "/lead-tender-inbox",
    });

    // Information requested has its own timestamp, so it can be placed exactly.
    if (i.info_requested_at) {
      out.push({
        id: `intake_info:${i.id}`,
        at: i.info_requested_at,
        category: "sales",
        type: "intake_need_information",
        title: "Information requested",
        detail: i.info_comment,
        actorId: i.reviewed_by,
        from: "pending_review",
        to: "need_information",
        source: "inbox_items.info_requested_at",
        evidence: null,
        href: "/lead-tender-inbox",
      });
    }

    if (i.resubmitted_at) {
      out.push({
        id: `intake_resubmitted:${i.id}`,
        at: i.resubmitted_at,
        category: "sales",
        type: "intake_resubmitted",
        title: `Resubmitted${i.resubmit_count ? ` (attempt ${i.resubmit_count})` : ""}`,
        detail: null,
        actorId: null,   // inbox_items records no resubmitter
        from: "need_information",
        to: "pending_review",
        source: "inbox_items.resubmitted_at",
        evidence: null,
        href: "/lead-tender-inbox",
      });
    }

    // One reviewed_at serves every terminal decision, so the title comes from
    // the state it landed in.
    if (i.reviewed_at && i.review_state && i.review_state !== "pending_review") {
      const decided: Record<string, string> = {
        approved_for_pricing: "Approved for pricing",
        rejected: "Request rejected",
        monitored: "Moved to monitoring",
        need_information: "Information requested",
      };
      if (i.review_state !== "need_information") {
        out.push({
          id: `intake_reviewed:${i.id}`,
          at: i.reviewed_at,
          category: "approvals",
          type: `intake_${i.review_state}`,
          title: decided[i.review_state] ?? `Review: ${humanStage(i.review_state)}`,
          detail: i.reject_reason ?? i.review_notes,
          actorId: i.reviewed_by,
          from: "pending_review",
          to: i.review_state,
          source: "inbox_items.review_state",
          evidence: null,
          href: "/lead-tender-inbox",
        });
      }
    }

    if (i.converted_record_type && i.converted_record_id) {
      out.push({
        id: `intake_converted:${i.id}`,
        at: i.reviewed_at ?? i.created_at,
        category: "sales",
        type: "intake_converted",
        title: `Converted to ${humanStage(i.converted_record_type)}`,
        detail: label,
        actorId: i.reviewed_by,
        from: "inbox_item",
        to: i.converted_record_type,
        source: "inbox_items.converted_record_type",
        evidence: null,
        href: null,
      });
    }
  }
  return out;
}

function approvalEvents(rows: ApprovalRow[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const a of rows) {
    out.push({
      id: `approval_requested:${a.id}`,
      at: a.created_at,
      category: "approvals",
      type: "approval_requested",
      title: `${humanStage(a.approval_type)} requested`,
      detail: null,
      actorId: a.requested_by,
      from: null,
      to: "pending",
      source: "approvals",
      evidence: null,
      href: "/approvals",
    });
    if (a.decided_at && a.status && a.status !== "pending") {
      out.push({
        id: `approval_decided:${a.id}`,
        at: a.decided_at,
        category: "approvals",
        type: `approval_${a.status}`,
        title: `${humanStage(a.approval_type)} ${a.status}`,
        detail: a.decision_notes,
        actorId: a.assigned_approver,
        from: "pending",
        to: a.status,
        source: "approvals",
        evidence: null,
        href: "/approvals",
      });
    }
  }
  return out;
}

function followUpEvents(rows: FollowUpRow[]): TimelineEvent[] {
  // Only completed follow-ups are history. A scheduled one is an action, which
  // belongs in the Action Center, not in a record of what happened.
  return rows
    .filter((f) => f.status === "completed" && f.last_contact_at)
    .map((f) => ({
      id: `followup:${f.id}`,
      at: f.last_contact_at!,
      category: "communication" as const,
      type: "follow_up_completed",
      title: f.channel ? `Follow-up completed (${f.channel})` : "Follow-up completed",
      detail: f.notes,
      actorId: f.owner_id,
      from: null,
      to: "completed",
      source: "follow_ups",
      evidence: null,
      href: null,
    }));
}

/**
 * Milestones that live as dates on the opportunity itself.
 *
 * These duplicate what stage_transition_history would hold if every move had
 * been recorded there — but the date columns are written by applySalesStage and
 * are reliable, while the history table is sparse for older records. Both are
 * emitted and `dedupeEvents` collapses the overlap, so a record with full
 * history shows one entry per milestone rather than two.
 */
function opportunityFactEvents(o: OpportunityFactsRow): TimelineEvent[] {
  const out: TimelineEvent[] = [];

  out.push({
    id: `opp_created:${o.id}`,
    at: o.created_at,
    category: "sales",
    type: "opportunity_created",
    title: "Opportunity created",
    detail: o.project_name,
    actorId: null,
    from: null,
    to: "rfq_received",
    source: "opportunities.created_at",
    evidence: null,
    href: null,
  });

  if (o.source_tender_id) {
    out.push({
      id: `opp_from_tender:${o.id}`,
      at: o.created_at,
      category: "sales",
      type: "tender_converted_to_jih",
      title: "Converted from tender",
      detail: null,
      actorId: null,
      from: "tender",
      to: "opportunity",
      source: "opportunities.source_tender_id",
      evidence: null,
      href: "/tenders",
    });
  }

  const milestone = (date: string | null, type: string, title: string, to: string) => {
    if (!date) return;
    out.push({
      id: `${type}:${o.id}`,
      at: date,
      category: "sales",
      type,
      title,
      detail: null,
      actorId: null,
      from: null,
      to,
      source: `opportunities.${type}_date`,
      evidence: null,
      href: null,
    });
  };
  milestone(o.verbal_award_date, "verbal_award", "Verbal award recorded", "verbally_awarded");
  milestone(o.contract_received_date, "contract_received", "Contract received", "contract_received");
  milestone(o.contract_signed_date, "contract_signed", "Contract signed", "contract_signed");

  if (o.commercial_handoff_at) {
    out.push({
      id: `handoff:${o.id}`,
      at: o.commercial_handoff_at,
      category: "commercial",
      type: "commercial_handoff_changed",
      title: `Commercial handoff → ${humanStage(o.commercial_handoff_status)}`,
      detail: null,
      actorId: o.commercial_handoff_by,
      from: null,
      to: o.commercial_handoff_status,
      source: "opportunities.commercial_handoff_at",
      evidence: null,
      href: null,
    });
  }

  return out;
}

/**
 * Documents attached to this record (Phase 6).
 *
 * A projection like every other source here — the registry already records who
 * uploaded what and when, so there is nothing to write a second time. The
 * document lifecycle produces up to four moments from two rows:
 *
 *   uploaded    documents.uploaded_at
 *   linked      document_links.linked_at, only when it differs from the upload
 *   superseded  documents.superseded_at
 *   deleted     documents.deleted_at
 *
 * A photo is not a fifth kind of thing; it is an upload whose document is an
 * image, and it says so in the title so the timeline reads naturally.
 */
export type DocumentTimelineRow = {
  id: string;
  original_filename: string;
  title: string | null;
  doc_type: string;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  superseded_by: string | null;
  superseded_at: string | null;
  deleted_by: string | null;
  deleted_at: string | null;
  /** From the link row for THIS entity. */
  link_entity_type: string;
  link_entity_id: string;
  linked_by: string | null;
  linked_at: string;
};

const IMAGE_MIME = /^image\//;

function documentEvents(rows: DocumentTimelineRow[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];

  for (const d of rows) {
    const name = d.title ?? d.original_filename;
    const photo = d.doc_type === "photo" || (!!d.mime_type && IMAGE_MIME.test(d.mime_type));
    // Deep link to the record the file hangs off, which is where the Files
    // panel that can actually open it lives. The timeline never links to a
    // signed URL — those are minted on click, by design (D25).
    const href =
      d.link_entity_type === "opportunity" ? `/opportunities/${d.link_entity_id}`
      : d.link_entity_type === "project"   ? `/projects/${d.link_entity_id}`
      : null;

    out.push({
      id: `document:uploaded:${d.id}`,
      at: d.uploaded_at,
      category: "documents",
      type: photo ? "photo_added" : "document_uploaded",
      title: photo ? `Photo added — ${name}` : `Document uploaded — ${name}`,
      detail: d.doc_type !== "other" ? d.doc_type.replace(/_/g, " ") : null,
      actorId: d.uploaded_by,
      from: null,
      to: null,
      source: "documents",
      evidence: null,
      href,
    });

    // Attaching an existing file to a second record is its own event. Suppressed
    // when it is the same moment as the upload, which is the common case and
    // would otherwise double every row.
    if (Math.abs(new Date(d.linked_at).getTime() - new Date(d.uploaded_at).getTime()) > 1000) {
      out.push({
        id: `document:linked:${d.id}:${d.link_entity_id}`,
        at: d.linked_at,
        category: "documents",
        type: "document_linked",
        title: `Document linked — ${name}`,
        detail: null,
        actorId: d.linked_by,
        from: null,
        to: null,
        source: "document_links",
        evidence: null,
        href,
      });
    }

    if (d.superseded_at) {
      out.push({
        id: `document:superseded:${d.id}`,
        at: d.superseded_at,
        category: "documents",
        type: "document_superseded",
        title: `Document replaced — ${name}`,
        detail: null,
        // The registry records when a version was replaced but not by whom;
        // null rather than a guess, the same rule the rest of this file follows.
        actorId: null,
        from: null,
        to: null,
        source: "documents",
        evidence: null,
        href,
      });
    }

    if (d.deleted_at) {
      out.push({
        id: `document:deleted:${d.id}`,
        at: d.deleted_at,
        category: "documents",
        type: "document_deleted",
        title: `Document removed — ${name}`,
        detail: null,
        actorId: d.deleted_by,
        from: null,
        to: null,
        source: "documents",
        evidence: null,
        href,
      });
    }
  }

  return out;
}

// ---- Assembly ---------------------------------------------------------------

/**
 * Collapses the overlap between stage_transition_history and the milestone date
 * columns, which describe the same real-world moment from two tables.
 *
 * Same day + same destination state = the same event. The transition-history
 * version wins because it carries the actor and any evidence; the date column
 * carries neither.
 */
export function dedupeEvents(events: TimelineEvent[]): TimelineEvent[] {
  const preferred = new Map<string, TimelineEvent>();
  for (const e of events) {
    if (!e.to) continue;
    const key = `${e.at.slice(0, 10)}|${e.to}`;
    const existing = preferred.get(key);
    if (!existing) {
      preferred.set(key, e);
      continue;
    }
    // Richer record wins: an actor, then evidence.
    const better =
      (e.actorId !== null && existing.actorId === null) ||
      (e.evidence !== null && existing.evidence === null);
    if (better) preferred.set(key, e);
  }
  const kept = new Set([...preferred.values()].map((e) => e.id));
  return events.filter((e) => !e.to || kept.has(e.id));
}

export type TimelineFilter = "all" | TimelineCategory;

export function buildTimeline(
  sources: TimelineSources,
  opts: { filter?: TimelineFilter; dedupe?: boolean } = {},
): TimelineEvent[] {
  const all: TimelineEvent[] = [
    ...stageEvents(sources.transitions ?? []),
    ...intakeEvents(sources.intake ?? []),
    ...approvalEvents(sources.approvals ?? []),
    ...followUpEvents(sources.followUps ?? []),
    ...(sources.opportunity ? opportunityFactEvents(sources.opportunity) : []),
    ...documentEvents(sources.documents ?? []),
  ];

  const deduped = opts.dedupe === false ? all : dedupeEvents(all);
  const filtered =
    !opts.filter || opts.filter === "all" ? deduped : deduped.filter((e) => e.category === opts.filter);

  // Latest first. Ties break on id so the order is stable across renders.
  return filtered.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
}

// ---- Grouping (PRD §9 — Today / Yesterday / Earlier) ------------------------

export type TimelineGroup = { key: "today" | "yesterday" | "earlier"; label: string; events: TimelineEvent[] };

export function groupByRecency(events: TimelineEvent[], today: string): TimelineGroup[] {
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);

  const groups: TimelineGroup[] = [
    { key: "today", label: "Today", events: [] },
    { key: "yesterday", label: "Yesterday", events: [] },
    { key: "earlier", label: "Earlier", events: [] },
  ];
  for (const e of events) {
    const d = e.at.slice(0, 10);
    if (d === today) groups[0].events.push(e);
    else if (d === yesterday) groups[1].events.push(e);
    else groups[2].events.push(e);
  }
  return groups.filter((g) => g.events.length > 0);
}
