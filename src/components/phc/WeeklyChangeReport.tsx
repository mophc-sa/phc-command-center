import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/phc/Panel";
import { KpiCard } from "@/components/phc/KpiCard";
import { KpiRow } from "@/components/phc/KpiRow";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listTeamMembers } from "@/lib/opportunity-actions";
import { approvalTypeLabel } from "@/lib/approval-labels";
import { useI18n, formatNumber } from "@/lib/i18n";
import { riyadhDay, addDays } from "@/lib/riyadh-day";
import { changeKind, weekOf, weeklyCounts, type StageChange } from "@/lib/weekly-report";

/**
 * What changed this week (Omar's CRM review, point 13): new deals, quotations
 * sent, stage changes (verbal awards, contracts, holds, losses), decisions
 * waiting, and next week's actions with who owns them. Built from recorded
 * changes, not from the current state, so it says what moved and when.
 */
export function WeeklyChangeReport() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [offset, setOffset] = useState(0);
  const week = weekOf(riyadhDay(), offset);
  const fromTs = `${week.from}T00:00:00+03:00`;
  const toTs = `${week.to}T00:00:00+03:00`;

  const members = useQuery({ queryKey: ["team-members-min"], queryFn: listTeamMembers });
  const q = useQuery({
    queryKey: ["weekly-change-report", week.from],
    queryFn: async () => {
      const [changes, created, sent, nextFus, approvals] = await Promise.all([
        supabase.from("audit_log").select("entity_id, before_value, after_value, created_at, actor_type")
          .eq("entity_type", "opportunity").eq("action", "opportunity.fields_changed")
          .not("after_value->>sales_stage", "is", null).gte("created_at", fromTs).lt("created_at", toTs).order("created_at"),
        supabase.from("opportunities").select("id").neq("stage", "archived").gte("created_at", fromTs).lt("created_at", toTs),
        supabase.from("quotation_revisions").select("id").gte("submitted_at", fromTs).lt("submitted_at", toTs),
        supabase.from("follow_ups").select("id, due_date, notes, owner_id, opportunity_id, opportunities(project_name)")
          .eq("status", "scheduled").gte("due_date", week.to).lt("due_date", addDays(week.to, 7)).order("due_date"),
        supabase.from("approvals").select("id, approval_type, created_at, related_opportunity_id, opportunities(project_name)")
          .eq("status", "pending").order("created_at"),
      ]);
      for (const r of [changes, created, sent, nextFus, approvals]) if (r.error) throw r.error;
      const list: StageChange[] = (changes.data ?? []).map((c: any) => ({
        opportunityId: c.entity_id, from: c.before_value?.sales_stage ?? null, to: c.after_value?.sales_stage ?? null,
        at: c.created_at, source: c.actor_type,
      }));
      const ids = [...new Set(list.map((c) => c.opportunityId))];
      const opps = ids.length
        ? (await supabase.from("opportunities").select("id, project_name, owner_id").in("id", ids)).data ?? []
        : [];
      return { list, opps, created: created.data?.length ?? 0, sent: sent.data?.length ?? 0, nextFus: nextFus.data ?? [], approvals: approvals.data ?? [] };
    },
  });

  const name = (id: string | null | undefined) =>
    id ? ((members.data ?? []).find((m: any) => m.id === id)?.full_name ?? "—") : (ar ? "بلا مسؤول" : "No owner");
  const stage = (s: string | null) => (s ? t(`sstage_${s}` as never) : "—");
  const range = `${week.from} – ${addDays(week.to, -1)}`;

  return (
    <Panel
      title={ar ? "التقرير الأسبوعي — ما الذي تغيّر" : "Weekly report — what changed"}
      subtitle={ar ? `الأسبوع ${range} (الأحد إلى السبت)` : `Week ${range} (Sunday to Saturday)`}
      action={
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label={ar ? "الأسبوع السابق" : "Previous week"} className="rounded-md border border-border p-1.5 hover:bg-muted">
            {ar ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          <button type="button" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))} aria-label={ar ? "الأسبوع التالي" : "Next week"} className="rounded-md border border-border p-1.5 hover:bg-muted disabled:opacity-60">
            {ar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      }
    >
      {q.error ? (
        <QueryFailure retry={() => void q.refetch()} />
      ) : !q.data ? (
        <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : (
        (() => {
          const d = q.data;
          const k = weeklyCounts(d.list, d.created, d.sent);
          const oppName = (id: string) => (d.opps as any[]).find((o) => o.id === id)?.project_name ?? "—";
          const oppOwner = (id: string) => (d.opps as any[]).find((o) => o.id === id)?.owner_id ?? null;
          const byOwner = new Map<string, any[]>();
          for (const f of d.nextFus as any[]) byOwner.set(f.owner_id ?? "", [...(byOwner.get(f.owner_id ?? "") ?? []), f]);
          return (
            <div className="grid gap-5">
              <KpiRow className="mb-0">
                <KpiCard label={ar ? "فرص جديدة" : "New opportunities"} value={formatNumber(k.newDeals, lang)} />
                <KpiCard label={ar ? "عروض أُرسلت" : "Quotes sent"} value={formatNumber(k.quotesSent, lang)} hint={ar ? "إصدارات سُجّل إرسالها" : "Revisions recorded as sent"} />
                <KpiCard label={ar ? "ترسيات شفهية جديدة" : "New verbal awards"} value={formatNumber(k.verbal, lang)} />
                <KpiCard label={ar ? "عقود / أوامر شراء" : "Contracts / POs"} value={formatNumber(k.signed, lang)} />
                <KpiCard label={ar ? "تعلّقت / خُسرت" : "Held / lost"} value={`${formatNumber(k.held, lang)} / ${formatNumber(k.lost, lang)}`} />
              </KpiRow>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">{ar ? "تغييرات المراحل هذا الأسبوع" : "Stage changes this week"}</h3>
                {d.list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{ar ? "لم تتغير مرحلة أي فرصة في هذا الأسبوع." : "No deal changed stage this week."}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{ar ? "المشروع" : "Project"}</TableHead>
                        <TableHead>{ar ? "من" : "From"}</TableHead>
                        <TableHead>{ar ? "إلى" : "To"}</TableHead>
                        <TableHead>{ar ? "المسؤول" : "Owner"}</TableHead>
                        <TableHead>{ar ? "التاريخ" : "Date"}</TableHead>
                        <TableHead>{ar ? "المصدر" : "Source"}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.list.map((c, i) => (
                        <TableRow key={`${c.opportunityId}-${i}`}>
                          <TableCell>
                            <Link to="/opportunities/$id" params={{ id: c.opportunityId }} className="font-medium text-foreground hover:underline">{oppName(c.opportunityId)}</Link>
                          </TableCell>
                          <TableCell>{stage(c.from)}</TableCell>
                          <TableCell className={changeKind(c.to) === "lost" ? "text-destructive-on-tint" : changeKind(c.to) === "moved" ? "" : "font-semibold"}>{stage(c.to)}</TableCell>
                          <TableCell>{name(oppOwner(c.opportunityId))}</TableCell>
                          <TableCell className="tabular-nums">{c.at.slice(0, 10)}</TableCell>
                          <TableCell className="text-muted-foreground">{c.source === "data_sync" ? (ar ? "مزامنة القائمة الرئيسية" : "Master list sync") : (ar ? "في النظام" : "In the system")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">{ar ? "قرارات مطلوبة" : "Decisions needed"} · {formatNumber(d.approvals.length, lang)}</h3>
                  {d.approvals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{ar ? "لا موافقات تنتظر." : "Nothing waiting for approval."}</p>
                  ) : (
                    <ul className="grid gap-1.5 text-sm">
                      {(d.approvals as any[]).slice(0, 10).map((a) => (
                        <li key={a.id} className="flex justify-between gap-3 border-b border-border/50 pb-1">
                          <span>{approvalTypeLabel(a.approval_type, lang)}{a.opportunities?.project_name ? ` — ${a.opportunities.project_name}` : ""}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{String(a.created_at).slice(0, 10)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">{ar ? "إجراءات الأسبوع القادم" : "Next week's actions"} · {formatNumber(d.nextFus.length, lang)}</h3>
                  {d.nextFus.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{ar ? "لا متابعات مجدولة للأسبوع القادم." : "No follow-ups scheduled for next week."}</p>
                  ) : (
                    <ul className="grid gap-2 text-sm">
                      {[...byOwner.entries()].map(([owner, fus]) => (
                        <li key={owner}>
                          <span className="font-semibold">{name(owner || null)}</span> · {formatNumber(fus.length, lang)}
                          <span className="block text-muted-foreground">
                            {fus.slice(0, 3).map((f) => `${f.due_date} ${f.opportunities?.project_name ?? ""}${f.notes ? ` — ${String(f.notes).slice(0, 60)}` : ""}`).join(" · ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {ar
                  ? "مبني على التغييرات المسجّلة (سجل التعديلات منذ 16 نوفمبر 2026)، لا على الوضع الحالي."
                  : "Built from recorded changes (the change log since 16 Nov 2026), not from the current state."}
              </p>
            </div>
          );
        })()
      )}
    </Panel>
  );
}
