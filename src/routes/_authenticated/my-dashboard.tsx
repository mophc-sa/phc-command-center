import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Target, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { riyadhDay } from "@/lib/riyadh-day";
import { fetchAllRows } from "@/lib/fetch-all";
import { targetKpis, targetForPeriod, yearToDate, type OppRow, type TargetRow } from "@/lib/sales-kpis";
import { rfqIntake, toRec, verbalAwards, type ClosingOpp } from "@/lib/board-closing";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiRow } from "@/components/phc/KpiRow";
import { KpiTile } from "@/components/phc/KpiTile";
import { KpiCard } from "@/components/phc/KpiCard";
import { CloseList } from "@/components/phc/CloseList";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { SkeletonTable } from "@/components/phc/Skeleton";

// The salesperson's own dashboard (Mo, 2026-11-18): the manager's image-04
// layout, for one person — their target, their signed sales, their verbal
// awards, their active deals and RFQs, and the two lists they act on.
export const Route = createFileRoute("/_authenticated/my-dashboard")({
  head: () => ({ meta: [{ title: "My dashboard — PHC" }, { name: "robots", content: "noindex" }] }),
  component: MyDashboard,
});

const COLS =
  "id, project_name, client, stage, sales_stage, quotation_value, contract_value, estimated_value_max, currency, owner_id, next_action, next_action_due, last_activity_at, won_at, lost_at, contract_received_date, contract_signed_date, hold_reason, hold_from_stage, created_at, extra_data";

function MyDashboard() {
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const { lang } = useI18n();
  const ar = lang === "ar";
  const today = riyadhDay();
  const year = today.slice(0, 4);
  const q = useQuery({
    queryKey: ["my-dashboard", uid],
    enabled: !!uid,
    queryFn: async () => {
      const [opps, targets] = await Promise.all([
        fetchAllRows(() => supabase.from("opportunities").select(COLS).eq("owner_id", uid).neq("stage", "archived").order("id")),
        supabase.from("sales_targets").select("user_id, period_type, period_start, sales_target").eq("user_id", uid),
      ]);
      if (targets.error) throw targets.error;
      return { opps: opps.rows as unknown as OppRow[], targets: (targets.data ?? []) as TargetRow[] };
    },
  });
  if (q.error) return <QueryFailure retry={() => void q.refetch()} />;
  if (!q.data) return <SkeletonTable rows={3} />;

  const ctx = { today, period: yearToDate(today), ownerId: uid };
  const target = targetForPeriod(q.data.targets, ctx.period);
  const t = targetKpis(q.data.opps, ctx, target);
  const recs = q.data.opps.map((o) => toRec(o as unknown as ClosingOpp));
  const v = verbalAwards(recs);
  const rfq = rfqIntake(recs, today);
  const active = recs.filter((r) => r.open && !r.held);
  const client = (id: string) => (q.data.opps.find((o) => o.id === id) as { client?: string | null } | undefined)?.client ?? "—";
  const period = ar ? `العام ${year}` : `Year ${year}`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow={ar ? "لوحتي" : "My dashboard"} title={ar ? "أدائي ومبيعاتي" : "My sales and performance"} description={ar ? "هدفك، ما تعاقدت عليه، وما يحتاج إغلاقًا ومتابعة." : "Your target, what you have signed, and what needs closing and following up."} />
      <KpiRow columns={6}>
        <KpiTile size="lead" kpi={t.target} label={ar ? "هدفي السنوي" : "My annual target"} hint={period} accent="count" icon={<Target className="h-4 w-4" />} />
        <KpiTile size="lead" kpi={t.actual} label={ar ? "مبيعاتي المتعاقد عليها" : "My signed sales"} hint={period} accent="won" icon={<Wallet className="h-4 w-4" />} />
        <KpiTile size="lead" kpi={t.achievement} label={ar ? "نسبة التحقيق" : "Achievement"} hint={period} accent="won" icon={<Target className="h-4 w-4" />} />
        <KpiCard label={ar ? "ترسياتي الشفهية" : "My verbal awards"} value={formatCurrency(v.all.value, lang, "SAR")} hint={ar ? `${v.all.count} صفقة — ليست مبيعات بعد` : `${v.all.count} deals — not sales yet`} />
        <KpiCard label={ar ? "فرصي النشطة" : "My active opportunities"} value={formatNumber(active.length, lang)} hint={formatCurrency(active.reduce((a, r) => a + (r.value ?? 0), 0), lang, "SAR")} />
        <KpiCard label={ar ? "طلبات تسعير آخر 30 يومًا" : "RFQs last 30 days"} value={formatNumber(rfq.last30.count, lang)} hint={ar ? "حسب تاريخ الاستلام" : "By received date"} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <CloseList
          title={ar ? "ترسيات شفهية تحتاج إغلاقًا" : "Verbal awards to close"}
          empty={ar ? "لا ترسيات شفهية مفتوحة." : "No open verbal awards."}
          head={[ar ? "الفرصة" : "Opportunity", ar ? "العميل" : "Account", ar ? "القيمة" : "Amount", ar ? "الخطوة التالية" : "Next step"]}
          rows={v.all.rows.slice(0, 8).map((r) => ({
            id: r.id, project: r.project, account: client(r.id), third: formatCurrency(r.value ?? r.quoted, lang, "SAR"),
            fourth: r.nextAction ?? (ar ? "سجّل العقد أو أمر الشراء" : "Record the contract or PO"),
          }))}
        />
        <CloseList
          title={ar ? "متابعاتي المتأخرة" : "My overdue follow-ups"}
          empty={ar ? "لا متابعات متأخرة." : "Nothing overdue."}
          head={[ar ? "الفرصة" : "Opportunity", ar ? "العميل" : "Account", ar ? "متأخرة منذ" : "Due since", ""]}
          rows={recs
            .filter((r) => r.open && r.nextActionDate && r.nextActionDate < today)
            .sort((a, b) => (a.nextActionDate ?? "").localeCompare(b.nextActionDate ?? ""))
            .slice(0, 8)
            .map((r) => {
              const days = Math.round((Date.parse(today) - Date.parse(r.nextActionDate!)) / 86_400_000);
              return { id: r.id, project: r.project, account: client(r.id), third: ar ? `${days} يومًا` : `${days} days`, fourth: ar ? "متابعة" : "Follow up", action: true };
            })}
        />
      </div>
    </div>
  );
}
