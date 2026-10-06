// =============================================================================
// Team today (managers): each rep's list for the Riyadh day — rate, done/total,
// overdue, the split by source, and yesterday's rate — plus "Assign task".
// Counts only (daily_completion); titles stay with their owners.
// =============================================================================

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n, type StringKey } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canManageSalesPipeline } from "@/lib/roles";
import { listTeamMembers } from "@/lib/opportunity-actions";
import { isAssignableTeamMember } from "@/lib/team-members";
import { addDays, createTask, formatRate, rate, riyadhDay, teamDay, type Bucket } from "@/lib/daily-tasks";

const ORDER: Bucket[] = ["mandatory", "manager", "self", "ai", "meeting"];
const LABEL: Record<Bucket, StringKey> = {
  mandatory: "day_bucket_mandatory", manager: "day_bucket_manager", self: "day_bucket_self",
  ai: "day_bucket_ai", meeting: "day_bucket_meeting",
};
type Member = { id: string; full_name: string | null; email: string | null; status?: string | null; is_display_account?: boolean | null };

export function TeamDayPanel() {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const allowed = canManageSalesPipeline(roles);
  const day = riyadhDay();
  const todayQ = useQuery({ queryKey: ["team-day", day], queryFn: () => teamDay(day), enabled: allowed, refetchInterval: 60_000 });
  const yQ = useQuery({ queryKey: ["team-day", addDays(day, -1)], queryFn: () => teamDay(addDays(day, -1)), enabled: allowed });
  const teamQ = useQuery({ queryKey: ["team"], queryFn: listTeamMembers, enabled: allowed });
  const members = ((teamQ.data ?? []) as Member[]).filter(isAssignableTeamMember);
  const [owner, setOwner] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(day);
  const [busy, setBusy] = useState(false);

  if (!allowed) return null;
  const rows = todayQ.data ?? [];
  const yesterday = new Map((yQ.data ?? []).map((r) => [r.user_id, rate(r.done, r.open_due)]));
  const teamDone = rows.reduce((a, r) => a + r.done, 0);
  const teamOpen = rows.reduce((a, r) => a + r.open_due, 0);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!owner || !title.trim()) return;
    setBusy(true);
    try {
      await createTask({ title, dueDate: due, ownerId: owner });
      setTitle("");
      await qc.invalidateQueries({ queryKey: ["team-day"] });
      toast.success(t("day_assign"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="team-day-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="team-day-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("day_team_title")}
        </h2>
        <span className="text-sm text-muted-foreground">
          {t("day_rate")}: <span className="font-semibold text-foreground tabular-nums">{formatRate(rate(teamDone, teamOpen), lang)}</span>
        </span>
      </header>

      <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">{t("day_assign_to")}</TableHead>
              <TableHead className="text-end">{t("day_rate")}</TableHead>
              <TableHead className="text-end">{t("day_overdue")}</TableHead>
              {ORDER.map((b) => <TableHead key={b} className="text-end">{t(LABEL[b])}</TableHead>)}
              <TableHead className="text-end">{t("day_team_yesterday")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.user_id}>
                <TableCell dir="auto" className="text-foreground">{r.full_name ?? "—"}</TableCell>
                <TableCell className="text-end tabular-nums">
                  <span className="font-semibold">{formatRate(rate(r.done, r.open_due), lang)}</span>
                  <span className="text-muted-foreground"> · {r.done}/{r.done + r.open_due}</span>
                </TableCell>
                <TableCell className={`text-end tabular-nums ${r.overdue > 0 ? "font-semibold text-destructive-on-tint" : "text-muted-foreground"}`}>{r.overdue}</TableCell>
                {ORDER.map((b) => (
                  <TableCell key={b} className="text-end tabular-nums text-muted-foreground">
                    {r.buckets[b] ? `${r.buckets[b]!.done}/${r.buckets[b]!.total}` : "—"}
                  </TableCell>
                ))}
                <TableCell className="text-end tabular-nums text-muted-foreground">{formatRate(yesterday.get(r.user_id) ?? null, lang)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

      <form onSubmit={assign} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <select className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={owner}
                onChange={(e) => setOwner(e.target.value)} aria-label={t("day_assign_to")} disabled={busy}>
          <option value="">{t("day_assign_to")}…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
        </select>
        <Input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("day_add_placeholder")}
               maxLength={500} className="min-w-0 flex-1" aria-label={t("day_assign")} disabled={busy} />
        <Input type="date" value={due} min={day} onChange={(e) => setDue(e.target.value)} className="w-40" aria-label={t("day_due")} disabled={busy} />
        <Button type="submit" size="sm" disabled={busy || !owner || !title.trim()}>{t("day_assign")}</Button>
      </form>
    </section>
  );
}
