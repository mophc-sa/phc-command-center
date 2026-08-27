import { AlertTriangle, BellOff, CheckCheck, ShieldCheck, X, Inbox, ArrowRightLeft } from "lucide-react";
import { useI18n, localeFor } from "@/lib/i18n";
import { useNavigate } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useNotifications, useNotificationActions } from "@/hooks/useNotifications";
import {
  isUnread,
  notificationHref,
  notificationTypeKey,
  severityTone,
  unreadCount,
  type NotificationRow,
} from "@/lib/notifications";

/** Icon per event family — the bell is scanned, not read. */
function iconFor(type: string) {
  if (type.startsWith("approval")) return ShieldCheck;
  if (type.startsWith("intake")) return Inbox;
  if (type === "stage_changed" || type === "handoff_changed") return ArrowRightLeft;
  return AlertTriangle;
}

export function NotificationCenter({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, dir, lang } = useI18n();
  const navigate = useNavigate();
  const { data: items = [], isLoading } = useNotifications();
  const { markRead, markAllRead, dismiss } = useNotificationActions();
  const unread = unreadCount(items);

  function handleRowClick(n: NotificationRow) {
    // Opening the subject is an acknowledgement — mark it read on the way out.
    if (isUnread(n)) markRead.mutate([n.id]);
    onOpenChange(false);
    void navigate({ to: notificationHref(n) as never });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={dir === "rtl" ? "left" : "right"}
        className="flex w-80 flex-col gap-0 p-0 sm:max-w-80"
      >
        <SheetHeader className="border-b border-border/70 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-sm font-semibold">{t("notif_title")}</SheetTitle>
              {unread > 0 && (
                <span className="num flex h-4 min-w-4 items-center justify-center rounded-full bg-amber/20 px-1 text-2xs font-semibold text-amber-light">
                  {unread}
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/60 px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <CheckCheck className="h-3 w-3" />
                {t("notif_mark_all_read")}
              </button>
            )}
          </div>
          <SheetDescription className="sr-only">{t("notif_empty_desc")}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-px px-5 py-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-md bg-surface-2/60" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-5 py-14 text-center">
              <BellOff className="h-9 w-9 text-muted-foreground/30" strokeWidth={1.5} aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">{t("notif_empty")}</p>
              <p className="max-w-[200px] text-xs text-muted-foreground">{t("notif_empty_desc")}</p>
            </div>
          ) : (
            <ul>
              {items.map((n) => (
                <NotifRow
                  key={n.id}
                  n={n}
                  lang={lang}
                  label={t(notificationTypeKey(n.notification_type) as never) || n.notification_type}
                  dismissLabel={t("notif_dismiss")}
                  onClick={() => handleRowClick(n)}
                  onDismiss={() => dismiss.mutate(n.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-border/70 px-5 py-3">
            <p className="text-center text-xs text-muted-foreground/60">
              {lang === "ar"
                ? `${unread} غير مقروء من ${items.length}`
                : `${unread} unread of ${items.length}`}
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function NotifRow({
  n,
  lang,
  label,
  dismissLabel,
  onClick,
  onDismiss,
}: {
  n: NotificationRow;
  lang: "en" | "ar";
  label: string;
  dismissLabel: string;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const Icon = iconFor(n.notification_type);
  const tone = severityTone(n.severity);
  const unread = isUnread(n);
  const iconColor =
    tone === "danger" ? "text-destructive" : tone === "attention" ? "text-amber-light" : "text-muted-foreground";
  const borderColor =
    tone === "danger" ? "border-s-destructive/60" : tone === "attention" ? "border-s-amber/50" : "border-s-border";
  const date = new Date(n.created_at).toLocaleDateString(localeFor(lang), {
    month: "short",
    day: "numeric",
  });

  return (
    <li className="group relative border-b border-border/40 last:border-0">
      <button
        onClick={onClick}
        className={`w-full border-s-2 px-4 py-3.5 text-start transition-colors hover:bg-surface-2/50 ${borderColor} ${
          unread ? "bg-surface-2/25" : ""
        }`}
      >
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconColor}`} strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {unread && (
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
              )}
              <span className="truncate text-2xs tracking-[0.02em] text-muted-foreground/70">
                {label}
              </span>
            </div>
            <div className={`mt-0.5 truncate text-sm ${unread ? "font-semibold" : "font-medium"} text-foreground`}>
              {n.title}
            </div>
            {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</div>}
          </div>
          <span className="shrink-0 text-2xs text-muted-foreground/60">{date}</span>
        </div>
      </button>
      <button
        onClick={onDismiss}
        aria-label={dismissLabel}
        title={dismissLabel}
        className="absolute end-1 top-1 grid h-5 w-5 place-items-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </li>
  );
}
