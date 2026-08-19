// =============================================================================
// PHC Sales OS — Notification client actions (Phase 4).
//
// Reads go through the `notifications` table directly (RLS restricts every
// query to the caller's own rows). Writes go through the three RPCs, which are
// SECURITY INVOKER — so RLS still applies — but keep the "only read_at and
// dismissed_at may change" rule in one place instead of spread across call
// sites. Nothing here can create a notification: that is trigger-only, by
// design, so a client cannot forge one for another user.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";

export type NotificationSeverity = "info" | "attention" | "critical";

export type NotificationRow = {
  id: string;
  notification_type: string;
  entity_type: string;
  entity_id: string | null;
  title: string;
  body: string | null;
  severity: NotificationSeverity;
  source_event: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
};

export async function markNotificationsRead(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc("mark_notifications_read", { _ids: ids });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function markAllNotificationsRead(): Promise<number> {
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function dismissNotification(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("dismiss_notification", { _id: id });
  if (error) throw error;
  return (data as boolean) ?? false;
}

// ---- Presentation helpers (pure — see notifications.test.ts) ----------------

/**
 * Where a notification should navigate. Intake lives on inbox_items, so those
 * deep-link to the inbox rather than to an opportunity that may not exist yet.
 */
export function notificationHref(n: Pick<NotificationRow, "entity_type" | "entity_id">): string {
  if (!n.entity_id) return "/action-center";
  switch (n.entity_type) {
    case "opportunity":
      return `/opportunities/${n.entity_id}`;
    case "inbox_item":
      return "/lead-tender-inbox";
    case "approval":
      return "/approvals";
    case "tender":
      return "/tenders";
    case "rfq":
    case "quotation":
      return "/quotations";
    default:
      return "/action-center";
  }
}

export function isUnread(n: Pick<NotificationRow, "read_at" | "dismissed_at">): boolean {
  return n.read_at === null && n.dismissed_at === null;
}

export function unreadCount(rows: Array<Pick<NotificationRow, "read_at" | "dismissed_at">>): number {
  return rows.filter(isUnread).length;
}

/**
 * The bell badge caps at 9+ — past that the exact number tells the reader
 * nothing they act on differently.
 */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? "9+" : String(count);
}

const SEVERITY_TONE: Record<NotificationSeverity, "danger" | "attention" | "neutral"> = {
  critical: "danger",
  attention: "attention",
  info: "neutral",
};

export function severityTone(s: string): "danger" | "attention" | "neutral" {
  return SEVERITY_TONE[s as NotificationSeverity] ?? "neutral";
}

/** i18n key for a notification type; falls back to the raw type. */
export function notificationTypeKey(type: string): string {
  return `notif_type_${type}`;
}
