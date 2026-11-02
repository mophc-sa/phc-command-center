import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Mic, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/phc/PageHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { KpiRow } from "@/components/phc/KpiRow";
import { KpiCard } from "@/components/phc/KpiCard";
import { useI18n, localeFor, formatNumber } from "@/lib/i18n";
import { getFirefliesConnection, listMeetings, syncMeetings } from "@/lib/meetings-actions";
import { formatDecisionTime, meetingMetrics } from "@/lib/meetings-metrics";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canReviewMeetings } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/meetings/")({
  head: () => ({ meta: [{ title: "Meetings — PHC" }, { name: "robots", content: "noindex" }] }),
  component: MeetingsPage,
});

function MeetingsPage() {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  // Reviewers see every meeting; everyone else, the meetings they attended (can_read_meeting).
  const reviewer = canReviewMeetings(roles);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["meetings"], queryFn: listMeetings });
  // Someone who connected their own Fireflies account can fetch from it too.
  const ff = useQuery({ queryKey: ["fireflies-connection"], queryFn: getFirefliesConnection });
  const connected = Boolean(ff.data);
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const metrics = useMemo(() => meetingMetrics(data ?? []), [data]);
  const shown = (data ?? []).filter((m) => !onlyPending || m.meeting_action_items.some((i) => i.status === "pending"));

  async function fetchFromFireflies() {
    setSyncing(true);
    try {
      const r = await syncMeetings();
      toast.success(r.added > 0 ? `${r.added} ${t("meetings_sync_added")}` : t("meetings_sync_none"));
      await qc.invalidateQueries({ queryKey: ["meetings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("meetings_eyebrow")}
        title={t("meetings_title")}
        description={t(reviewer ? "meetings_desc" : "meetings_desc_attendee")}
        actions={
          reviewer || connected ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void fetchFromFireflies()} disabled={syncing}>
              <RefreshCw className={`me-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
              {t("meetings_sync")}
            </Button>
          ) : undefined
        }
      />

      {data?.length ? (
        <KpiRow className="mb-0">
          <KpiCard label={t("meetings_metric_week")} value={formatNumber(metrics.meetingsThisWeek, lang)} />
          <KpiCard
            label={t("meetings_metric_approved")}
            value={metrics.approvedPct == null ? "—" : formatNumber(metrics.approvedPct / 100, lang, { style: "percent" })}
            hint={t("meetings_metric_approved_hint")}
          />
          <KpiCard label={t("meetings_metric_decide")} value={formatDecisionTime(metrics.avgDecisionHours, lang)} hint={t("meetings_metric_decide_hint")} />
          <KpiCard
            label={t("meetings_metric_over7")}
            value={formatNumber(metrics.pendingOver7Days, lang)}
            hint={t("meetings_metric_over7_hint")}
            trend={metrics.pendingOver7Days > 0 ? "down" : "flat"}
          />
        </KpiRow>
      ) : null}

      {data?.length ? (
        <div className="flex gap-2" role="group" aria-label={t("meetings_title")}>
          {[false, true].map((pendingOnly) => (
            <Button
              key={String(pendingOnly)}
              type="button"
              size="sm"
              variant={onlyPending === pendingOnly ? "default" : "outline"}
              aria-pressed={onlyPending === pendingOnly}
              onClick={() => setOnlyPending(pendingOnly)}
            >
              {t(pendingOnly ? "meetings_status_pending_review" : "meetings_filter_all")}
            </Button>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <SkeletonTable />
      ) : isError ? (
        <EmptyState variant="error" title={lang === "ar" ? "تعذر تحميل الاجتماعات" : "Could not load meetings"} primaryAction={{ label: lang === "ar" ? "إعادة المحاولة" : "Try again", onClick: () => void refetch() }} />
      ) : !data?.length ? (
        <EmptyState icon={Mic} title={t("meetings_empty")} description={t(reviewer ? "meetings_empty_hint" : "meetings_empty_hint_attendee")} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {shown.map((m) => {
            const pending = m.meeting_action_items.filter((i) => i.status === "pending").length;
            return (
              <li key={m.id}>
                <Link
                  to="/meetings/$id"
                  params={{ id: m.id }}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{m.title}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {m.occurred_at ? new Date(m.occurred_at).toLocaleString(localeFor(lang), { dateStyle: "medium", timeStyle: "short" }) : "—"}
                    {m.duration_minutes != null ? ` · ${Math.round(m.duration_minutes)} min` : ""}
                  </span>
                  {pending > 0 ? (
                    <StatusPill tone="attention">{pending} {t("meetings_pending_items")}</StatusPill>
                  ) : (
                    <StatusPill tone="positive">{t("meetings_status_reviewed")}</StatusPill>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
