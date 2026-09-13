// =============================================================================
// Notifications — reads the `notifications` table (Phase 4).
//
// Before Phase 4 this hook derived a list at read time from opportunity_flags +
// approvals. That could show standing conditions but could not represent
// events: no read/unread, no history once a condition cleared, and the same
// rows reappeared every session. Those standing conditions are now the Action
// Center's job (src/lib/action-center.ts); this hook is events only.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationsRead,
  unreadCount,
  type NotificationRow,
} from "@/lib/notifications";

export type { NotificationRow } from "@/lib/notifications";

const KEY = "notifications";

export function useNotifications(limit = 50) {
  const { user } = useAuth();
  const uid = user?.id ?? "";

  return useQuery({
    queryKey: [KEY, uid],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<NotificationRow[]> => {
      // RLS already restricts this to the caller; the filter is not the
      // security boundary, it just keeps the query planner honest.
      const { data, error } = await supabase
        .from("notifications")
        .select(
          "id, notification_type, entity_type, entity_id, title, body, severity, source_event, metadata, created_at, read_at, dismissed_at",
        )
        .is("dismissed_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const notifications = (data ?? []) as unknown as NotificationRow[];
      const oppIds = [...new Set(notifications.filter(n => n.entity_type === "opportunity" && n.entity_id).map(n => n.entity_id!))];
      const intakeIds = [...new Set(notifications.filter(n => n.entity_type === "inbox_item" && n.entity_id).map(n => n.entity_id!))];
      const [opps, intake] = await Promise.all([
        oppIds.length ? supabase.from("opportunities").select("id, project_name").in("id", oppIds) : Promise.resolve({ data: [] }),
        intakeIds.length ? supabase.from("inbox_items").select("id, project_name").in("id", intakeIds) : Promise.resolve({ data: [] }),
      ]);
      const subjects = new Map([...(opps.data ?? []), ...(intake.data ?? [])].map(r => [r.id, r.project_name]));
      return notifications.map(n => ({ ...n, subject: n.entity_id ? subjects.get(n.entity_id) ?? null : null }));
    },
  });
}

export function useUnreadNotificationCount(): number {
  const { data = [] } = useNotifications();
  return unreadCount(data);
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: [KEY] });

  const markRead = useMutation({
    mutationFn: (ids: string[]) => markNotificationsRead(ids),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: invalidate,
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => dismissNotification(id),
    onSuccess: invalidate,
  });

  return { markRead, markAllRead, dismiss };
}
