import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { Button } from "@/components/ui/button";
import { useI18n, localeFor } from "@/lib/i18n";
import { isAssignableTeamMember } from "@/lib/team-members";
import { listTeamMembers } from "@/lib/opportunity-actions";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canReviewMeetings } from "@/lib/roles";
import {
  decideMeetingAction,
  firefliesLink,
  formatStamp,
  getMeeting,
  searchOpportunities,
  type MeetingItem,
} from "@/lib/meetings-actions";

export const Route = createFileRoute("/_authenticated/meetings/$id")({
  head: () => ({ meta: [{ title: "Meeting — PHC" }, { name: "robots", content: "noindex" }] }),
  component: MeetingPage,
});

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

type Member = { id: string; full_name: string | null; email: string | null; status?: string | null; is_display_account?: boolean | null };

function MeetingPage() {
  const { id } = Route.useParams();
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  // Attendees read the meeting; only reviewers approve or dismiss its items.
  const reviewer = canReviewMeetings(roles);
  const q = useQuery({ queryKey: ["meeting", id], queryFn: () => getMeeting(id) });
  const teamQ = useQuery({ queryKey: ["team"], queryFn: listTeamMembers });
  const members = ((teamQ.data ?? []) as Member[]).filter(isAssignableTeamMember);

  if (q.isLoading) return <SkeletonTable />;
  if (q.isError || !q.data) {
    return (
      <EmptyState
        variant="error"
        title={lang === "ar" ? "تعذر تحميل الاجتماع" : "Could not load the meeting"}
        primaryAction={{ label: lang === "ar" ? "إعادة المحاولة" : "Try again", onClick: () => void q.refetch() }}
      />
    );
  }

  const { meeting, items } = q.data;
  const when = meeting.occurred_at
    ? new Date(meeting.occurred_at).toLocaleString(localeFor(lang), { dateStyle: "full", timeStyle: "short" })
    : "—";

  return (
    <div className="space-y-6">
      <Link to="/meetings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        {t("meetings_back")}
      </Link>

      <PageHeader
        eyebrow={t("meetings_eyebrow")}
        title={meeting.title}
        description={`${when}${meeting.duration_minutes != null ? ` · ${Math.round(meeting.duration_minutes)} min` : ""}`}
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={meeting.transcript_url ?? firefliesLink(meeting.provider_meeting_id)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {t("meetings_open_fireflies")}
            </a>
          </Button>
        }
      />

      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("meetings_summary")}</h2>
        <p dir="auto" className="whitespace-pre-line text-sm leading-relaxed text-foreground">
          {meeting.summary_short || meeting.summary_overview || "—"}
        </p>
        {meeting.keywords.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {meeting.keywords.map((k) => (
              <StatusPill key={k} tone="muted">{k}</StatusPill>
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("meetings_action_items")}</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("meetings_no_items")}</p>
        ) : (
          items.map((it) => (
            <ItemCard key={it.id} item={it} meetingId={id} providerMeetingId={meeting.provider_meeting_id} members={members} reviewer={reviewer} />
          ))
        )}
      </section>
    </div>
  );
}

function ItemCard({
  item,
  meetingId,
  providerMeetingId,
  members,
  reviewer,
}: {
  item: MeetingItem;
  meetingId: string;
  providerMeetingId: string;
  members: Member[];
  reviewer: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [title, setTitle] = useState(item.title);
  const [ownerId, setOwnerId] = useState(item.owner_id ?? "");
  const [dueDate, setDueDate] = useState(item.due_date ?? "");
  const [opp, setOpp] = useState<{ id: string; project_name: string | null } | null>(item.opportunities);
  const [oppQuery, setOppQuery] = useState("");
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const oppQ = useQuery({
    queryKey: ["meeting-opp-search", oppQuery],
    queryFn: () => searchOpportunities(oppQuery),
    enabled: oppQuery.trim().length >= 2,
  });

  const decided = item.status !== "pending";
  const ownerName = (uid: string | null) => {
    const m = members.find((x) => x.id === uid);
    return m ? m.full_name || m.email : null;
  };

  async function decide(action: "approve" | "dismiss") {
    if (action === "approve" && !ownerId) {
      toast.error(t("meetings_owner_required"));
      return;
    }
    setBusy(true);
    try {
      await decideMeetingAction(
        action === "approve"
          ? { itemId: item.id, action, title, ownerId, dueDate: dueDate || null, opportunityId: opp?.id ?? null }
          : { itemId: item.id, action, note: reason },
      );
      toast.success(action === "approve" ? t("meetings_item_approved") : t("meetings_item_dismissed"));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["meeting", meetingId] }),
        qc.invalidateQueries({ queryKey: ["meetings"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const stamp =
    item.at_seconds != null ? (
      <a
        href={firefliesLink(providerMeetingId, item.at_seconds)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
        dir="ltr"
      >
        {formatStamp(item.at_seconds)}
      </a>
    ) : null;

  if (decided) {
    return (
      <article className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <StatusPill tone={item.status === "approved" ? "positive" : "muted"}>
          {item.status === "approved" ? t("meetings_item_approved") : t("meetings_item_dismissed")}
        </StatusPill>
        <span dir="auto" className="min-w-0 flex-1 text-sm text-foreground">{item.title}</span>
        {item.status === "approved" && item.owner_id ? (
          <span className="text-xs text-muted-foreground">{ownerName(item.owner_id)}</span>
        ) : item.decision_note ? (
          <span dir="auto" className="text-xs text-muted-foreground">{item.decision_note}</span>
        ) : null}
        {stamp}
      </article>
    );
  }

  if (!reviewer) {
    return (
      <article className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-4 py-3">
        <StatusPill tone="attention">{t("meetings_status_pending_review")}</StatusPill>
        <span dir="auto" className="min-w-0 flex-1 text-sm text-foreground">{item.title}</span>
        {item.speaker_label ? (
          <span className="text-xs text-muted-foreground">
            {t("meetings_said_by")}: <span dir="auto">{item.speaker_label}</span>
          </span>
        ) : null}
        {stamp}
      </article>
    );
  }

  const unmatched = !item.owner_id;

  return (
    <article className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {t("meetings_said_by")}: <span dir="auto" className="font-medium text-foreground">{item.speaker_label ?? "—"}</span>
        </span>
        {stamp}
        {unmatched ? <StatusPill tone="attention">{t("meetings_unmatched")}</StatusPill> : null}
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("meetings_task_title")}</span>
        <input dir="auto" className={FIELD} value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      </label>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("meetings_owner")}</span>
          <select className={FIELD} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={busy}>
            <option value="">{t("meetings_owner_pick")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("meetings_due")}</span>
          <input type="date" className={FIELD} value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
        </label>

        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("meetings_opportunity")}</span>
          {opp ? (
            <div className="flex items-center gap-2">
              <span dir="auto" className="min-w-0 flex-1 truncate text-sm">{opp.project_name ?? opp.id}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpp(null)} disabled={busy}>
                ×<span className="sr-only">{t("meetings_opportunity_none")}</span>
              </Button>
            </div>
          ) : (
            <div className="relative">
              <input
                dir="auto"
                className={FIELD}
                placeholder={t("meetings_opportunity_search")}
                value={oppQuery}
                onChange={(e) => setOppQuery(e.target.value)}
                disabled={busy}
                aria-label={t("meetings_opportunity")}
              />
              {oppQ.data && oppQ.data.length > 0 ? (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
                  {oppQ.data.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        dir="auto"
                        className="w-full px-2.5 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        onClick={() => {
                          setOpp(o);
                          setOppQuery("");
                        }}
                      >
                        {o.project_name ?? o.id}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {dismissing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            dir="auto"
            className={`${FIELD} min-w-0 flex-1`}
            placeholder={t("meetings_dismiss_reason")}
            aria-label={t("meetings_dismiss_reason")}
            value={reason}
            maxLength={2000}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <Button type="button" variant="destructive" size="sm" disabled={busy || !reason.trim()} onClick={() => decide("dismiss")}>
            {t("meetings_dismiss")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDismissing(false)}>
            ×
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDismissing(true)}>
            {t("meetings_dismiss")}
          </Button>
          <Button type="button" size="sm" disabled={busy || !title.trim()} onClick={() => decide("approve")}>
            {t("meetings_approve")}
          </Button>
        </div>
      )}
    </article>
  );
}
