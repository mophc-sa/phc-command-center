// =============================================================================
// Opportunity timeline (Phase 5 §31–§34).
//
// Renders the read projection from src/lib/opportunity-timeline.ts. It queries
// the source tables directly rather than a history table of its own, so what it
// shows is what actually happened — there is no second copy to fall out of step.
//
// Every row names the table it came from. That is not developer trivia: when a
// manager disputes an entry, the answer to "where does this come from?" has to
// be on the screen.
// =============================================================================

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n } from "@/lib/i18n";
import {
  buildTimeline,
  groupByRecency,
  type ApprovalRow,
  type FollowUpRow,
  type IntakeRow,
  type OpportunityFactsRow,
  type StageTransitionRow,
  type TimelineFilter,
  type DocumentTimelineRow,
} from "@/lib/opportunity-timeline";
import { humanize } from "@/lib/utils";

const FILTERS: Array<{ key: TimelineFilter; en: string; ar: string }> = [
  { key: "all", en: "All", ar: "الكل" },
  { key: "sales", en: "Sales", ar: "المبيعات" },
  { key: "approvals", en: "Approvals", ar: "الاعتمادات" },
  { key: "communication", en: "Communication", ar: "التواصل" },
  { key: "commercial", en: "Commercial", ar: "التجاري" },
  { key: "documents", en: "Documents", ar: "المستندات" },
];

export function OpportunityTimeline({ opportunityId }: { opportunityId: string }) {
  const { lang } = useI18n();
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const today = new Date().toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ["opp-timeline", opportunityId],
    staleTime: 30_000,
    enabled: !!opportunityId,
    queryFn: async () => {
      const [opp, transitions, approvals, followUps, intake, profiles, docLinks] = await Promise.all([
        supabase
          .from("opportunities")
          .select(
            "id, project_name, created_at, verbal_award_date, contract_received_date, contract_signed_date, commercial_handoff_status, commercial_handoff_at, commercial_handoff_by, source_tender_id, loss_reason, lost_to_competitor",
          )
          .eq("id", opportunityId)
          .maybeSingle(),
        supabase
          .from("stage_transition_history")
          .select("*")
          .eq("record_id", opportunityId)
          .order("created_at", { ascending: false }),
        supabase
          .from("approvals")
          .select("id, approval_type, status, requested_by, assigned_approver, decision_notes, created_at, decided_at")
          .eq("related_opportunity_id", opportunityId),
        supabase
          .from("follow_ups")
          .select("id, owner_id, channel, notes, status, due_date, last_contact_at, created_at")
          .eq("opportunity_id", opportunityId),
        // The intake that became this opportunity, if there was one — this is
        // what makes the lineage visible from request through to award.
        supabase
          .from("inbox_items")
          .select(
            "id, project_name, company_name, review_state, reviewed_by, reviewed_at, review_notes, reject_reason, info_comment, info_requested_at, resubmitted_at, resubmit_count, converted_record_type, converted_record_id, created_by, created_at",
          )
          .eq("converted_record_id", opportunityId),
        supabase.from("profiles").select("id, full_name, email"),
        // Phase 6. Joined server-side and flattened below, so the document
        // history costs one more query in a batch that already runs six —
        // not one per file.
        supabase
          .from("document_links")
          .select("entity_type, entity_id, linked_by, linked_at, documents!inner(id, original_filename, title, doc_type, mime_type, uploaded_by, uploaded_at, superseded_by, superseded_at, deleted_by, deleted_at)")
          .eq("entity_type", "opportunity")
          .eq("entity_id", opportunityId)
          .is("unlinked_at", null),
      ]);

      return {
        opportunity: (opp.data ?? null) as unknown as OpportunityFactsRow | null,
        transitions: (transitions.data ?? []) as unknown as StageTransitionRow[],
        approvals: (approvals.data ?? []) as unknown as ApprovalRow[],
        followUps: (followUps.data ?? []) as unknown as FollowUpRow[],
        intake: (intake.data ?? []) as unknown as IntakeRow[],
        names: new Map((profiles.data ?? []).map((p) => [p.id, p.full_name || p.email || p.id.slice(0, 8)])),
        documents: ((docLinks.data ?? []) as unknown as Array<{
          entity_type: string; entity_id: string; linked_by: string | null; linked_at: string;
          documents: Omit<DocumentTimelineRow, "link_entity_type" | "link_entity_id" | "linked_by" | "linked_at">;
        }>).map((l) => ({
          ...l.documents,
          link_entity_type: l.entity_type,
          link_entity_id: l.entity_id,
          linked_by: l.linked_by,
          linked_at: l.linked_at,
        })) as DocumentTimelineRow[],
      };
    },
  });

  const events = useMemo(
    () =>
      buildTimeline(
        {
          transitions: data?.transitions,
          approvals: data?.approvals,
          followUps: data?.followUps,
          intake: data?.intake,
          opportunity: data?.opportunity ?? null,
          documents: data?.documents,
        },
        { filter },
      ),
    [data, filter],
  );

  const groups = useMemo(() => groupByRecency(events, today), [events, today]);
  const nameOf = (id: string | null) =>
    id ? (data?.names.get(id) ?? id.slice(0, 8)) : lang === "ar" ? "النظام" : "System";

  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {lang === "ar" ? "السجل الزمني" : "Timeline"}
        </h2>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                filter === f.key
                  ? "border-amber/40 bg-amber/10 text-amber-light"
                  : "border-border/70 bg-background/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {lang === "ar" ? f.ar : f.en}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-px px-5 py-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-surface-2/60" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          message={lang === "ar" ? "لا أحداث مسجلة بعد لهذا الفلتر." : "No recorded events for this filter."}
          compact
        />
      ) : (
        <div className="divide-y divide-border/40">
          {groups.map((g) => (
            <div key={g.key} className="px-5 py-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {g.key === "today"
                  ? lang === "ar" ? "اليوم" : "Today"
                  : g.key === "yesterday"
                    ? lang === "ar" ? "أمس" : "Yesterday"
                    : lang === "ar" ? "سابقاً" : "Earlier"}
              </div>
              <ol className="space-y-2.5">
                {g.events.map((e) => (
                  <li key={e.id} className="border-s-2 border-border/60 ps-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-medium text-foreground">{e.title}</span>
                      <StatusPill tone="muted">{e.category}</StatusPill>
                      {/* previous → new, the thing an audit reader actually needs */}
                      {e.from && e.to ? (
                        <span className="num text-[10px] text-muted-foreground" data-tabular="true">
                          {humanize(e.from)} → {humanize(e.to)}
                        </span>
                      ) : null}
                    </div>
                    {e.detail ? (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{e.detail}</div>
                    ) : null}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground/70">
                      <span className="num" data-tabular="true">{e.at.slice(0, 16).replace("T", " ")}</span>
                      <span aria-hidden="true">·</span>
                      <span>{nameOf(e.actorId)}</span>
                      <span aria-hidden="true">·</span>
                      {/* Named so a disputed entry can be traced to its table. */}
                      <span className="font-mono">{e.source}</span>
                      {e.evidence ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-light">{lang === "ar" ? "إثبات" : "evidence"}: {e.evidence}</span>
                        </>
                      ) : null}
                      {e.href ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <Link to={e.href as never} className="text-amber-light hover:underline">
                            {lang === "ar" ? "فتح" : "Open"}
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
