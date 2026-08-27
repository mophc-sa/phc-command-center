// =============================================================================
// Sales Management (Phase 5) — three views on one route.
//
// Team / Strategic / Executive are three questions about the same data, asked by
// three roles. Splitting them across three routes would mean three copies of the
// same fetch, and a general manager who wants the strategic view would have to
// know a second URL. One route, role-gated tabs, one query.
//
// Every number on this page comes from src/lib/sales-kpis.ts and renders through
// KpiTile, so it carries its own formula and opens the records behind it. Nothing
// here computes a metric locally — a second implementation is how the three
// dashboards disagreed in the first place.
// =============================================================================

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Building2, Clock, Gauge, ShieldAlert, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { KpiTile } from "@/components/phc/KpiTile";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";
import {
  canApproveCommercialAction, canReviewIntake, isBdOrSalesOps, isEstimationManager,
  isExecutive, isFinanceManager, isSalesManager, isSalesperson,
} from "@/lib/roles";
import {
  concentrationBy, executiveKpis, lostByReason, lostByStage,
  opportunityValue, resolveProbability, targetKpis, thisMonth, thisQuarter, yearToDate,
  type KpiContext, type OppRow, type Period,
} from "@/lib/sales-kpis";
import { assembleActions, type ApprovalRowIn, type FlagRowIn, type FollowUpRowIn, type IntakeRowIn, type TaskRowIn } from "@/lib/action-center";
import {
  buildTimeline, groupByRecency,
  type ApprovalRow as TimelineApprovalRow,
  type FollowUpRow as TimelineFollowUpRow,
  type StageTransitionRow,
} from "@/lib/opportunity-timeline";
import { HistoricalSalesView } from "@/components/phc/HistoricalSalesView";
import { memberSummary, needsAttention, summarySentence, teamDay, teamWorkload } from "@/lib/team-dashboard";
import { humanize } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/sales-management")({
  head: () => ({ meta: [{ title: "Sales Management — PHC" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    tab: typeof s.tab === "string" ? s.tab : "",
    range: typeof s.range === "string" ? s.range : "month",
  }),
  component: SalesManagement,
});

type TabKey = "team" | "strategic" | "executive" | "historical";
type RangeKey = "month" | "quarter" | "ytd";

function periodFor(range: RangeKey, today: string): Period {
  if (range === "quarter") return thisQuarter(today);
  if (range === "ytd") return yearToDate(today);
  return thisMonth(today);
}

function SalesManagement() {
  const { lang } = useI18n();
  const { user, roles } = useAuth();
  const uid = user?.id ?? "";
  const { tab: tabParam, range: rangeParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  // Visibility follows business authority, never the technical role. A
  // system_admin with no business role sees none of these tabs — the same rule
  // the database enforces on the underlying decisions.
  const canTeam = isSalesManager(roles) || isExecutive(roles);
  const canStrategic = isBdOrSalesOps(roles) || isExecutive(roles);
  const canExec = isExecutive(roles);
  // The historical archive is wider than the management tabs on purpose: it is
  // the team's own past work, and a salesperson needs it as much as a manager.
  // The gate that matters is can_read_historical_sales() in the database, which
  // admits the sales team plus estimation and finance and refuses viewer and
  // system_admin-alone. This mirrors it so the tab does not appear to someone
  // who would then be shown an empty table.
  const canHistorical =
    isSalesperson(roles) || isBdOrSalesOps(roles) || isSalesManager(roles) ||
    isExecutive(roles) || isEstimationManager(roles) || isFinanceManager(roles);
  const allowed: TabKey[] = [
    ...(canTeam ? (["team"] as TabKey[]) : []),
    ...(canStrategic ? (["strategic"] as TabKey[]) : []),
    ...(canExec ? (["executive"] as TabKey[]) : []),
    ...(canHistorical ? (["historical"] as TabKey[]) : []),
  ];
  const tab: TabKey = (allowed.includes(tabParam as TabKey) ? tabParam : allowed[0]) as TabKey;
  const range = (["month", "quarter", "ytd"].includes(rangeParam) ? rangeParam : "month") as RangeKey;
  // Memoised: a fresh object each render would invalidate every useMemo below
  // it, quietly turning the whole page into a recompute on every keystroke.
  const ctx: KpiContext = useMemo(() => ({ today, period: periodFor(range, today) }), [range, today]);

  const { data, isLoading } = useQuery({
    queryKey: ["sales-management"],
    staleTime: 60_000,
    enabled: allowed.length > 0,
    queryFn: async () => {
      const [opps, flags, tasks, followUps, approvals, intake, transitions, profiles, targets, tenders, runs] =
        await Promise.all([
          supabase.from("opportunities").select(
            "id, project_name, owner_id, sales_stage, stage, tier, contract_value, quotation_value, estimated_value_max, human_win_probability, score, loss_reason, lost_at_stage, lost_to_competitor, expected_contract_date, last_activity_at, next_action, updated_at, created_at, won_at, lost_at, client, main_contractor, source_tender_id",
          ).limit(500),
          supabase.from("opportunity_flags").select("*").limit(300),
          supabase.from("tasks").select("id, title, related_opportunity_id, owner_id, priority, due_date, status, created_at, completed_at").limit(300),
          supabase.from("follow_ups").select("id, opportunity_id, owner_id, due_date, cadence_tier, channel, status, notes, created_at, last_contact_at").limit(300),
          supabase.from("approvals").select("id, approval_type, related_opportunity_id, linked_record_type, linked_record_id, requested_by, assigned_approver, status, decision_notes, created_at, decided_at").limit(200),
          supabase.from("inbox_items").select("id, project_name, company_name, review_state, assigned_owner_id, created_by, request_type, info_due_date, info_responsible_id, created_at, reviewed_at").limit(200),
          supabase.from("stage_transition_history").select("*").order("created_at", { ascending: false }).limit(300),
          supabase.from("profiles").select("id, full_name, email, status"),
          supabase.from("sales_targets").select("user_id, period_type, period_start, sales_target"),
          supabase.from("tenders").select("id, tender_name, tender_stage, tender_owner_id, estimated_project_value, expected_award_date, created_at, converted_opportunity_id").limit(300),
          supabase.from("automation_runs").select("started_at, finished_at, raised, notified, error, trigger").order("started_at", { ascending: false }).limit(5),
        ]);
      return {
        opportunities: (opps.data ?? []) as unknown as OppRow[],
        flags: (flags.data ?? []) as unknown as FlagRowIn[],
        tasks: (tasks.data ?? []) as unknown as TaskRowIn[],
        followUps: (followUps.data ?? []) as unknown as FollowUpRowIn[],
        approvals: (approvals.data ?? []) as unknown as ApprovalRowIn[],
        intake: (intake.data ?? []) as unknown as IntakeRowIn[],
        transitions: (transitions.data ?? []) as unknown as StageTransitionRow[],
        profiles: profiles.data ?? [],
        targets: targets.data ?? [],
        tenders: (tenders.data ?? []) as Array<Record<string, unknown>>,
        runs: (runs.data ?? []) as Array<Record<string, unknown>>,
      };
    },
  });

  // Stable empty array: `data?.x ?? []` allocates a new one each render, which
  // would defeat every memo that depends on it.
  const opps = useMemo(() => data?.opportunities ?? [], [data]);
  const kpis = useMemo(() => executiveKpis(opps, ctx), [opps, ctx]);

  const actions = useMemo(
    () =>
      assembleActions(
        { flags: data?.flags, tasks: data?.tasks, followUps: data?.followUps, approvals: data?.approvals, intake: data?.intake },
        { canReviewIntake: canReviewIntake(roles), canDecideApprovals: canApproveCommercialAction(roles) },
        today,
      ),
    [data, roles, today],
  );

  const events = useMemo(
    () =>
      buildTimeline({
        transitions: data?.transitions ?? [],
        // The action projection and the timeline want overlapping but not
        // identical columns. The query selects the superset, so this widens the
        // type rather than asserting anything that is not actually fetched.
        approvals: (data?.approvals ?? []) as unknown as TimelineApprovalRow[],
        followUps: (data?.followUps ?? []) as unknown as TimelineFollowUpRow[],
      }),
    [data],
  );

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data?.profiles ?? []) m.set(p.id, p.full_name || p.email || p.id.slice(0, 8));
    return (id: string | null) => (id ? (m.get(id) ?? id.slice(0, 8)) : lang === "ar" ? "غير مُسند" : "Unassigned");
  }, [data, lang]);

  // Only people who actually carry sales work appear in the team views.
  const teamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of opps) if (o.owner_id) ids.add(o.owner_id);
    for (const a of actions) if (a.ownerUserId) ids.add(a.ownerUserId);
    return [...ids];
  }, [opps, actions]);

  const summaries = useMemo(
    () => teamIds.map((userId) => memberSummary({ userId, opportunities: opps, actions, events, today })),
    [teamIds, opps, actions, events, today],
  );
  const workload = useMemo(
    () => teamWorkload({ userIds: teamIds, opportunities: opps, actions, events, today }),
    [teamIds, opps, actions, events, today],
  );
  const attention = useMemo(
    () => needsAttention({ actions, opportunities: opps, managerId: uid, today, limit: 12 }),
    [actions, opps, uid, today],
  );
  const day = useMemo(() => teamDay(summaries), [summaries]);

  const setTab = (v: TabKey) => navigate({ search: { tab: v, range }, replace: true });
  const setRange = (v: RangeKey) => navigate({ search: { tab, range: v }, replace: true });

  if (allowed.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Sales Management" title={lang === "ar" ? "إدارة المبيعات" : "Sales Management"} />
        <EmptyState
          icon={ShieldAlert}
          title={lang === "ar" ? "لا تملك صلاحية إدارية تجارية" : "No commercial management access"}
          description={
            lang === "ar"
              ? "هذه الصفحة تتطلب دورًا تجاريًا (مدير مبيعات، مدير تطوير أعمال، أو إدارة عليا). الدور التقني وحده لا يمنح هذه الرؤية."
              : "This view needs a commercial role — sales manager, BD manager, or executive. A technical administrator role alone does not grant it."
          }
        />
      </div>
    );
  }

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
      active ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border/70 bg-surface/60 text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Sales Management"
        title={lang === "ar" ? "إدارة المبيعات" : "Sales Management"}
        description={
          lang === "ar"
            ? "كل رقم هنا يعرض صيغته ومصدره، ويفتح السجلات التي صنعته."
            : "Every number here shows its formula and source, and opens the records behind it."
        }
        actions={<AutomationHealth runs={data?.runs ?? []} lang={lang} today={today} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {allowed.map((k) => (
          <button key={k} onClick={() => setTab(k)} className={pill(tab === k)}>
            {k === "team" ? (lang === "ar" ? "الفريق اليوم" : "Team today")
              : k === "strategic" ? (lang === "ar" ? "استراتيجي ومناقصات" : "Strategic & tenders")
              : k === "historical" ? (lang === "ar" ? "أرشيف المبيعات التاريخية" : "Historical Sales Archive")
              : (lang === "ar" ? "الملخص التنفيذي" : "Executive")}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border/70" aria-hidden="true" />
        {(["month", "quarter", "ytd"] as const).map((r) => (
          <button key={r} onClick={() => setRange(r)} className={pill(range === r)}>
            {r === "month" ? (lang === "ar" ? "هذا الشهر" : "This month")
              : r === "quarter" ? (lang === "ar" ? "هذا الربع" : "This quarter")
              : (lang === "ar" ? "منذ بداية العام" : "Year to date")}
          </button>
        ))}
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : tab === "team" ? (
        <TeamView
          lang={lang} day={day} summaries={summaries} workload={workload} attention={attention}
          events={events} today={today} nameOf={nameOf} kpis={kpis}
          targetTotal={(data?.targets ?? []).reduce((s: number, x: Record<string, unknown>) => s + Number(x.sales_target ?? 0), 0)}
          opps={opps} ctx={ctx}
        />
      ) : tab === "historical" ? (
        // Read-only archive. No props: it owns its own query and its own
        // filters, and there is nothing on this page for it to coordinate with.
        <HistoricalSalesView />
      ) : tab === "strategic" ? (
        <StrategicView lang={lang} kpis={kpis} opps={opps} ctx={ctx} tenders={data?.tenders ?? []} nameOf={nameOf} today={today} />
      ) : (
        <ExecutiveView
          lang={lang} kpis={kpis} opps={opps} ctx={ctx} attention={attention} workload={workload} nameOf={nameOf}
          targetTotal={(data?.targets ?? []).reduce((s: number, x: Record<string, unknown>) => s + Number(x.sales_target ?? 0), 0)}
          tenders={data?.tenders ?? []}
        />
      )}
    </div>
  );
}

// ---- Automation health (PRD §12) -------------------------------------------
// Deliberately tiny: three states read off the run log that already exists. The
// engine was dead for a fortnight in Phase 4 and nothing said so, which is the
// entire justification — this is not an observability platform.

function AutomationHealth({ runs, lang, today }: { runs: Array<Record<string, unknown>>; lang: "en" | "ar"; today: string }) {
  const last = runs[0];
  if (!last) {
    return <StatusPill tone="danger"><AlertTriangle className="h-3 w-3" />{lang === "ar" ? "الأتمتة: لم تُشغَّل" : "Automation: never run"}</StatusPill>;
  }
  const started = String(last.started_at ?? "").slice(0, 10);
  const failed = last.error != null || last.finished_at == null;
  const daysOld = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${started}T00:00:00Z`)) / 86_400_000);
  const tone = failed ? "danger" : daysOld > 1 ? "attention" : "positive";
  const label = failed
    ? (lang === "ar" ? "الأتمتة: فشل" : "Automation: failed")
    : daysOld > 1
      ? (lang === "ar" ? `الأتمتة: آخر تشغيل قبل ${daysOld} يوم` : `Automation: last ran ${daysOld}d ago`)
      : (lang === "ar" ? "الأتمتة: سليمة" : "Automation: healthy");
  return <StatusPill tone={tone as never}><Gauge className="h-3 w-3" />{label}</StatusPill>;
}

// ---- Shared bits ------------------------------------------------------------

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2 mt-6 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold text-foreground">{children}</h2>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function Money({ n, lang }: { n: number | null; lang: "en" | "ar" }) {
  return <span className="num" data-tabular="true">{n === null ? "—" : formatCurrency(n, lang)}</span>;
}

// ---- Team Life Dashboard (PRD §2) ------------------------------------------

function TeamView(props: {
  lang: "en" | "ar";
  day: ReturnType<typeof teamDay>;
  summaries: ReturnType<typeof memberSummary>[];
  workload: ReturnType<typeof teamWorkload>;
  attention: ReturnType<typeof needsAttention>;
  events: ReturnType<typeof buildTimeline>;
  today: string;
  nameOf: (id: string | null) => string;
  kpis: ReturnType<typeof executiveKpis>;
  targetTotal: number;
  opps: OppRow[];
  ctx: KpiContext;
}) {
  const { lang, day, workload, attention, events, today, nameOf, kpis, targetTotal, opps, ctx } = props;
  const targets = targetKpis(opps, ctx, targetTotal > 0 ? targetTotal : null);
  const groups = groupByRecency(events, today);

  return (
    <>
      <SectionTitle hint={lang === "ar" ? "حقائق معدودة، بلا تقييم" : "Counted facts, no scoring"}>
        {lang === "ar" ? "الفريق اليوم" : "Team today"}
      </SectionTitle>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          [lang === "ar" ? "إجراءات مكتملة" : "Actions completed", day.actionsCompleted],
          [lang === "ar" ? "متابعات" : "Follow-ups", day.followUpsCompleted],
          [lang === "ar" ? "تحركات المراحل" : "Stage moves", day.stageMoves],
          [lang === "ar" ? "طلبات اعتماد" : "Approvals requested", day.approvalsRequested],
          [lang === "ar" ? "أعضاء نشطون" : "Members active", day.membersActive],
        ].map(([label, n]) => (
          <div key={String(label)} className="rounded-xl border border-border/70 bg-surface/60 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="num mt-1 text-[20px] font-semibold text-foreground" data-tabular="true">
              {formatNumber(Number(n), lang)}
            </div>
          </div>
        ))}
      </div>

      <SectionTitle>{lang === "ar" ? "الأداء مقابل الهدف" : "Performance vs target"}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile kpi={targets.target} label={lang === "ar" ? "الهدف" : "Target"} />
        <KpiTile kpi={targets.actual} label={lang === "ar" ? "المحقق (Won)" : "Actual (Won)"} />
        <KpiTile kpi={targets.gap} label={lang === "ar" ? "المتبقي" : "Gap"} />
        <KpiTile kpi={kpis.openPipeline} label={lang === "ar" ? "خط الأنابيب" : "Open pipeline"} />
        <KpiTile kpi={kpis.weightedPipeline} label={lang === "ar" ? "المرجّح" : "Weighted"} />
        <KpiTile kpi={kpis.winRate} label={lang === "ar" ? "معدل الفوز" : "Win rate"} />
      </div>

      <SectionTitle hint={lang === "ar" ? "الأحرج أولاً" : "Most critical first"}>
        {lang === "ar" ? "يحتاج انتباهك" : "Needs your attention"}
      </SectionTitle>
      {attention.length === 0 ? (
        <EmptyState message={lang === "ar" ? "لا شيء عالق." : "Nothing is blocked."} compact />
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          {attention.map((a) => (
            <li key={a.id} className="border-t border-border/60 first:border-t-0">
              <Link to={a.href as never} className="flex flex-wrap items-center gap-2 px-5 py-3 hover:bg-surface-2/40">
                <StatusPill tone={a.severity === "critical" ? "danger" : a.severity === "high" ? "attention" : "muted"}>
                  {a.severity === "critical" ? <ShieldAlert className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {a.severity}
                </StatusPill>
                <span className="truncate text-base font-medium text-foreground">{a.entityLabel}</span>
                <span className="text-xs text-muted-foreground">{a.reason}</span>
                {a.value ? <span className="ms-auto"><Money n={a.value} lang={lang} /></span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle hint={lang === "ar" ? "مرتب حسب قيمة خط الأنابيب — لا ترتيب حسب عدد المهام" : "Ordered by pipeline value — never by task count"}>
        {lang === "ar" ? "توزيع العمل" : "Team workload"}
      </SectionTitle>
      <div className="overflow-x-auto rounded-xl border border-border/70 bg-surface/60">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="text-2xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border/60">
              {[
                lang === "ar" ? "العضو" : "Member",
                lang === "ar" ? "فرص" : "Opps",
                lang === "ar" ? "خط الأنابيب" : "Pipeline",
                lang === "ar" ? "إجراءات" : "Actions",
                lang === "ar" ? "متأخر" : "Overdue",
                lang === "ar" ? "أولوية عالية" : "High priority",
                lang === "ar" ? "بلا إجراء تالٍ" : "No next action",
                lang === "ar" ? "اليوم" : "Today",
              ].map((h) => (
                <th key={h} className="px-4 py-2 text-start font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workload.map((r) => (
              <tr key={r.userId} className="border-t border-border/60 hover:bg-surface-2/40">
                <td className="px-4 py-2.5">
                  <Link to={r.drilldown.to as never} search={r.drilldown.search as never} className="font-medium text-foreground hover:underline">
                    {nameOf(r.userId)}
                  </Link>
                </td>
                <td className="num px-4 py-2.5" data-tabular="true">{r.activeOpportunities}</td>
                <td className="px-4 py-2.5"><Money n={r.openPipelineValue} lang={lang} /></td>
                <td className="num px-4 py-2.5" data-tabular="true">{r.openActions}</td>
                <td className={`num px-4 py-2.5 ${r.overdueActions > 0 ? "text-destructive" : ""}`} data-tabular="true">{r.overdueActions}</td>
                <td className="num px-4 py-2.5" data-tabular="true">{r.highPriorityActions}</td>
                <td className="num px-4 py-2.5" data-tabular="true">{r.opportunitiesWithNoNextAction}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{summarySentence(r, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {workload.length === 0 ? <div className="px-5 py-8 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا أعضاء بعمل مسجل." : "No members with recorded work."}</div> : null}
      </div>

      <SectionTitle hint={lang === "ar" ? "الأحدث أولاً" : "Latest first"}>
        {lang === "ar" ? "نشاط الفريق" : "Team activity"}
      </SectionTitle>
      {groups.length === 0 ? (
        <EmptyState message={lang === "ar" ? "لا نشاط مسجل." : "No recorded activity."} compact />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.key === "today" ? (lang === "ar" ? "اليوم" : "Today")
                  : g.key === "yesterday" ? (lang === "ar" ? "أمس" : "Yesterday")
                  : (lang === "ar" ? "سابقاً" : "Earlier")}
              </div>
              <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
                {g.events.slice(0, 25).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 border-t border-border/60 px-5 py-2.5 first:border-t-0">
                    <Clock className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                    <span className="text-sm font-medium text-foreground">{e.title}</span>
                    {e.from && e.to ? (
                      <span className="text-xs text-muted-foreground">
                        {humanize(e.from)} → {humanize(e.to)}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">· {nameOf(e.actorId)}</span>
                    <span className="ms-auto num text-2xs text-muted-foreground/70" data-tabular="true">
                      {e.at.slice(0, 16).replace("T", " ")}
                    </span>
                    {e.href ? (
                      <Link to={e.href as never} className="text-xs text-amber-light hover:underline">
                        {lang === "ar" ? "فتح" : "Open"}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---- BD Manager (PRD §3) ----------------------------------------------------

const TENDER_TERMINAL = new Set(["converted_to_jih", "tender_lost_or_archived"]);

function StrategicView(props: {
  lang: "en" | "ar";
  kpis: ReturnType<typeof executiveKpis>;
  opps: OppRow[];
  ctx: KpiContext;
  tenders: Array<Record<string, unknown>>;
  nameOf: (id: string | null) => string;
  today: string;
}) {
  const { lang, kpis, opps, ctx, tenders, today } = props;

  const active = tenders.filter((x) => !TENDER_TERMINAL.has(String(x.tender_stage)));
  const converted = tenders.filter((x) => String(x.tender_stage) === "converted_to_jih");
  const closed = tenders.filter((x) => TENDER_TERMINAL.has(String(x.tender_stage)));
  const conversionPct = closed.length > 0 ? Math.round((converted.length / closed.length) * 100) : null;

  const byStage = useMemo(() => {
    const m = new Map<string, { n: number; value: number }>();
    for (const x of tenders) {
      const k = String(x.tender_stage ?? "unknown");
      const b = m.get(k) ?? { n: 0, value: 0 };
      b.n += 1;
      b.value += Number(x.estimated_project_value ?? 0);
      m.set(k, b);
    }
    return [...m.entries()].sort((a, b) => b[1].value - a[1].value);
  }, [tenders]);

  const aging = useMemo(
    () =>
      active
        .map((x) => ({
          id: String(x.id),
          name: String(x.tender_name ?? "—"),
          days: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(String(x.created_at ?? today))) / 86_400_000),
          value: Number(x.estimated_project_value ?? 0),
          stage: String(x.tender_stage ?? ""),
        }))
        .sort((a, b) => b.days - a.days)
        .slice(0, 10),
    [active, today],
  );

  const fromTenders = opps.filter((o) => o.source_tender_id);
  const byClient = concentrationBy(opps, ctx, (o) => (o as Record<string, unknown>).main_contractor as string | null, lang === "ar" ? "غير محدد" : "Not recorded");
  const dormant = opps.filter((o) => o.last_activity_at && Date.parse(`${today}T00:00:00Z`) - Date.parse(o.last_activity_at) > 30 * 86_400_000);

  return (
    <>
      <SectionTitle>{lang === "ar" ? "خط الأنابيب الاستراتيجي" : "Strategic pipeline"}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile kpi={kpis.openPipeline} label={lang === "ar" ? "خط الأنابيب المفتوح" : "Open pipeline"} />
        <KpiTile kpi={kpis.weightedPipeline} label={lang === "ar" ? "المرجّح" : "Weighted"} />
        <KpiTile kpi={kpis.lateStageExposure} label={lang === "ar" ? "تعرض متأخر" : "Late-stage exposure"} />
        <KpiTile kpi={kpis.byStage.find((k) => k.key === "stage_jih_bafo")!} label="JIH BAFO" />
      </div>

      <SectionTitle hint={lang === "ar" ? "من بيانات المناقصات الداخلية فقط" : "Internal tender data only"}>
        {lang === "ar" ? "المناقصات" : "Tenders"}
      </SectionTitle>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [lang === "ar" ? "مناقصات نشطة" : "Active tenders", formatNumber(active.length, lang)],
          [lang === "ar" ? "محوّلة إلى JIH" : "Converted to JIH", formatNumber(converted.length, lang)],
          [lang === "ar" ? "معدل التحويل" : "Conversion rate", conversionPct === null ? "—" : `${conversionPct}%`],
          [lang === "ar" ? "فرص من مناقصات" : "Opportunities from tenders", formatNumber(fromTenders.length, lang)],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border border-border/70 bg-surface/60 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{l}</div>
            <div className="num mt-1 text-[20px] font-semibold text-foreground" data-tabular="true">{v}</div>
            {String(l).includes("Conversion") && conversionPct === null ? (
              <div className="mt-1 text-2xs text-amber-light">{lang === "ar" ? "لا مناقصات مغلقة بعد" : "No closed tenders yet"}</div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          <div className="border-b border-border/60 px-4 py-2.5 text-sm font-medium">{lang === "ar" ? "حسب المرحلة" : "By stage"}</div>
          {byStage.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا مناقصات." : "No tenders."}</div>
          ) : (
            <ul>
              {byStage.map(([stage, b]) => (
                <li key={stage} className="border-t border-border/60 first:border-t-0">
                  <Link to="/tenders" className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/40">
                    <span className="text-foreground">{humanize(stage)}</span>
                    <span className="flex items-center gap-3 text-muted-foreground">
                      <span className="num" data-tabular="true">{b.n}</span>
                      <Money n={b.value} lang={lang} />
                      <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          <div className="border-b border-border/60 px-4 py-2.5 text-sm font-medium">{lang === "ar" ? "أقدم المناقصات النشطة" : "Oldest active tenders"}</div>
          {aging.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا مناقصات نشطة." : "No active tenders."}</div>
          ) : (
            <ul>
              {aging.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 text-sm first:border-t-0">
                  <span className="truncate text-foreground">{x.name}</span>
                  <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                    <span className="num" data-tabular="true">{x.days}d</span>
                    <Money n={x.value} lang={lang} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <SectionTitle hint={lang === "ar" ? "حصة كل جهة من خط الأنابيب المفتوح" : "Share of open pipeline"}>
        {lang === "ar" ? "التركّز حسب المقاول الرئيسي" : "Concentration by main contractor"}
      </SectionTitle>
      <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
        {byClient.slice(0, 8).map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 text-sm first:border-t-0">
            <span className="flex items-center gap-2 truncate text-foreground">
              <Building2 className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              {c.label}
            </span>
            <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
              <Money n={c.value} lang={lang} />
              <span className="num w-10 text-end" data-tabular="true">{c.sharePct}%</span>
            </span>
          </li>
        ))}
        {byClient.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا بيانات." : "No data."}</li> : null}
      </ul>

      <SectionTitle hint={lang === "ar" ? "بلا نشاط منذ 30 يومًا فأكثر" : "No activity for 30+ days"}>
        {lang === "ar" ? "فرص خاملة" : "Dormant opportunities"}
      </SectionTitle>
      {dormant.length === 0 ? (
        <EmptyState message={lang === "ar" ? "لا فرص خاملة." : "Nothing dormant."} compact />
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          {dormant.slice(0, 10).map((o) => (
            <li key={o.id} className="border-t border-border/60 first:border-t-0">
              <Link to="/opportunities/$id" params={{ id: o.id }} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/40">
                <span className="truncate text-foreground">{o.project_name ?? o.id.slice(0, 8)}</span>
                <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                  <span className="text-xs">{humanize(String(o.sales_stage ?? o.stage ?? ""))}</span>
                  <Money n={opportunityValue(o)} lang={lang} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- GM / Executive (PRD §4) ------------------------------------------------

function ExecutiveView(props: {
  lang: "en" | "ar";
  kpis: ReturnType<typeof executiveKpis>;
  opps: OppRow[];
  ctx: KpiContext;
  attention: ReturnType<typeof needsAttention>;
  workload: ReturnType<typeof teamWorkload>;
  nameOf: (id: string | null) => string;
  targetTotal: number;
  tenders: Array<Record<string, unknown>>;
}) {
  const { lang, kpis, opps, ctx, attention, workload, nameOf, targetTotal, tenders } = props;
  const targets = targetKpis(opps, ctx, targetTotal > 0 ? targetTotal : null);

  const top = [...opps]
    .filter((o) => kpis.openPipeline.recordIds.includes(o.id))
    .map((o) => ({ o, v: opportunityValue(o) ?? 0 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 6);

  const reasons = lostByReason(opps, ctx).slice(0, 5);
  const stages = lostByStage(opps, ctx).slice(0, 5);
  const activeTenders = tenders.filter((x) => !TENDER_TERMINAL.has(String(x.tender_stage)));

  return (
    <>
      <SectionTitle hint={lang === "ar" ? "المحقق = Won فقط" : "Actual = Won only"}>
        {lang === "ar" ? "الصورة التنفيذية" : "Executive summary"}
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <KpiTile kpi={kpis.openPipeline} label={lang === "ar" ? "خط الأنابيب المفتوح" : "Total open pipeline"} />
        <KpiTile kpi={kpis.weightedPipeline} label={lang === "ar" ? "التوقع المرجّح" : "Weighted forecast"} />
        <KpiTile kpi={targets.actual} label={lang === "ar" ? "المحقق (Won)" : "Won"} />
        <KpiTile kpi={targets.achievement} label={lang === "ar" ? "نسبة تحقيق الهدف" : "Target achievement"} />
        <KpiTile kpi={targets.gap} label={lang === "ar" ? "الفجوة للهدف" : "Forecast gap to target"} />
        <KpiTile kpi={kpis.winRate} label={lang === "ar" ? "معدل الفوز" : "Win rate"} />
        <KpiTile kpi={kpis.lostValue} label={lang === "ar" ? "قيمة الخسائر" : "Lost value"} />
        <KpiTile kpi={kpis.wonUndated} label={lang === "ar" ? "Won بلا تاريخ" : "Won (undated)"} />
      </div>

      <SectionTitle hint={lang === "ar" ? "ليست إيرادًا — يمكن أن تُخسر" : "Not revenue — these can still be lost"}>
        {lang === "ar" ? "التعرض في المراحل المتأخرة" : "Late-stage exposure"}
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile kpi={kpis.lateStageExposure} label={lang === "ar" ? "إجمالي التعرض" : "Total exposure"} />
        {kpis.byStage
          .filter((k) => ["stage_verbally_awarded", "stage_contract_received", "stage_contract_signed"].includes(k.key))
          .map((k) => (
            <KpiTile key={k.key} kpi={k} label={humanize(k.key.replace("stage_", ""))} />
          ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <SectionTitle>{lang === "ar" ? "أكبر الفرص المفتوحة" : "Top opportunities"}</SectionTitle>
          <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
            {top.map(({ o, v }) => {
              const p = resolveProbability(o);
              return (
                <li key={o.id} className="border-t border-border/60 first:border-t-0">
                  <Link to="/opportunities/$id" params={{ id: o.id }} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/40">
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{o.project_name ?? o.id.slice(0, 8)}</span>
                      <span className="text-2xs text-muted-foreground">
                        {p.value === null ? (lang === "ar" ? "بلا احتمال" : "Unscored") : `${Math.round(p.value * 100)}% · ${p.label}`}
                      </span>
                    </span>
                    <Money n={v} lang={lang} />
                  </Link>
                </li>
              );
            })}
            {top.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا فرص مفتوحة بقيمة." : "No valued open opportunities."}</li> : null}
          </ul>
        </div>

        <div>
          <SectionTitle>{lang === "ar" ? "المخاطر الكبرى" : "Major risks"}</SectionTitle>
          <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
            {attention.slice(0, 6).map((a) => (
              <li key={a.id} className="border-t border-border/60 first:border-t-0">
                <Link to={a.href as never} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/40">
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">{a.entityLabel}</span>
                    <span className="text-2xs text-muted-foreground">{a.reason}</span>
                  </span>
                  <Money n={a.value} lang={lang} />
                </Link>
              </li>
            ))}
            {attention.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا مخاطر مرصودة." : "No flagged risks."}</li> : null}
          </ul>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <SectionTitle>{lang === "ar" ? "أسباب الخسارة" : "Loss reasons"}</SectionTitle>
          <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
            {reasons.map((r) => (
              <li key={r.key} className="border-t border-border/60 first:border-t-0">
                <Link to="/opportunities" search={{ stage: "lost" } as never} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/40">
                  <span className="truncate text-foreground">{humanize(r.label)}</span>
                  <span className="flex items-center gap-3 text-muted-foreground">
                    <span className="num" data-tabular="true">{r.count}</span>
                    <Money n={r.value} lang={lang} />
                  </span>
                </Link>
              </li>
            ))}
            {reasons.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا خسائر في هذه الفترة." : "No losses in this period."}</li> : null}
          </ul>
        </div>

        <div>
          <SectionTitle>{lang === "ar" ? "الخسارة حسب المرحلة" : "Lost by stage"}</SectionTitle>
          <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
            {stages.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 text-sm first:border-t-0">
                <span className="truncate text-foreground">{humanize(r.label)}</span>
                <span className="flex items-center gap-3 text-muted-foreground">
                  <span className="num" data-tabular="true">{r.count}</span>
                  <Money n={r.value} lang={lang} />
                </span>
              </li>
            ))}
            {stages.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا بيانات." : "No data."}</li> : null}
          </ul>
        </div>
      </div>

      <SectionTitle hint={lang === "ar" ? "مرتب حسب قيمة خط الأنابيب" : "Ordered by pipeline value"}>
        {lang === "ar" ? "أداء الفريق" : "Team performance"}
      </SectionTitle>
      <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
        {workload.slice(0, 10).map((r) => (
          <li key={r.userId} className="border-t border-border/60 first:border-t-0">
            <Link to={r.drilldown.to as never} search={r.drilldown.search as never} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/40">
              <span className="flex items-center gap-2 truncate text-foreground">
                <Users className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                {nameOf(r.userId)}
              </span>
              <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                <span className="num" data-tabular="true">{r.activeOpportunities}</span>
                <Money n={r.openPipelineValue} lang={lang} />
              </span>
            </Link>
          </li>
        ))}
        {workload.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا بيانات فريق." : "No team data."}</li> : null}
      </ul>

      <SectionTitle>{lang === "ar" ? "المناقصات" : "Tender pipeline"}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/tenders" className="rounded-xl border border-border/70 bg-surface/60 px-4 py-3 hover:border-border-strong hover:bg-surface-2/40">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{lang === "ar" ? "مناقصات نشطة" : "Active tenders"}</div>
          <div className="num mt-1 text-[20px] font-semibold text-foreground" data-tabular="true">{formatNumber(activeTenders.length, lang)}</div>
        </Link>
        <Link to="/tenders" className="rounded-xl border border-border/70 bg-surface/60 px-4 py-3 hover:border-border-strong hover:bg-surface-2/40">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{lang === "ar" ? "قيمة المناقصات النشطة" : "Active tender value"}</div>
          <div className="num mt-1 text-[20px] font-semibold text-foreground" data-tabular="true">
            {formatCurrency(activeTenders.reduce((s, x) => s + Number(x.estimated_project_value ?? 0), 0), lang)}
          </div>
        </Link>
      </div>
    </>
  );
}
