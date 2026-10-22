// =============================================================================
// Settings → Fireflies: connect, replace or disconnect the person's own
// Fireflies account (meetings phase 1, decision 1).
//
// The key is typed here once and sent to sales-os-api, which checks with
// Fireflies that it opens the person's own account and keeps it in Vault.
// What comes back (my_fireflies_connection) has the account email and the
// last fetch, never the key. Shown to the sales side only, like Outlook.
// =============================================================================

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, localeFor } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canCreateSalesRecords } from "@/lib/roles";
import { connectFireflies, disconnectFireflies, getFirefliesConnection } from "@/lib/meetings-actions";

export function FirefliesConnectionCard() {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const allowed = canCreateSalesRecords(roles);
  const status = useQuery({ queryKey: ["fireflies-connection"], queryFn: getFirefliesConnection, enabled: allowed });
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!allowed || status.isLoading) return null;
  const conn = status.data ?? null;
  const expired = conn?.status === "needs_reconnect";
  const showForm = !conn || expired || editing;

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    try {
      const r = await connectFireflies(key.trim());
      setKey("");
      setEditing(false);
      toast.success(r.added ? `${t("fireflies_connected_toast")} · ${r.added} ${t("meetings_sync_added")}` : t("fireflies_connected_toast"));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["fireflies-connection"] }),
        qc.invalidateQueries({ queryKey: ["meetings"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(t("fireflies_disconnect_confirm"))) return;
    setBusy(true);
    try {
      await disconnectFireflies();
      await qc.invalidateQueries({ queryKey: ["fireflies-connection"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border/70 bg-surface/60">
      <header className="border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Mic className="h-4 w-4" aria-hidden="true" />
          {t("fireflies_title")}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{t("fireflies_desc")}</div>
      </header>
      <div className="space-y-3 p-4">
        {conn ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-sm">
              <span className="text-muted-foreground">{t("fireflies_connected_as")} </span>
              <span dir="ltr" className="font-medium text-foreground">{conn.email}</span>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t("fireflies_last_synced")}:{" "}
                {conn.last_synced_at
                  ? new Date(conn.last_synced_at).toLocaleString(localeFor(lang), { dateStyle: "medium", timeStyle: "short" })
                  : t("fireflies_never")}
              </div>
              {expired ? (
                <div className="mt-1">
                  <StatusPill tone="attention">{t("fireflies_needs_reconnect")}</StatusPill>
                </div>
              ) : null}
            </div>
            {!showForm ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>
                {t("fireflies_replace")}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
              {t("fireflies_disconnect")}
            </Button>
          </div>
        ) : null}
        {showForm ? (
          <form className="space-y-1.5" onSubmit={connect}>
            <label htmlFor="fireflies-key" className="text-xs font-medium text-muted-foreground">{t("fireflies_key_label")}</label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="fireflies-key"
                type="password"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                value={key}
                maxLength={200}
                onChange={(e) => setKey(e.target.value)}
                className="min-w-0 flex-1"
                disabled={busy}
              />
              <Button type="submit" size="sm" disabled={busy || !key.trim()}>
                {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                {t("fireflies_connect")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("fireflies_key_help")}</p>
          </form>
        ) : null}
      </div>
    </section>
  );
}
