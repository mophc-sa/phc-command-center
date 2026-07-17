// Communication Hub Phase 1 — read side. Shows the logged history (calls,
// meetings, notes, email/WhatsApp drafts) for one linked record, in one
// place, regardless of which page or button originally created each entry.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, Users, CalendarDays, StickyNote, Mail, MessageCircle, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { listActivities, markActivitySent, type ActivityTimelineFilter, type Activity } from "@/lib/activity-actions";

const TYPE_ICON: Record<string, typeof Phone> = {
  call: Phone,
  visit: Users,
  meeting: CalendarDays,
  note: StickyNote,
  email_draft: Mail,
  whatsapp_draft: MessageCircle,
};

function statusTone(status: Activity["status"]): "neutral" | "attention" | "positive" | "muted" {
  if (status === "sent") return "positive";
  if (status === "draft") return "attention";
  return "muted";
}

function filterKey(filter: ActivityTimelineFilter): string {
  const [k, v] = Object.entries(filter)[0];
  return `${k}:${v}`;
}

export function CommunicationTimeline({ filter, limit }: { filter: ActivityTimelineFilter; limit?: number }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const queryKey = ["comm-timeline", filterKey(filter)];

  const { data: activities = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listActivities(filter, limit),
  });

  async function handleMarkSent(id: string) {
    try {
      await markActivitySent(id);
      qc.invalidateQueries({ queryKey });
      toast.success(t("comm_marked_sent"));
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }

  if (isLoading) return <EmptyState message={t("loading")} />;
  if (activities.length === 0) return <EmptyState message={t("comm_timeline_empty")} />;

  return (
    <ul className="space-y-2">
      {activities.map((a) => {
        const Icon = TYPE_ICON[a.activity_type] ?? StickyNote;
        const isDraftChannel = a.activity_type === "email_draft" || a.activity_type === "whatsapp_draft";
        return (
          <li key={a.id} className="rounded-lg border border-border/60 bg-surface/40 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <StatusPill tone="muted">{t(`activity_type_${a.activity_type}` as never)}</StatusPill>
              <StatusPill tone={statusTone(a.status)}>{t(`comm_status_${a.status}` as never)}</StatusPill>
              <span className="num text-[11px] text-muted-foreground" data-tabular="true">
                {new Date(a.occurred_at).toLocaleString(lang === "ar" ? "ar" : "en", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              {isDraftChannel && a.status === "draft" ? (
                <button
                  type="button"
                  onClick={() => handleMarkSent(a.id)}
                  className="ms-auto inline-flex items-center gap-1 rounded-md border border-won/40 bg-won/10 px-2 py-1 text-[11px] font-medium text-won hover:bg-won/[0.16] transition-colors duration-150"
                >
                  <Check className="h-3 w-3" /> {t("comm_mark_sent")}
                </button>
              ) : null}
            </div>
            {a.summary ? <div className="mt-1.5 text-[12px] text-foreground">{a.summary}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}
