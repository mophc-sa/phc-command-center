import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, ArrowRight, Briefcase, Target, TrendingUp, Users, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n, formatCurrency, formatNumber, localeFor } from "@/lib/i18n";
import { riyadhDay, addDays } from "@/lib/riyadh-day";
import { fetchAllRows } from "@/lib/fetch-all";
import { companyTargetSum, executiveKpis, forecastVsTarget, thisMonth, yearToDate, type OppRow } from "@/lib/sales-kpis";
import { canSeeCommandCenter, type AppRole } from "@/lib/roles";
import { canSeeCollections } from "@/lib/contract-billing";
import { canSeePricingNav } from "@/lib/pricing-access";
import { listBillingSummaries, listProfit, listReceivables } from "@/lib/contract-terms-actions";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiTile } from "@/components/phc/KpiTile";
import { KpiRow } from "@/components/phc/KpiRow";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { ProjectProgressPanel } from "@/components/phc/ProjectProgressPanel";
import { KpiCard } from "@/components/phc/KpiCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rfqIntake, toRec, verbalAwards, type ClosingOpp } from "@/lib/board-closing";
import "@/styles/command-center.css";

// The company-wide report (2026-11-17): sales summary, projects and finance,
// clients and team. Sales detail (reps, follow-ups, RFQ age, priorities, data
// quality, the brief) moved to /sales-management?tab=operations.
export const Route = createFileRoute("/_authenticated/command-center")({
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return; // parent _authenticated guard handles the redirect
    const { data: rolesRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const roles = (rolesRows ?? []).map((r) => r.role as AppRole);
    if (!canSeeCommandCenter(roles)) throw redirect({ to: "/my-workspace" });
  },
  head: () => ({
    meta: [
      { title: "Command Center — PHC" },
      { name: "description", content: "Company report: sales, projects, finance, clients and team." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CommandCenter,
});

const OPP_COLS =
  "id, project_name, client, stage, sales_stage, tier, score, estimated_value_min, estimated_value_max, quotation_value, contract_value, currency, owner_id, human_win_probability, loss_reason, lost_at_stage, lost_to_competitor, expected_contract_date, last_activity_at, won_at, lost_at, contract_received_date, contract_signed_date, next_action, next_action_due, hold_reason, updated_at, created_at, extra_data";

/** Exact row count, or null when the table cannot be read (never a silent 0). */
async function count(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  const { count: n, error } = await q;
  return error ? null : (n ?? 0);
}

function CommandCenter() {
  const { roles } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const today = riyadhDay();
  const since = addDays(today, -29);
  const financeAllowed = canSeeCollections(roles);
  const profitAllowed = canSeePricingNav(roles);

  const sales = useQuery({
    queryKey: ["cc-company-sales"],
    staleTime: 60_000,
    queryFn: async () => {
      const annYear = `${today.slice(0, 4)}-01-01`;
      const monthStart = `${today.slice(0, 7)}-01`;
      const [opps, annual, monthly] = await Promise.all([
        fetchAllRows(() => supabase.from("opportunities").select(OPP_COLS)),
        supabase.from("sales_targets").select("user_id, sales_target").eq("period_type", "annual").eq("period_start", annYear),
        supabase.from("sales_targets").select("user_id, sales_target").eq("period_type", "monthly").eq("period_start", monthStart),
      ]);
      if (annual.error) throw annual.error;
      if (monthly.error) throw monthly.error;
      const sum = companyTargetSum;
      const annualSum = sum(annual.data);
      return {
        opps: opps.rows as unknown as OppRow[],
        complete: opps.complete,
        target: annualSum > 0 ? annualSum : sum(monthly.data),
        annual: annualSum > 0,
      };
    },
  });

  const people = useQuery({
    queryKey: ["cc-company-people", today],
    staleTime: 60_000,
    queryFn: async () => {
      const [companies, contacts, newLeads, activities, meetings, pendingItems, overdueTasks, overdueFollowUps] =
        await Promise.all([
          count(supabase.from("companies").select("id", { count: "exact", head: true }).is("archived_at", null)),
          count(supabase.from("contacts").select("id", { count: "exact", head: true })),
          count(supabase.from("leads").select("id", { count: "exact", head: true }).is("archived_at", null).gte("created_at", since)),
          count(supabase.from("activities").select("id", { count: "exact", head: true }).gte("occurred_at", since)),
          count(supabase.from("meetings").select("id", { count: "exact", head: true }).gte("occurred_at", since)),
          count(supabase.from("meeting_action_items").select("id", { count: "exact", head: true }).eq("status", "pending")),
          count(supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open").lt("due_date", today)),
          count(supabase.from("follow_ups").select("id", { count: "exact", head: true }).neq("status", "completed").lt("due_date", today)),
        ]);
      return { companies, contacts, newLeads, activities, meetings, pendingItems, overdueTasks, overdueFollowUps };
    },
  });

  const finance = useQuery({
    queryKey: ["cc-company-finance"],
    staleTime: 60_000,
    enabled: financeAllowed,
    queryFn: async () => {
      const [rec, sums] = await Promise.all([listReceivables(), listBillingSummaries()]);
      return {
        outstanding: rec.reduce((s, r) => s + Number(r.outstanding), 0),
        late: rec.filter((r) => r.days_late > 0).reduce((s, r) => s + Number(r.outstanding), 0),
        notInvoiced: sums.reduce((s, r) => s + Number(r.amount_not_invoiced), 0),
        contracts: sums.length,
      };
    },
  });

  const profit = useQuery({
    queryKey: ["cc-company-profit"],
    staleTime: 60_000,
    enabled: profitAllowed,
    queryFn: async () => {
      const rows = await listProfit();
      return {
        contracts: rows.length,
        sold: rows.reduce((s, r) => s + Number(r.sold), 0),
        netProfit: rows.reduce((s, r) => s + Number(r.net_profit), 0),
      };
    },
  });

  const kpis = useMemo(() => {
    if (!sales.data) return null;
    const ctx = { today, period: sales.data.annual ? yearToDate(today) : thisMonth(today) };
    return {
      forecast: forecastVsTarget(sales.data.opps, ctx, sales.data.target > 0 ? sales.data.target : null),
      exec: executiveKpis(sales.data.opps, ctx),
      // Image 04: verbal awards to close and RFQs by their received date.
      recs: sales.data.opps.map((o) => toRec(o as unknown as ClosingOpp)),
    };
  }, [sales.data, today]);

  if (sales.isError || people.isError)
    return <QueryFailure retry={() => Promise.all([sales.refetch(), people.refetch()])} />;

  const periodLabel = sales.data?.annual
    ? ar
      ? `العام ${today.slice(0, 4)}`
      : `Year ${today.slice(0, 4)}`
    : new Date(`${today.slice(0, 7)}-01T12:00:00`).toLocaleDateString(localeFor(lang), { month: "long", year: "numeric" });
  const Arrow = ar ? ArrowLeft : ArrowRight;
  const money = (n: number) => formatCurrency(n, lang);
  const p = people.data;

  return (
    <div className="executive-command mx-auto max-w-7xl space-y-8" dir={ar ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={ar ? "الإدارة العامة" : "General management"}
        title={ar ? "مركز القيادة" : "Command Center"}
        description={
          ar
            ? "تقرير الشركة الشامل: المبيعات، المشاريع والمالية، العملاء والفريق."
            : "The company report: sales, projects and finance, clients and team."
        }
        actions={
          <button
            type="button"
            className="executive-action"
            disabled={sales.isFetching || people.isFetching}
            onClick={() => void Promise.all([sales.refetch(), people.refetch(), finance.refetch(), profit.refetch()])}
          >
            {sales.isFetching ? (ar ? "جارٍ التحديث…" : "Refreshing…") : ar ? "تحديث البيانات" : "Refresh data"}
          </button>
        }
      />

      {/* 1 · Sales summary */}
      <section aria-labelledby="cc-sales" className="space-y-3">
        <SectionHead
          id="cc-sales"
          title={ar ? "ملخص المبيعات" : "Sales summary"}
          hint={periodLabel}
          link={{ to: "/sales-management", label: ar ? "تفاصيل إدارة المبيعات" : "Sales management detail" }}
          Arrow={Arrow}
        />
        {!kpis ? (
          <SkeletonTable rows={2} />
        ) : (
          <>
            {/* Image 04: six figures, then the two lists the manager acts on. */}
            {(() => {
              const v = verbalAwards(kpis.recs);
              const rfq = rfqIntake(kpis.recs, today);
              const active = kpis.recs.filter((r) => r.open && !r.held);
              return (
                <KpiRow className="executive-scorecard" columns={6}>
                  <KpiTile size="lead" kpi={kpis.forecast.target} label={ar ? "الهدف السنوي" : "Annual target"} hint={periodLabel} accent="count" icon={<Target className="h-4 w-4" />} />
                  <KpiTile size="lead" kpi={kpis.forecast.won} label={ar ? "المبيعات المتعاقد عليها" : "Signed sales"} hint={periodLabel} accent="won" icon={<Wallet className="h-4 w-4" />} />
                  <KpiTile size="lead" kpi={kpis.forecast.achievement} label={ar ? "نسبة التحقيق" : "Achievement"} hint={periodLabel} accent="won" icon={<Target className="h-4 w-4" />} />
                  <KpiCard label={ar ? "ترسيات شفهية" : "Verbal awards"} value={formatCurrency(v.all.value, lang, "SAR")} hint={ar ? `${v.all.count} صفقة — ليست مبيعات بعد` : `${v.all.count} deals — not sales yet`} />
                  <KpiCard label={ar ? "الفرص النشطة" : "Active opportunities"} value={formatNumber(active.length, lang)} hint={formatCurrency(active.reduce((a, r) => a + (r.value ?? 0), 0), lang, "SAR")} />
                  <KpiCard label={ar ? "طلبات تسعير آخر 30 يومًا" : "RFQs last 30 days"} value={formatNumber(rfq.last30.count, lang)} hint={ar ? "حسب تاريخ الاستلام" : "By received date"} />
                </KpiRow>
              );
            })()}
            <div className="grid gap-4 lg:grid-cols-2">
              <CloseList
                title={ar ? "ترسيات شفهية تحتاج إغلاقًا" : "Verbal awards to close"}
                empty={ar ? "لا ترسيات شفهية مفتوحة." : "No open verbal awards."}
                head={[ar ? "الفرصة" : "Opportunity", ar ? "العميل" : "Account", ar ? "القيمة" : "Amount", ar ? "الخطوة التالية" : "Next step"]}
                rows={verbalAwards(kpis.recs).all.rows.slice(0, 6).map((r) => ({
                  id: r.id, project: r.project, account: (sales.data!.opps.find((o) => o.id === r.id) as { client?: string | null } | undefined)?.client ?? "—",
                  third: formatCurrency(r.value ?? r.quoted, lang, "SAR"), fourth: r.nextAction ?? (ar ? "سجّل العقد أو أمر الشراء" : "Record the contract or PO"),
                }))}
              />
              <CloseList
                title={ar ? "متابعات متأخرة" : "Overdue follow-ups"}
                empty={ar ? "لا متابعات متأخرة." : "Nothing overdue."}
                head={[ar ? "الفرصة" : "Opportunity", ar ? "العميل" : "Account", ar ? "متأخرة منذ" : "Due since", ""]}
                rows={kpis.recs
                  .filter((r) => r.open && r.nextActionDate && r.nextActionDate < today)
                  .sort((a, b) => (a.nextActionDate ?? "").localeCompare(b.nextActionDate ?? ""))
                  .slice(0, 6)
                  .map((r) => ({
                    id: r.id, project: r.project, account: (sales.data!.opps.find((o) => o.id === r.id) as { client?: string | null } | undefined)?.client ?? "—",
                    third: ar ? `${Math.round((Date.parse(today) - Date.parse(r.nextActionDate!)) / 86_400_000)} يومًا` : `${Math.round((Date.parse(today) - Date.parse(r.nextActionDate!)) / 86_400_000)} days`,
                    fourth: ar ? "متابعة" : "Follow up", action: true,
                  }))}
              />
            </div>
            <KpiRow columns={3}>
              <KpiTile kpi={kpis.forecast.forecast} label={ar ? "التوقع المرجّح" : "Weighted forecast"} accent="money" />
              <KpiTile kpi={kpis.exec.winRate} label={ar ? "معدل الفوز" : "Win rate"} accent="won" />
              <KpiTile kpi={kpis.exec.lostValue} label={ar ? "قيمة الخسائر" : "Lost value"} hint={periodLabel} accent="risk" />
            </KpiRow>
            {sales.data && !sales.data.complete && (
              <p className="text-sm text-amber-light">
                {ar ? "البيانات غير مكتملة؛ الأرقام على السجلات المتاحة فقط." : "Data is incomplete; figures cover the available records only."}
              </p>
            )}
          </>
        )}
      </section>

      {/* 2 · Projects and finance */}
      <section aria-labelledby="cc-projects" className="space-y-3">
        <SectionHead id="cc-projects" title={ar ? "المشاريع والمالية" : "Projects and finance"} Arrow={Arrow} />
        <KpiRow className="mb-0">
          {financeAllowed ? (
            <>
              <Stat icon={<Wallet className="h-4 w-4" />} label={ar ? "مستحق التحصيل" : "Outstanding receivables"} value={finance.data ? money(finance.data.outstanding) : null} loading={finance.isLoading} empty={finance.data?.contracts === 0} ar={ar} to="/collections" />
              <Stat label={ar ? "متأخر السداد" : "Late"} value={finance.data ? money(finance.data.late) : null} loading={finance.isLoading} empty={finance.data?.contracts === 0} ar={ar} to="/collections" tone={finance.data && finance.data.late > 0 ? "risk" : undefined} />
              <Stat label={ar ? "مستحق غير مفوتر" : "Not yet invoiced"} value={finance.data ? money(finance.data.notInvoiced) : null} loading={finance.isLoading} empty={finance.data?.contracts === 0} ar={ar} to="/collections" />
            </>
          ) : null}
          {profitAllowed ? (
            <Stat icon={<TrendingUp className="h-4 w-4" />} label={ar ? "صافي ربح العقود" : "Net contract profit"} value={profit.data ? money(profit.data.netProfit) : null} sub={profit.data && profit.data.contracts > 0 ? (ar ? `${formatNumber(profit.data.contracts, lang)} عقد · مبيعات ${money(profit.data.sold)}` : `${formatNumber(profit.data.contracts, lang)} contracts · sold ${money(profit.data.sold)}`) : undefined} loading={profit.isLoading} empty={profit.data?.contracts === 0} ar={ar} to="/project-profit" />
          ) : null}
        </KpiRow>
        {!financeAllowed && !profitAllowed && (
          <p className="text-sm text-muted-foreground">
            {ar ? "الأرقام المالية تظهر للمدير العام ومدير المالية فقط." : "Financial figures are shown to the general manager and finance only."}
          </p>
        )}
        <ProjectProgressPanel />
      </section>

      {/* 3 · Clients and team */}
      <section aria-labelledby="cc-people" className="space-y-3">
        <SectionHead id="cc-people" title={ar ? "العملاء والفريق" : "Clients and team"} hint={ar ? "آخر 30 يومًا حيث يُذكر" : "Last 30 days where stated"} Arrow={Arrow} />
        <KpiRow className="mb-0">
          <Stat icon={<Briefcase className="h-4 w-4" />} label={ar ? "الشركات النشطة" : "Active companies"} value={num(p?.companies, lang)} loading={people.isLoading} ar={ar} to="/accounts" />
          <Stat icon={<Users className="h-4 w-4" />} label={ar ? "جهات الاتصال" : "Contacts"} value={num(p?.contacts, lang)} loading={people.isLoading} ar={ar} to="/contacts" />
          <Stat label={ar ? "عملاء محتملون جدد · 30 يومًا" : "New leads · 30 days"} value={num(p?.newLeads, lang)} loading={people.isLoading} ar={ar} to="/lead-tender-inbox" />
          <Stat label={ar ? "أنشطة مسجّلة · 30 يومًا" : "Logged activities · 30 days"} value={num(p?.activities, lang)} loading={people.isLoading} ar={ar} />
          <Stat label={ar ? "اجتماعات · 30 يومًا" : "Meetings · 30 days"} value={num(p?.meetings, lang)} loading={people.isLoading} ar={ar} to="/meetings" />
          <Stat label={ar ? "بنود اجتماعات بانتظار القرار" : "Meeting items awaiting decision"} value={num(p?.pendingItems, lang)} loading={people.isLoading} ar={ar} to="/meetings" tone={p?.pendingItems ? "risk" : undefined} />
          <Stat label={ar ? "مهام متأخرة" : "Overdue tasks"} value={num(p?.overdueTasks, lang)} loading={people.isLoading} ar={ar} to="/action-center" tone={p?.overdueTasks ? "risk" : undefined} />
          <Stat label={ar ? "متابعات متأخرة" : "Overdue follow-ups"} value={num(p?.overdueFollowUps, lang)} loading={people.isLoading} ar={ar} to="/sales-management" tone={p?.overdueFollowUps ? "risk" : undefined} />
        </KpiRow>
      </section>
    </div>
  );
}

const num = (n: number | null | undefined, lang: "en" | "ar") => (n == null ? null : formatNumber(n, lang));

function CloseList({ title, empty, head, rows }: {
  title: string; empty: string; head: string[];
  rows: { id: string; project: string; account: string; third: string; fourth: string; action?: boolean }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-2 text-base font-semibold text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Table>
          <TableHeader><TableRow>{head.map((h, i) => <TableHead key={i}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Link to="/opportunities/$id" params={{ id: r.id }} className="font-medium text-foreground hover:underline">{r.project}</Link></TableCell>
                <TableCell className="text-muted-foreground">{r.account}</TableCell>
                <TableCell className="tabular-nums">{r.third}</TableCell>
                <TableCell>
                  {r.action ? (
                    <Link to="/opportunities/$id" params={{ id: r.id }} className="inline-flex min-h-8 items-center rounded-md border border-primary/50 px-3 text-sm font-medium hover:bg-primary/10">{r.fourth}</Link>
                  ) : (
                    <span className="text-sm text-primary">{r.fourth}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function SectionHead({ id, title, hint, link, Arrow }: { id: string; title: string; hint?: string; link?: { to: string; label: string }; Arrow: typeof ArrowRight }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id={id} className="text-xl font-semibold">{title}</h2>
        {hint ? <span className="rounded-full border border-border bg-surface px-3 py-0.5 text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {link ? (
        <Link to={link.to} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          {link.label} <Arrow className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function Stat(props: { label: string; value: string | null; sub?: string; icon?: React.ReactNode; loading?: boolean; empty?: boolean; tone?: "risk"; to?: string; ar: boolean }) {
  const { label, value, sub, icon, loading, empty, tone, to, ar } = props;
  const body = (
    <div className="h-full rounded-xl border border-border/70 bg-surface/60 p-4 transition-colors hover:border-border">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`num mt-2 text-2xl font-semibold leading-none ${tone === "risk" ? "text-amber-light" : "text-foreground"}`} data-tabular="true">
        {loading ? "…" : empty ? <span className="text-base font-normal text-muted-foreground">{ar ? "لا بيانات بعد" : "No data yet"}</span> : (value ?? "—")}
      </div>
      {sub && !empty ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
  return to ? <Link to={to} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">{body}</Link> : body;
}
