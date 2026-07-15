import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ListChecks, BellRing, ShieldCheck, Sparkles, FileText, Award, CheckCheck, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { ChartFrame } from "@/components/phc/ChartFrame";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonChart } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RecommendationCard } from "@/components/phc/RecommendationCard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useI18n, formatCurrency, formatNumber, type Lang } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { logActivity, type ActivityType } from "@/lib/activity-actions";
import { ACTIVE_FLAG_STATUSES } from "@/lib/workflow-actions";
import { acceptRecommendation, dismissRecommendation } from "@/lib/recommendation-actions";
import { completeFollowUp, rescheduleFollowUp } from "@/lib/opportunity-actions";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { RECORD_TYPE_ICONS } from "@/components/phc/CommandPalette";
import { humanize } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/my-workspace")({
  head: () => ({ meta: [{ title: "My Day — PHC" }, { name: "robots", content: "noindex" }] }),
  component: WorkspacePage,
});

const ACTIVITY_TYPES: ActivityType[] = ["call", "visit", "meeting", "note", "email_draft", "whatsapp_draft"];

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function WorkspacePage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? "";
  const [logOpen, setLogOpen] = useState(false);
  const [tab, setTab] = useState("today");
  const [completeFor, setCompleteFor] = useState<{ id: string; oppId: string } | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<{ id: string; oppId: string; currentDate: string } | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftContent, setDraftContent] = useState<string>("");
  const [draftFuId, setDraftFuId] = useState<string | null>(null);
  const { recent } = useRecentRecords();

  const today = new Date().toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ["workspace", uid],
    enabled: !!uid,
    queryFn: async () => {
      const [target, accounts, opps, followups, tasks, activities, approvals] = await Promise.all([
        supabase.from("sales_targets").select("*").eq("user_id", uid).eq("period_start", monthStart()).maybeSingle(),
        supabase.from("companies").select("id, name, company_type, account_status").eq("account_owner_id", uid).order("updated_at", { ascending: false }),
        supabase.from("opportunities").select("id, project_name, stage, tier, pipeline_step, estimated_value_max, currency, owner_id").eq("owner_id", uid).not("stage", "in", "(won,lost,archived)").order("updated_at", { ascending: false }),
        supabase.from("follow_ups").select("id, opportunity_id, due_date, status, channel, cadence_tier, notes").eq("owner_id", uid).neq("status", "completed").order("due_date", { ascending: true }),
        supabase.from("tasks").select("id, title, due_date, status").eq("owner_id", uid).neq("status", "done").order("due_date", { ascending: true }),
        supabase.from("activities").select("id, activity_type, summary, occurred_at, related_opportunity_id").eq("owner_id", uid).order("occurred_at", { ascending: false }).limit(12),
        supabase.from("approvals").select("*").eq("status", "pending"),
      ]);
      return {
        target: target.data,
        accounts: accounts.data ?? [],
        opps: opps.data ?? [],
        followups: followups.data ?? [],
        tasks: tasks.data ?? [],
        activities: activities.data ?? [],
        approvals: approvals.data ?? [],
      };
    },
  });

  const { data: myOpps = [] } = useQuery({
    queryKey: ["ws-opps-min", uid],
    enabled: !!uid,
    queryFn: async () => (await supabase.from("opportunities").select("id, project_name").eq("owner_id", uid).order("project_name")).data ?? [],
  });

  const { data: recs = [] } = useQuery({
    queryKey: ["ws-recs", uid],
    enabled: !!uid,
    queryFn: async () =>
      (await supabase.from("recommendations").select("*").eq("suggested_owner_id", uid).eq("status", "pending").order("created_at", { ascending: false })).data ?? [],
  });

  const myOppIds = useMemo(() => (data?.opps ?? []).map((o: any) => o.id), [data]);

  const { data: flags = [] } = useQuery({
    queryKey: ["ws-flags", uid, myOppIds.length],
    enabled: !!uid && myOppIds.length > 0,
    // linked_record_type/linked_record_id is the real (polymorphic) key on
    // opportunity_flags — there is no opportunity_id column on this table.
    queryFn: async () =>
      (await supabase
        .from("opportunity_flags")
        .select("*")
        .in("status", ACTIVE_FLAG_STATUSES)
        .eq("linked_record_type", "opportunity")
        .in("linked_record_id", myOppIds)
        .order("created_at", { ascending: false })).data ?? [],
  });

  const { data: myRfqs = [] } = useQuery({
    queryKey: ["ws-rfqs", uid],
    enabled: !!uid,
    queryFn: async () =>
      (await supabase.from("rfqs").select("id, rfq_number, status, estimated_value, response_due_date").eq("sales_owner_id", uid).eq("status", "open").order("response_due_date", { ascending: true })).data ?? [],
  });

  const { data: myTenders = [] } = useQuery({
    queryKey: ["ws-tenders", uid],
    enabled: !!uid,
    queryFn: async () =>
      (await supabase.from("tenders").select("id, tender_name, tender_stage, tender_priority_classification, estimated_project_value, expected_award_date").eq("tender_owner_id", uid).not("tender_stage", "in", "(converted_to_jih,tender_lost_or_archived)").order("expected_award_date", { ascending: true })).data ?? [],
  });

  const yearStart = `${new Date().getFullYear()}-01-01`;

  const { data: awardedOpps = [] } = useQuery({
    queryKey: ["ws-awarded", uid],
    enabled: !!uid,
    queryFn: async () =>
      (await supabase
        .from("opportunities")
        .select("id, project_name, estimated_value_max, currency, sales_stage, updated_at")
        .eq("owner_id", uid)
        .eq("stage", "won")
        .gte("updated_at", yearStart)
        .order("updated_at", { ascending: false })).data ?? [],
  });

  const { data: urgentQuotations = [] } = useQuery({
    queryKey: ["ws-urgent-quotations", uid],
    enabled: !!uid,
    queryFn: async () => {
      const sevenDaysOut = new Date();
      sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
      return (await supabase
        .from("quotations")
        .select("id, related_opportunity_id, status, valid_until, total_value, currency")
        .eq("owner_id", uid)
        .in("status", ["approved_for_submission", "submitted", "follow_up"])
        .lte("valid_until", sevenDaysOut.toISOString().slice(0, 10))
        .order("valid_until", { ascending: true })).data ?? [];
    },
  });

  const { data: jihOpps = [] } = useQuery({
    queryKey: ["ws-jih", uid],
    enabled: !!uid,
    queryFn: async () =>
      (await supabase
        .from("opportunities")
        .select("id, project_name, sales_stage, estimated_value_max, currency, win_confidence")
        .eq("owner_id", uid)
        .in("sales_stage", ["jih", "jih_bafo"])
        .order("updated_at", { ascending: false })).data ?? [],
  });

  if (isLoading || !data) return <SkeletonChart kpis={4} charts={2} />;

  const pipelineValue = data.opps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0);
  const tg = data.target;
  const awardedValue = awardedOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0);
  const achievementPct = tg?.sales_target ? Math.round((awardedValue / tg.sales_target) * 100) : null;

  const overdueFU = data.followups.filter((f: any) => f.status === "overdue" || (f.due_date && f.due_date < today));
  const todayFU = data.followups.filter((f: any) => f.due_date === today);
  const upcomingFU = data.followups.filter((f: any) => f.due_date && f.due_date > today);

  const overdueTasks = data.tasks.filter((tk: any) => tk.due_date && tk.due_date < today);
  const todayTasks = data.tasks.filter((tk: any) => tk.due_date === today);
  const upcomingTasks = data.tasks.filter((tk: any) => !tk.due_date || tk.due_date > today);

  const myApprovals = data.approvals.filter((a: any) => a.assigned_approver === uid || a.requested_by === uid);

  const tierAOpps = data.opps.filter((o: any) => o.tier === "A");
  const missingDataFlags = flags.filter((f: any) => f.flag_kind === "action_required");

  const oppName = (id: string | null) => (id ? data.opps.find((o: any) => o.id === id)?.project_name ?? "—" : "—");

  const handleDraftFollowUp = async (followUpId: string, opportunityId: string, channel: string | null) => {
    setDraftFuId(followUpId);
    setDraftLoading(true);
    try {
      const res = await supabase.functions.invoke("ai-orchestrator", {
        body: {
          agentKey: "smart_followup_draft",
          entityType: "opportunity",
          entityId: opportunityId,
          input: { follow_up_id: followUpId, channel: channel ?? "email" },
        },
      });
      if (res.error) throw new Error(String(res.error));
      const draft = res.data?.result?.draft_text ?? res.data?.result?.body ?? JSON.stringify(res.data?.result ?? {}, null, 2);
      setDraftContent(typeof draft === "string" ? draft : JSON.stringify(draft, null, 2));
      setDraftOpen(true);
    } catch (e: any) {
      toast.error((lang === "ar" ? "تعذّر إنشاء المسودة: " : "Draft failed: ") + e.message);
    } finally {
      setDraftLoading(false);
      setDraftFuId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={lang === "ar" ? "مساحة العمل" : "Workspace"}
        title={t("nav_my_day")}
        description={user?.email ?? undefined}
        actions={
          <button
            onClick={() => setLogOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3.5 text-[12px] font-medium text-amber-light transition-colors hover:bg-amber/20"
          >
            <Sparkles className="h-3.5 w-3.5" /> {t("ws_log_activity")}
          </button>
        }
      />

      {/* KPI row */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t("ws_awarded_value")}
          value={formatCurrency(awardedValue, lang, "SAR")}
          hint={tg?.sales_target ? `${lang === "ar" ? "من هدف" : "of target"} ${formatCurrency(tg.sales_target, lang, "SAR")}` : (lang === "ar" ? "لا هدف محدد" : "No target set")}
          trend={achievementPct !== null ? (achievementPct >= 80 ? "up" : achievementPct >= 50 ? "flat" : "down") : undefined}
        />
        <KpiCard
          label={t("ws_achievement_pct")}
          value={achievementPct !== null ? `${achievementPct}%` : "—"}
          hint={lang === "ar" ? "إنجاز المبيعات" : "Sales achievement"}
          trend={achievementPct !== null ? (achievementPct >= 80 ? "up" : achievementPct >= 50 ? "flat" : "down") : undefined}
        />
        <KpiCard label={lang === "ar" ? "متأخرات اليوم" : "Overdue today"} value={formatNumber(overdueFU.length + overdueTasks.length, lang)} hint={lang === "ar" ? "متابعات ومهام" : "Follow-ups & tasks"} trend={overdueFU.length + overdueTasks.length > 0 ? "down" : "flat"} />
        <KpiCard label={lang === "ar" ? "بانتظار قرارك" : "Awaiting your decision"} value={formatNumber(myApprovals.length, lang)} hint={t("metric_awaiting_approval")} />
      </section>

      {/* Pipeline snapshot row — Sales OS pilot Sprint 1 widgets */}
      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label={t("ws_today_followups")} value={formatNumber(todayFU.length, lang)} hint={lang === "ar" ? "مستحقة اليوم" : "Due today"} />
        <KpiCard label={t("ws_overdue_followups")} value={formatNumber(overdueFU.length, lang)} hint={lang === "ar" ? "تحتاج متابعة فورية" : "Needs immediate follow-up"} trend={overdueFU.length > 0 ? "down" : "flat"} />
        <KpiCard label={t("ws_tier_a_opportunities")} value={formatNumber(tierAOpps.length, lang)} hint={formatCurrency(tierAOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0), lang, "SAR")} />
        <KpiCard label={t("ws_my_rfqs")} value={formatNumber(myRfqs.length, lang)} hint={t("ws_rfqs_open")} />
        <KpiCard label={t("ws_my_tenders")} value={formatNumber(myTenders.length, lang)} hint={t("ws_tenders_active")} />
        <KpiCard label={t("ws_missing_data")} value={formatNumber(missingDataFlags.length, lang)} hint={lang === "ar" ? "بانتظار استكمال البيانات" : "Awaiting data completion"} trend={missingDataFlags.length > 0 ? "down" : "flat"} />
        <KpiCard label={t("ws_jih_summary")} value={formatNumber(jihOpps.length, lang)} hint={formatCurrency(jihOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0), lang, "SAR")} />
        <KpiCard label={t("ws_urgent_quotations")} value={formatNumber(urgentQuotations.length, lang)} hint={lang === "ar" ? "تستحق هذا الأسبوع" : "Due this week"} trend={urgentQuotations.length > 0 ? "down" : "flat"} />
      </section>

      {/* Target snapshot — multi-dimensional target vs. tracked actuals (pipeline only for now) */}
      <section className="mt-3">
        <ChartFrame title={t("ws_target_snapshot")} subtitle={tg ? undefined : t("ws_no_target")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <TargetMetric label={t("ws_target_sales")} target={tg?.sales_target} actual={undefined} lang={lang} />
            <TargetMetric label={t("ws_target_pipeline")} target={tg?.pipeline_target} actual={pipelineValue} lang={lang} />
            <TargetMetric label={t("ws_target_quotations")} target={tg?.quotation_target} actual={undefined} lang={lang} isCount />
            <TargetMetric label={t("ws_target_activities")} target={tg?.activity_target} actual={data.activities.length} lang={lang} isCount />
            <TargetMetric label={t("ws_target_reactivation")} target={tg?.reactivation_target} actual={undefined} lang={lang} isCount />
          </div>
        </ChartFrame>
      </section>

      {recs.length > 0 ? (
        <section className="mt-6">
          <ChartFrame title={t("rec_title")} subtitle={t("rec_disclaimer")}>
            <div className="grid gap-3 md:grid-cols-2">
              {recs.map((r: any) => (
                <RecommendationCard
                  key={r.id}
                  rec={r}
                  onAccept={async () => {
                    try {
                      await acceptRecommendation(r);
                      toast.success(t("rec_accept"));
                      qc.invalidateQueries({ queryKey: ["ws-recs", uid] });
                      qc.invalidateQueries({ queryKey: ["approvals"] });
                    } catch (e) {
                      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                    }
                  }}
                  onDismiss={async () => {
                    try {
                      await dismissRecommendation(r.id);
                      qc.invalidateQueries({ queryKey: ["ws-recs", uid] });
                    } catch (e) {
                      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                    }
                  }}
                />
              ))}
            </div>
          </ChartFrame>
        </section>
      ) : null}

      <section className="mt-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 h-auto rounded-lg border border-border/70 bg-surface/60 p-1">
            <TabItem value="today" icon={<CalendarClock className="h-3.5 w-3.5" />} label={lang === "ar" ? "اليوم" : "Today"} count={overdueFU.length + todayFU.length + overdueTasks.length + todayTasks.length} />
            <TabItem value="tasks" icon={<ListChecks className="h-3.5 w-3.5" />} label={lang === "ar" ? "مهامي" : "My Tasks"} count={data.tasks.length} />
            <TabItem value="followups" icon={<CalendarClock className="h-3.5 w-3.5" />} label={t("nav_follow_ups")} count={data.followups.length} />
            <TabItem value="action" icon={<BellRing className="h-3.5 w-3.5" />} label={t("nav_action_center")} count={flags.length} />
            <TabItem value="approvals" icon={<ShieldCheck className="h-3.5 w-3.5" />} label={t("nav_approvals")} count={myApprovals.length} />
            <TabItem value="rfqs" icon={<FileText className="h-3.5 w-3.5" />} label={t("ws_my_rfqs")} count={myRfqs.length} />
            <TabItem value="tenders" icon={<Award className="h-3.5 w-3.5" />} label={t("ws_my_tenders")} count={myTenders.length} />
            <TabItem value="jih" icon={<Award className="h-3.5 w-3.5" />} label={t("ws_jih_summary")} count={jihOpps.length} />
            <TabItem value="quotations" icon={<FileText className="h-3.5 w-3.5" />} label={t("ws_urgent_quotations")} count={urgentQuotations.length} />
          </TabsList>

          <TabsContent value="today" className="mt-0 grid gap-3 lg:grid-cols-2">
            <ChartFrame title={lang === "ar" ? "متابعات اليوم" : "Follow-ups today"} subtitle={`${formatNumber(overdueFU.length, lang)} ${lang === "ar" ? "متأخرة" : "overdue"} · ${formatNumber(todayFU.length, lang)} ${lang === "ar" ? "اليوم" : "today"}`} padded={false}>
              {[...overdueFU, ...todayFU].length === 0 ? (
                <div className="px-5 py-8"><EmptyState message={t("ws_none")} /></div>
              ) : (
                <ul>
                  {[...overdueFU, ...todayFU].slice(0, 8).map((f: any) => {
                    const isOverdue = f.status === "overdue" || (f.due_date && f.due_date < today);
                    return (
                      <li key={f.id} className="border-t border-border/60 first:border-t-0">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-5 py-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <StatusPill tone={isOverdue ? "attention" : "neutral"}>
                                {isOverdue ? (lang === "ar" ? "متأخر" : "Overdue") : (lang === "ar" ? "اليوم" : "Today")}
                              </StatusPill>
                              <span className="text-[11px] text-muted-foreground">{humanize(f.channel)}</span>
                            </div>
                            {f.opportunity_id ? (
                              <Link to="/opportunities/$id" params={{ id: f.opportunity_id }} className="mt-1 block truncate text-[13px] font-medium text-foreground hover:underline">
                                {oppName(f.opportunity_id)}
                              </Link>
                            ) : (
                              <div className="mt-1 truncate text-[13px] font-medium text-foreground">{oppName(f.opportunity_id)}</div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="num text-[11px] text-muted-foreground tabular-nums">{f.due_date ?? "—"}</span>
                            <button
                              onClick={() => setRescheduleFor({ id: f.id, oppId: f.opportunity_id, currentDate: f.due_date ?? "" })}
                              title={lang === "ar" ? "إعادة الجدولة" : "Reschedule"}
                              className="grid h-6 w-6 place-items-center rounded border border-border/70 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                            >
                              <CalendarClock className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => setCompleteFor({ id: f.id, oppId: f.opportunity_id })}
                              title={lang === "ar" ? "تمت" : "Mark complete"}
                              className="grid h-6 w-6 place-items-center rounded border border-amber/40 bg-amber/10 text-amber-light transition-colors hover:bg-amber/20"
                            >
                              <CheckCheck className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ChartFrame>
            <ChartFrame title={lang === "ar" ? "مهام اليوم" : "Tasks today"} subtitle={`${formatNumber(overdueTasks.length, lang)} ${lang === "ar" ? "متأخرة" : "overdue"} · ${formatNumber(todayTasks.length, lang)} ${lang === "ar" ? "اليوم" : "today"}`} padded={false}>
              <List
                empty={t("ws_none")}
                items={[...overdueTasks, ...todayTasks].slice(0, 8).map((tk: any) => ({
                  key: tk.id,
                  primary: tk.title,
                  secondary: humanize(tk.status),
                  tone: tk.due_date && tk.due_date < today ? "attention" : "neutral",
                  label: tk.due_date && tk.due_date < today ? (lang === "ar" ? "متأخر" : "Overdue") : (lang === "ar" ? "اليوم" : "Today"),
                  right: tk.due_date ?? "—",
                }))}
              />
            </ChartFrame>
            <ChartFrame title={t("ws_open_opportunities")} subtitle={`${formatNumber(data.opps.length, lang)} ${lang === "ar" ? "فرصة" : "open"}`} padded={false}>
              <List
                empty={t("ws_none")}
                items={data.opps.slice(0, 8).map((o: any) => ({
                  key: o.id,
                  primary: o.project_name,
                  secondary: humanize(o.pipeline_step ?? o.stage),
                  tone: "muted",
                  label: humanize(o.pipeline_step ?? o.stage),
                  right: formatCurrency(o.estimated_value_max, lang, o.currency),
                  href: { to: "/opportunities/$id" as const, params: { id: o.id } },
                }))}
              />
            </ChartFrame>
            <ChartFrame title={t("ws_recent_activity")} subtitle={String(data.activities.length)} padded={false}>
              <List
                empty={t("ws_none")}
                items={data.activities.slice(0, 8).map((a: any) => ({
                  key: a.id,
                  primary: a.summary ?? "—",
                  secondary: t(`activity_type_${a.activity_type}` as never),
                  tone: "muted",
                  label: t(`activity_type_${a.activity_type}` as never),
                  right: new Date(a.occurred_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric" }),
                }))}
              />
            </ChartFrame>
            {recent.length > 0 && (
              <ChartFrame title={lang === "ar" ? "سجلات زرتها مؤخرًا" : "Recently Visited"} subtitle={String(recent.length)} padded={false}>
                <ul>
                  {recent.map((r) => {
                    const Icon = RECORD_TYPE_ICONS[r.type as keyof typeof RECORD_TYPE_ICONS] ?? Clock;
                    return (
                      <li key={r.to} className="transition-colors hover:bg-surface-2/40">
                        <Link to={r.to as any} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/60 px-5 py-3 first:border-t-0">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-foreground">{r.label}</div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">{r.type}</div>
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(r.visitedAt).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric" })}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </ChartFrame>
            )}
          </TabsContent>

          <TabsContent value="tasks" className="mt-0">
            <ChartFrame title={lang === "ar" ? "كل المهام" : "All my tasks"} subtitle={formatNumber(data.tasks.length, lang)} padded={false}>
              <List
                empty={t("ws_none")}
                items={[...overdueTasks, ...todayTasks, ...upcomingTasks].map((tk: any) => ({
                  key: tk.id,
                  primary: tk.title,
                  secondary: humanize(tk.status),
                  tone: tk.due_date && tk.due_date < today ? "attention" : "neutral",
                  label: tk.due_date && tk.due_date < today ? (lang === "ar" ? "متأخر" : "Overdue") : humanize(tk.status),
                  right: tk.due_date ?? "—",
                }))}
              />
            </ChartFrame>
          </TabsContent>

          <TabsContent value="followups" className="mt-0">
            <ChartFrame title={t("nav_follow_ups")} subtitle={formatNumber(data.followups.length, lang)} padded={false}>
              {[...overdueFU, ...todayFU, ...upcomingFU].length === 0 ? (
                <EmptyState message={t("empty_follow_ups")} />
              ) : (
                <ol className="divide-y divide-border/40">
                  {[...overdueFU, ...todayFU, ...upcomingFU].map((f: any) => {
                    const isOverdue = f.status === "overdue" || (f.due_date && f.due_date < today);
                    return (
                      <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <StatusPill tone={isOverdue ? "attention" : "neutral"}>
                              {isOverdue ? (lang === "ar" ? "متأخر" : "Overdue") : humanize(f.status)}
                            </StatusPill>
                            <span className="truncate text-sm font-medium text-foreground">{oppName(f.opportunity_id)}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {humanize(f.channel)} · {t("label_tier")} {f.cadence_tier ?? "—"}{f.notes ? ` · ${f.notes}` : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground num">{f.due_date ?? "—"}</span>
                          {f.opportunity_id ? (
                            <button
                              type="button"
                              onClick={() => handleDraftFollowUp(f.id, f.opportunity_id, f.channel)}
                              disabled={draftLoading && draftFuId === f.id}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-border-strong hover:text-foreground disabled:opacity-50"
                            >
                              <Sparkles className="h-3 w-3" />
                              {lang === "ar" ? "مسودة" : "Draft"}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </ChartFrame>
          </TabsContent>

          <TabsContent value="action" className="mt-0">
            <ChartFrame title={t("nav_action_center")} subtitle={`${formatNumber(flags.length, lang)} ${lang === "ar" ? "بند" : "flagged"}`} padded={false}>
              <List
                empty={t("wf_no_records")}
                items={flags.map((f: any) => ({
                  key: f.id,
                  primary: f.reason ?? humanize(f.action_type ?? f.flag_kind),
                  secondary: `${humanize(f.linked_record_type)} · ${f.priority ?? ""}`,
                  tone: f.flag_kind === "risk" ? "danger" : "attention",
                  label: humanize(f.action_type ?? f.risk_flag ?? f.flag_kind),
                  right: f.due_date ?? "—",
                }))}
              />
            </ChartFrame>
          </TabsContent>

          <TabsContent value="approvals" className="mt-0">
            <ChartFrame title={t("nav_approvals")} subtitle={`${formatNumber(myApprovals.length, lang)} ${lang === "ar" ? "قرار" : "pending"}`} padded={false}>
              <List
                empty={t("empty_approvals")}
                items={myApprovals.map((a: any) => ({
                  key: a.id,
                  primary: oppName(a.related_opportunity_id),
                  secondary: humanize(a.approval_type),
                  tone: "attention",
                  label: humanize(a.status),
                  right: new Date(a.created_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric" }),
                  href: a.related_opportunity_id ? { to: "/opportunities/$id" as const, params: { id: a.related_opportunity_id } } : undefined,
                }))}
              />
            </ChartFrame>
          </TabsContent>

          <TabsContent value="rfqs" className="mt-0">
            <ChartFrame title={t("ws_my_rfqs")} subtitle={`${formatNumber(myRfqs.length, lang)} ${t("ws_rfqs_open")}`} padded={false}>
              <List
                empty={t("ws_none")}
                items={myRfqs.map((r: any) => ({
                  key: r.id,
                  primary: r.rfq_number || "—",
                  secondary: humanize(r.status),
                  tone: r.response_due_date && r.response_due_date < today ? "attention" : "neutral",
                  label: r.response_due_date && r.response_due_date < today ? (lang === "ar" ? "متأخر" : "Overdue") : humanize(r.status),
                  right: formatCurrency(r.estimated_value, lang, "SAR"),
                }))}
              />
            </ChartFrame>
          </TabsContent>

          <TabsContent value="tenders" className="mt-0">
            <ChartFrame title={t("ws_my_tenders")} subtitle={`${formatNumber(myTenders.length, lang)} ${t("ws_tenders_active")}`} padded={false}>
              <List
                empty={t("ws_none")}
                items={myTenders.map((tn: any) => ({
                  key: tn.id,
                  primary: tn.tender_name,
                  secondary: `${t(`tstage_${tn.tender_stage}` as never)}${tn.tender_priority_classification ? ` · ${t("label_tier")} ${tn.tender_priority_classification}` : ""}`,
                  tone: "muted",
                  label: tn.tender_priority_classification ?? humanize(tn.tender_stage),
                  right: formatCurrency(tn.estimated_project_value, lang, "SAR"),
                }))}
              />
            </ChartFrame>
          </TabsContent>

          <TabsContent value="jih" className="mt-0">
            <ChartFrame title={t("ws_jih_summary")} subtitle={formatCurrency(jihOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0), lang, "SAR")} padded={false}>
              <List
                empty={t("ws_none")}
                items={jihOpps.map((o: any) => ({
                  key: o.id,
                  primary: o.project_name,
                  secondary: t(`sstage_${o.sales_stage}` as never),
                  tone: o.win_confidence === "sure_win" ? "positive" : o.win_confidence === "strong" ? "attention" : "neutral" as any,
                  label: t(`sstage_${o.sales_stage}` as never),
                  right: formatCurrency(o.estimated_value_max, lang, o.currency),
                  href: { to: "/opportunities/$id" as const, params: { id: o.id } },
                }))}
              />
            </ChartFrame>
          </TabsContent>

          <TabsContent value="quotations" className="mt-0">
            <ChartFrame title={t("ws_urgent_quotations")} subtitle={`${formatNumber(urgentQuotations.length, lang)} ${lang === "ar" ? "عرض" : "quotations"}`} padded={false}>
              <List
                empty={t("ws_none")}
                items={urgentQuotations.map((q: any) => ({
                  key: q.id,
                  primary: q.related_opportunity_id ? oppName(q.related_opportunity_id) : "—",
                  secondary: humanize(q.status),
                  tone: q.valid_until && q.valid_until <= today ? "danger" : "attention" as any,
                  label: t("ws_quotation_due"),
                  right: q.valid_until ?? "—",
                }))}
              />
            </ChartFrame>
          </TabsContent>
        </Tabs>
      </section>

      <ActionDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        title={t("ws_log_activity")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "type", type: "select", label: t("crm_filter_all_types"), required: true, defaultValue: "call", options: ACTIVITY_TYPES.map((a) => ({ value: a, label: t(`activity_type_${a}` as never) })) },
          { key: "opportunityId", type: "select", label: t("crm_linked_opportunities"), options: [{ value: "", label: "—" }, ...myOpps.map((o: any) => ({ value: o.id, label: o.project_name }))] },
          { key: "summary", type: "text", label: t("activity_summary") },
          { key: "draftContent", type: "textarea", label: t("activity_draft_body") },
        ]}
        onSubmit={async (v) => {
          try {
            await logActivity({
              type: v.type as ActivityType,
              opportunityId: v.opportunityId || null,
              summary: v.summary || undefined,
              draftContent: v.draftContent || undefined,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["workspace", uid] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={!!completeFor}
        onOpenChange={(v) => !v && setCompleteFor(null)}
        title={t("dialog_complete_title")}
        description={t("dialog_complete_desc")}
        submitLabel={t("action_complete")}
        fields={[{ key: "outcome", type: "textarea", label: t("field_outcome"), required: true }]}
        onSubmit={async (v) => {
          try {
            await completeFollowUp({
              followUpId: completeFor!.id,
              opportunityId: completeFor!.oppId,
              outcome: v.outcome,
            });
            toast.success(t("toast_complete_ok"));
            qc.invalidateQueries({ queryKey: ["workspace", uid] });
            qc.invalidateQueries({ queryKey: ["all-followups"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      {/* Draft follow-up modal */}
      <AlertDialog open={draftOpen} onOpenChange={setDraftOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{lang === "ar" ? "مسودة المتابعة" : "Follow-up Draft"}</AlertDialogTitle>
            <AlertDialogDescription>{lang === "ar" ? "مسودة مقترحة من الذكاء الاصطناعي — راجعها قبل الإرسال." : "AI-suggested draft — review before sending."}</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={10}
            className="mt-2 w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground focus:border-border-strong focus:outline-none"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{lang === "ar" ? "إغلاق" : "Close"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (draftContent) {
                  navigator.clipboard.writeText(draftContent).then(() =>
                    toast.success(lang === "ar" ? "تم النسخ" : "Copied to clipboard"),
                  ).catch(() => {});
                }
                setDraftOpen(false);
              }}
            >
              {lang === "ar" ? "نسخ" : "Copy"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ActionDialog
        open={!!rescheduleFor}
        onOpenChange={(v) => !v && setRescheduleFor(null)}
        title={lang === "ar" ? "إعادة جدولة المتابعة" : "Reschedule Follow-up"}
        description={lang === "ar" ? "اختر تاريخاً جديداً للمتابعة." : "Pick a new due date for this follow-up."}
        submitLabel={lang === "ar" ? "إعادة الجدولة" : "Reschedule"}
        fields={[
          {
            key: "dueDate",
            type: "date",
            label: lang === "ar" ? "التاريخ الجديد" : "New date",
            required: true,
            defaultValue: rescheduleFor?.currentDate ?? "",
          },
          { key: "notes", type: "textarea", label: lang === "ar" ? "ملاحظات (اختياري)" : "Notes (optional)" },
        ]}
        onSubmit={async (v) => {
          try {
            await rescheduleFollowUp({
              followUpId: rescheduleFor!.id,
              opportunityId: rescheduleFor!.oppId,
              dueDate: v.dueDate,
              notes: v.notes || undefined,
            });
            toast.success(lang === "ar" ? "تمت إعادة الجدولة." : "Follow-up rescheduled.");
            qc.invalidateQueries({ queryKey: ["workspace", uid] });
            qc.invalidateQueries({ queryKey: ["all-followups"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}

function TabItem({ value, icon, label, count }: { value: string; icon: React.ReactNode; label: string; count: number }) {
  return (
    <TabsTrigger
      value={value}
      className="h-8 gap-2 rounded-md px-3 text-[12px] font-medium data-[state=active]:bg-surface-2 data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {icon}
      <span>{label}</span>
      <span className="num rounded-full bg-surface-2 px-1.5 py-0 text-[10px] text-muted-foreground data-[state=active]:bg-foreground/10" data-tabular="true">
        {count}
      </span>
    </TabsTrigger>
  );
}

/**
 * Sprint 1 target snapshot — placeholder-honest: shows the configured target
 * for the period, and the tracked actual only where we already compute one
 * cheaply (pipeline value, activity count). Dimensions without a wired
 * actual-so-far metric show ws_actual_not_tracked rather than a fabricated
 * number.
 */
function TargetMetric({
  label,
  target,
  actual,
  lang,
  isCount = false,
}: {
  label: string;
  target: number | null | undefined;
  actual: number | undefined;
  lang: Lang;
  isCount?: boolean;
}) {
  const { t } = useI18n();
  const format = (n: number) => (isCount ? formatNumber(n, lang) : formatCurrency(n, lang, "SAR"));
  return (
    <div className="rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className="num mt-1.5 text-[18px] font-semibold text-foreground" data-tabular="true">
        {target != null ? format(target) : "—"}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {actual != null ? `${format(actual)} ${t("ws_of")} ${lang === "ar" ? "الهدف" : "target"}` : t("ws_actual_not_tracked")}
      </div>
    </div>
  );
}

type ListItem = {
  key: string;
  primary: string;
  secondary?: string;
  tone?: "attention" | "neutral" | "muted" | "danger" | "positive";
  label?: string;
  right?: string;
  href?: { to: "/opportunities/$id"; params: { id: string } };
};

function List({ items, empty }: { items: ListItem[]; empty: string }) {
  if (items.length === 0) {
    return (
      <div className="px-5 py-8"><EmptyState message={empty} /></div>
    );
  }
  return (
    <ul>
      {items.map((it) => {
        const inner = (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-t border-border/60 px-5 py-3 first:border-t-0">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-foreground">{it.primary}</div>
              {it.secondary ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{it.secondary}</div> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {it.label ? <StatusPill tone={(it.tone as any) ?? "muted"}>{it.label}</StatusPill> : null}
              {it.right ? <span className="num text-[11px] text-muted-foreground" data-tabular="true">{it.right}</span> : null}
            </div>
          </div>
        );
        return (
          <li key={it.key} className="transition-colors hover:bg-surface-2/40">
            {it.href ? <Link to={it.href.to} params={it.href.params} className="block">{inner}</Link> : inner}
          </li>
        );
      })}
    </ul>
  );
}
