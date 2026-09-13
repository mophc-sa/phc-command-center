// =============================================================================
// "Add to Outlook" — a person's private calendar link.
//
// The link shows that person's own dated obligations in their Outlook calendar.
// It is a standing read credential, so the window says three things plainly:
// it is private, it refreshes on Outlook's schedule rather than instantly, and
// generating a new one revokes the old.
//
// The plaintext link exists only in this component's state, right after it is
// created. The backend stores a hash and cannot show it again.
// =============================================================================

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, Copy, RefreshCw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, localeFor } from "@/lib/i18n";
import {
  createCalendarFeed,
  getCalendarFeedStatus,
  revokeCalendarFeed,
} from "@/lib/calendar-feed-actions";

export function OutlookCalendarDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { lang, dir } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["calendar-feed-status"],
    queryFn: getCalendarFeedStatus,
    enabled: open,
  });
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = status.data?.active === true;

  async function create() {
    setBusy(true);
    try {
      const r = await createCalendarFeed();
      setUrl(r.url);
      void qc.invalidateQueries({ queryKey: ["calendar-feed-status"] });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : ar ? "تعذّر إنشاء الرابط" : "Could not create the link",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await revokeCalendarFeed();
      setUrl(null);
      void qc.invalidateQueries({ queryKey: ["calendar-feed-status"] });
      toast.success(
        ar
          ? "أُلغي الرابط. لن يتحدّث التقويم في Outlook بعد الآن."
          : "Link revoked. Outlook will stop updating this calendar.",
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : ar ? "تعذّر الإلغاء" : "Could not revoke the link",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(ar ? "نُسخ الرابط" : "Link copied");
    } catch {
      toast.error(ar ? "تعذّر النسخ" : "Could not copy");
    }
  }

  const fetched = status.data?.last_fetched_at ? new Date(status.data.last_fetched_at) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setUrl(null); // never keep the plaintext link around after closing
        onOpenChange(v);
      }}
    >
      <DialogContent dir={dir} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            {ar ? "إضافة إلى تقويم Outlook" : "Add to Outlook calendar"}
          </DialogTitle>
          <DialogDescription>
            {ar
              ? "متابعاتك ومواعيدك تظهر في تقويم Outlook. ما تملكه أنت فقط."
              : "Your follow-ups and deadlines appear in your Outlook calendar. Only what you own."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1 text-sm">
          {url ? (
            <>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={url}
                  dir="ltr"
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button variant="outline" onClick={copy}>
                  <Copy className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {ar ? "نسخ" : "Copy"}
                </Button>
              </div>
              <ol className="list-decimal space-y-1 ps-5 text-xs text-muted-foreground">
                <li>
                  {ar
                    ? "افتح Outlook ← التقويم ← إضافة تقويم."
                    : "Open Outlook → Calendar → Add calendar."}
                </li>
                <li>
                  {ar
                    ? "اختر «الاشتراك من الويب» والصق الرابط."
                    : "Choose “Subscribe from web” and paste the link."}
                </li>
              </ol>
              <p className="rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-amber-light">
                {ar
                  ? "هذا الرابط سيُعرض مرّة واحدة فقط. من يملكه يرى مواعيدك — لا تشاركه."
                  : "This link is shown once. Anyone who has it can see your schedule — do not share it."}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {active
                ? ar
                  ? `لديك رابط فعّال${fetched ? `، آخر تحديث من Outlook: ${fetched.toLocaleString(localeFor(lang))}` : "، ولم يجلبه Outlook بعد"}. إنشاء رابط جديد يُلغي القديم.`
                  : `You have an active link${fetched ? `, last fetched by Outlook ${fetched.toLocaleString(localeFor(lang))}` : ", not yet fetched by Outlook"}. Creating a new one revokes the old.`
                : ar
                  ? "لم تُنشئ رابطًا بعد."
                  : "You have not created a link yet."}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {ar
              ? "يحدّث Outlook التقاويم المشترك فيها بجدوله الخاص — نحو كل ثلاث ساعات، وقد يتأخّر أكثر من يوم. ليست مزامنة فورية."
              : "Outlook refreshes subscribed calendars on its own schedule — about every three hours, sometimes more than a day. It is not instant."}
          </p>
        </div>

        <DialogFooter className="gap-2">
          {active ? (
            <Button variant="ghost" onClick={revoke} disabled={busy} className="text-destructive">
              <Trash2 className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {ar ? "إلغاء الرابط" : "Revoke link"}
            </Button>
          ) : null}
          <Button onClick={create} disabled={busy}>
            <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {active
              ? ar
                ? "إنشاء رابط جديد"
                : "Create new link"
              : ar
                ? "إنشاء الرابط"
                : "Create link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
