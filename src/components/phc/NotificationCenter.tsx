import { AlertTriangle, BellOff, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useNavigate } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useNotifications, type Notification } from "@/hooks/useNotifications";

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

  function handleRowClick(n: Notification) {
    onOpenChange(false);
    if (n.kind === "approval") {
      void navigate({ to: "/approvals" });
    } else if (n.opportunityId) {
      void navigate({ to: "/opportunities/$id", params: { id: n.opportunityId } });
    } else {
      void navigate({ to: "/action-center" });
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={dir === "rtl" ? "left" : "right"}
        className="flex w-80 flex-col gap-0 p-0 sm:max-w-80"
      >
        {/* Header */}
        <SheetHeader className="border-b border-border/70 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-sm font-semibold">
                {t("notif_title")}
              </SheetTitle>
              {items.length > 0 && (
                <span className="num flex h-4 min-w-4 items-center justify-center rounded-full bg-amber/20 px-1 text-[10px] font-semibold text-amber-light">
                  {items.length}
                </span>
              )}
            </div>
          </div>
          <SheetDescription className="sr-only">
            {t("notif_empty_desc")}
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
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
                <NotifRow key={n.id} n={n} lang={lang} onClick={() => handleRowClick(n)} />
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-border/70 px-5 py-3">
            <p className="text-center text-[11px] text-muted-foreground/60">
              {lang === "ar"
                ? `${items.length} بند يحتاج انتباهك`
                : `${items.length} item${items.length > 1 ? "s" : ""} need your attention`}
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
  onClick,
}: {
  n: Notification;
  lang: "en" | "ar";
  onClick: () => void;
}) {
  const Icon = n.kind === "approval" ? ShieldCheck : AlertTriangle;
  const iconColor = n.tone === "danger" ? "text-red-400" : "text-amber-light";
  const borderColor = n.tone === "danger" ? "border-s-red-400/60" : "border-s-amber/50";
  const date = new Date(n.createdAt).toLocaleDateString(
    lang === "ar" ? "ar-SA" : "en-US",
    { month: "short", day: "numeric" },
  );

  return (
    <li className="border-b border-border/40 last:border-0">
      <button
        onClick={onClick}
        className={`w-full border-s-2 px-4 py-3.5 text-start transition-colors hover:bg-surface-2/50 ${borderColor}`}
      >
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconColor}`} strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-foreground">{n.title}</div>
            {n.subtitle && (
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{n.subtitle}</div>
            )}
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground/60">{date}</span>
        </div>
        {n.dueDate && (
          <div className="mt-1.5 ps-6 text-[10px] text-muted-foreground">
            {lang === "ar" ? "مستحق" : "Due"} {n.dueDate}
          </div>
        )}
      </button>
    </li>
  );
}
