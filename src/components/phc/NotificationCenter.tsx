import { BellOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

// Structure-only notification center.
// When Supabase Realtime is wired, replace the empty state with a scrollable
// list of NotificationRow components fetched from the notifications table.

export function NotificationCenter({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, dir } = useI18n();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={dir === "rtl" ? "left" : "right"}
        className="flex w-80 flex-col gap-0 p-0 sm:max-w-80"
      >
        {/* Header */}
        <SheetHeader className="border-b border-border/70 px-5 py-4">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-sm font-semibold">
              {t("notif_title")}
            </SheetTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground"
              disabled
            >
              {t("notif_mark_all_read")}
            </Button>
          </div>
          <SheetDescription className="sr-only">
            {t("notif_empty_desc")}
          </SheetDescription>
        </SheetHeader>

        {/* Body — empty state (replace with live list when Realtime is wired) */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-12 text-center">
          <BellOff
            className="h-9 w-9 text-muted-foreground/30"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-foreground">{t("notif_empty")}</p>
          <p className="max-w-[200px] text-xs text-muted-foreground">
            {t("notif_empty_desc")}
          </p>
        </div>

        {/* Footer — coming-soon note */}
        <div className="border-t border-border/70 px-5 py-3">
          <p className="text-center text-[11px] text-muted-foreground/50">
            {t("notif_coming_soon")}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
