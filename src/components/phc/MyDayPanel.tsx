// =============================================================================
// My tasks today: everything on the person's list for the Riyadh day (tasks,
// follow-ups, commitments — my_day), the day's rate, a ✓ for tasks and an
// "Add task" form. Follow-ups and commitments close on their deal, where the
// outcome is recorded, so here they link there.
// =============================================================================

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ListChecks, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, type StringKey } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canCreateSalesRecords } from "@/lib/roles";
import { createTask, formatRate, myDay, rate, riyadhDay, setTaskStatus, type Bucket, type DayItem } from "@/lib/daily-tasks";

const BUCKET: Record<Bucket, StringKey> = {
  mandatory: "day_bucket_mandatory", manager: "day_bucket_manager", self: "day_bucket_self",
  ai: "day_bucket_ai", meeting: "day_bucket_meeting",
};

export function MyDayPanel() {
  const { t, lang } = useI18n();
  const { user, roles } = useAuth();
  const qc = useQueryClient();
  const day = riyadhDay();
  const allowed = Boolean(user) && canCreateSalesRecords(roles);
  const key = ["my-day", user?.id, day];
  const q = useQuery({ queryKey: key, queryFn: () => myDay(day), enabled: allowed, refetchInterval: 60_000 });
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(day);
  const [busy, setBusy] = useState(false);
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (!allowed) return null;
  const items = q.data ?? [];
  const done = items.filter((i) => i.done).length;
  const r = rate(done, items.length - done);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["my-day"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="my-day-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="my-day-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("day_title")}
        </h2>
        <span className="text-sm text-muted-foreground">
          {t("day_rate")}: <span className="font-semibold text-foreground tabular-nums">{formatRate(r, lang)}</span>
          {items.length > 0 ? <span className="tabular-nums"> · {done}/{items.length}</span> : null}
        </span>
      </header>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          void run(async () => { await createTask({ title, dueDate: due }); setTitle(""); setDue(day); });
        }}
      >
        <Input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("day_add_placeholder")}
               maxLength={500} className="min-w-0 flex-1" aria-label={t("day_add")} disabled={busy} />
        <Input type="date" value={due} min={day} onChange={(e) => setDue(e.target.value)} className="w-40" aria-label={t("day_due")} disabled={busy} />
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t("day_add")}
        </Button>
      </form>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground" role="status">
          {q.isLoading ? "…" : t("day_empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((it: DayItem) => (
            <li key={`${it.kind}:${it.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              {it.kind === "task" ? (
                <Button type="button" size="sm" variant={it.done ? "outline" : "default"} disabled={busy}
                        aria-label={it.done ? t("day_undo") : t("day_done")}
                        onClick={() => void run(() => setTaskStatus(it.id, it.done ? "open" : "done"))}>
                  {it.done ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                </Button>
              ) : null}
              <span dir="auto" className={`min-w-0 flex-1 text-sm ${it.done ? "text-muted-foreground line-through" : "text-foreground"}`}>{it.title}</span>
              <StatusPill tone="muted">{t(BUCKET[it.bucket])}</StatusPill>
              {it.overdue ? <StatusPill tone="danger">{t("day_overdue")}</StatusPill> : null}
              {it.opportunity_id ? (
                <Button asChild size="sm" variant="ghost">
                  <Link to="/opportunities/$id" params={{ id: it.opportunity_id }}>
                    <span dir="auto" className="max-w-40 truncate">{it.opportunity_name ?? t("day_open_deal")}</span>
                  </Link>
                </Button>
              ) : null}
              {it.kind === "task" && !it.done && it.bucket !== "manager" ? (
                cancelFor === it.id ? (
                  <span className="flex items-center gap-1.5">
                    <Input dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("day_cancel_reason")} className="h-8 w-48" />
                    <Button type="button" size="sm" variant="destructive" disabled={busy || !reason.trim()}
                            onClick={() => void run(async () => { await setTaskStatus(it.id, "cancelled", reason); setCancelFor(null); setReason(""); })}>
                      {t("day_cancel")}
                    </Button>
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="ghost" aria-label={t("day_cancel")} onClick={() => { setCancelFor(it.id); setReason(""); }}>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
