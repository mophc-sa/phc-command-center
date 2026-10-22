// =============================================================================
// "Meeting tasks to review" — one line in the Work Queue and in My Day.
//
// The count is meeting_review_queue(): pending action items the reader may
// decide (their own, the unassigned ones of meetings they organised, or all of
// them for a manager). Nothing waiting, nothing shown. The link opens the
// oldest meeting first, because that is the one closest to being dismissed.
// =============================================================================

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { meetingReviewQueue } from "@/lib/meetings-actions";

export function MeetingReviewCallout({ className = "" }: { className?: string }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["meeting-review-queue", user?.id],
    queryFn: meetingReviewQueue,
    enabled: Boolean(user),
    refetchInterval: 120_000,
  });
  const queue = q.data;
  if (!queue || queue.pending === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 ${className}`} role="status">
      <Mic className="h-4 w-4 text-amber-light" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-sm text-foreground">
        {t("meetings_queue_title")}: <span className="font-semibold tabular-nums">{formatNumber(queue.pending, lang)}</span>
      </span>
      {queue.over_7_days > 0 ? (
        <StatusPill tone="danger">
          {formatNumber(queue.over_7_days, lang)} {t("meetings_queue_over7")}
        </StatusPill>
      ) : null}
      <Button asChild size="sm" variant="outline">
        {queue.oldest_meeting_id ? (
          <Link to="/meetings/$id" params={{ id: queue.oldest_meeting_id }}>{t("meetings_queue_open")}</Link>
        ) : (
          <Link to="/meetings">{t("meetings_queue_open")}</Link>
        )}
      </Button>
    </div>
  );
}
