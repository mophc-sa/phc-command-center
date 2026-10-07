import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Mic, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/phc/PageHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, localeFor } from "@/lib/i18n";
import { listMeetings, syncMeetings } from "@/lib/meetings-actions";
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
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

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
          reviewer ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void fetchFromFireflies()} disabled={syncing}>
              <RefreshCw className={`me-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
              {t("meetings_sync")}
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <SkeletonTable />
      ) : isError ? (
        <EmptyState variant="error" title={lang === "ar" ? "تعذر تحميل الاجتماعات" : "Could not load meetings"} primaryAction={{ label: lang === "ar" ? "إعادة المحاولة" : "Try again", onClick: () => void refetch() }} />
      ) : !data?.length ? (
        <EmptyState icon={Mic} title={t("meetings_empty")} description={t(reviewer ? "meetings_empty_hint" : "meetings_empty_hint_attendee")} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {data.map((m) => {
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
