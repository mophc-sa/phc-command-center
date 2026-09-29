// =============================================================================
// Settings → Outlook: connect, reconnect or disconnect the person's own mailbox.
//
// Shown only when the backend says Outlook connection is set up and the person
// may send (mail_status.outlook.available). Connecting leaves the app for
// Microsoft's sign-in; Microsoft returns to /settings?outlook=<result>, which
// this card turns into a message and then clears from the address bar.
// =============================================================================

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, type StringKey } from "@/lib/i18n";
import { disconnectOutlook, getMailStatus, startOutlookConnect } from "@/lib/mail-actions";

const RESULTS: Record<string, { key: StringKey; ok: boolean }> = {
  connected: { key: "outlook_result_connected", ok: true },
  denied: { key: "outlook_result_denied", ok: false },
  expired: { key: "outlook_result_expired", ok: false },
  wrong_mailbox: { key: "outlook_result_wrong_mailbox", ok: false },
  failed: { key: "outlook_result_failed", ok: false },
  unavailable: { key: "outlook_result_failed", ok: false },
};

export function OutlookConnectionCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["mail-status"], queryFn: getMailStatus, staleTime: 60_000 });
  const [busy, setBusy] = useState(false);

  // The result of a round trip through Microsoft's sign-in, reported once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("outlook");
    if (!result) return;
    const r = RESULTS[result];
    if (r) (r.ok ? toast.success : toast.error)(t(r.key));
    params.delete("outlook");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    void qc.invalidateQueries({ queryKey: ["mail-status"] });
  }, [qc, t]);

  const o = status.data?.outlook;
  if (!o?.available) return null;

  async function connect() {
    setBusy(true);
    try {
      window.location.assign(await startOutlookConnect());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(t("outlook_disconnect_confirm"))) return;
    setBusy(true);
    try {
      await disconnectOutlook();
      await qc.invalidateQueries({ queryKey: ["mail-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const expired = o.status === "needs_reconnect";

  return (
    <section className="rounded-xl border border-border/70 bg-surface/60">
      <header className="border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Mail className="h-4 w-4" aria-hidden="true" />
          {t("outlook_title")}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{t("outlook_desc")}</div>
      </header>
      <div className="flex flex-wrap items-center gap-3 p-4">
        {o.email ? (
          <div className="min-w-0 flex-1 text-sm">
            <span className="text-muted-foreground">{t("outlook_connected_as")} </span>
            <span dir="ltr" className="font-medium text-foreground">{o.email}</span>
            {expired ? (
              <div className="mt-1">
                <StatusPill tone="attention">{t("outlook_needs_reconnect")}</StatusPill>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {expired || !o.email ? (
          <Button onClick={connect} disabled={busy} size="sm">
            {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {expired ? t("outlook_reconnect") : t("outlook_connect")}
          </Button>
        ) : null}
        {o.email ? (
          <Button variant="outline" onClick={disconnect} disabled={busy} size="sm">
            {t("outlook_disconnect")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
