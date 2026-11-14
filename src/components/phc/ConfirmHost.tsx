import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/lib/i18n";

/**
 * In-app replacement for window.confirm (review 2026-11-14). The native box is
 * unstyled, ignores the page's RTL direction and shows the site's hostname as
 * its title. `await confirmAction(message)` resolves true on confirm and
 * false on cancel, Escape or an outside click. <ConfirmHost /> is mounted
 * once at the root.
 */
type Request = { message: string; resolve: (ok: boolean) => void };

let pending: Request | null = null;
let notify: ((r: Request | null) => void) | null = null;

export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!notify) return resolve(window.confirm(message)); // host not mounted (tests, early boot)
    pending?.resolve(false);
    pending = { message, resolve };
    notify(pending);
  });
}

export function ConfirmHost() {
  const { lang } = useI18n();
  const [req, setReq] = useState<Request | null>(null);

  useEffect(() => {
    notify = setReq;
    return () => {
      notify = null;
    };
  }, []);

  const close = (ok: boolean) => {
    req?.resolve(ok);
    pending = null;
    setReq(null);
  };

  return (
    <AlertDialog open={req !== null} onOpenChange={(open) => !open && close(false)}>
      <AlertDialogContent dir={lang === "ar" ? "rtl" : "ltr"}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-medium leading-relaxed">{req?.message}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={() => close(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</AlertDialogCancel>
          <AlertDialogAction onClick={() => close(true)}>{lang === "ar" ? "تأكيد" : "Confirm"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
