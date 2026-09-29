// Communication Hub Phase 1 — read side. Shows the logged history (calls,
// meetings, notes, email/WhatsApp drafts) for one linked record, in one
// place, regardless of which page or button originally created each entry.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, Users, CalendarDays, StickyNote, Mail, MailOpen, MessageCircle, Check } from "lucide-react";
import { useI18n, localeFor } from "@/lib/i18n";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { listActivities, markActivitySent, type ActivityTimelineFilter, type Activity } from "@/lib/activity-actions";
import { bindEmailToDeal } from "@/lib/mail-actions";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canManageSalesPipeline } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";

const TYPE_ICON: Record<string, typeof Phone> = {
  call: Phone,
  visit: Users,
  meeting: CalendarDays,
  note: StickyNote,
  email_draft: Mail,
  email_received: MailOpen,
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

  // On an account page, a captured email not yet on a deal can be linked to one
  // of the account's deals — by the mailbox owner or a pipeline operator. The
  // database decides; this only hides a control that would be refused.
  const { user, roles } = useAuth();
  const companyId = "companyId" in filter ? filter.companyId : null;
  const hasUnbound = activities.some((a) => a.email_conversation_id && !a.related_opportunity_id);
  const dealsQ = useQuery({
    queryKey: ["company-deals", companyId],
    enabled: Boolean(companyId && hasUnbound),
    queryFn: async () => {
      const { data, error } = await supabase.from("opportunities").select("id, project_name")
        .eq("company_id", companyId as string).order("updated_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
  const canLink = (a: Activity) =>
    Boolean(companyId && a.email_conversation_id && !a.related_opportunity_id &&
      (a.owner_id === user?.id || canManageSalesPipeline(roles)));

  async function handleLink(activityId: string, opportunityId: string) {
    if (!opportunityId) return;
    try {
      await bindEmailToDeal(activityId, opportunityId);
      qc.invalidateQueries({ queryKey });
      toast.success(t("email_linked_ok"));
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }

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
              <span className="num text-xs text-muted-foreground" data-tabular="true">
                {new Date(a.occurred_at).toLocaleString(localeFor(lang, "en"), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              {isDraftChannel && a.status === "draft" ? (
                <button
                  type="button"
                  onClick={() => handleMarkSent(a.id)}
                  className="ms-auto inline-flex items-center gap-1 rounded-md border border-won/40 bg-won/10 px-2 py-1 text-xs font-medium text-won hover:bg-won/[0.16] transition-colors duration-150"
                >
                  <Check className="h-3 w-3" /> {t("comm_mark_sent")}
                </button>
              ) : null}
            </div>
            {a.summary ? <div dir="auto" className="mt-1.5 text-sm text-foreground">{a.summary}</div> : null}
            {a.activity_type === "email_received" && a.email_from ? (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t("email_from_label")}: <span dir="ltr">{a.email_from}</span>
              </div>
            ) : null}
            {canLink(a) ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusPill tone="attention">{t("email_unlinked")}</StatusPill>
                <select
                  defaultValue=""
                  onChange={(e) => handleLink(a.id, e.target.value)}
                  aria-label={t("email_link_to_deal")}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{t("email_link_to_deal")}</option>
                  {(dealsQ.data ?? []).map((o) => (
                    <option key={o.id} value={o.id}>{o.project_name ?? o.id}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
