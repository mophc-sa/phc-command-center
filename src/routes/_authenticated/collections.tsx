import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/phc/EmptyState";
import { PageHeader } from "@/components/phc/PageHeader";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n, formatNumber } from "@/lib/i18n";
import { TIER_LABEL, canSeeCollections } from "@/lib/contract-billing";
import { listAllDuesToInvoice, listBillingSummaries, listContractDeals, listReceivables } from "@/lib/contract-terms-actions";
import { pick, type Bi } from "@/lib/pricing-text";

// B3 (2026-11-12): every open invoice across deals, most late first, for
// finance and management. The figures and who may read them are SQL's
// (contract_receivables, contract_billing_summary; the contracts' row security).
export const Route = createFileRoute("/_authenticated/collections")({
  head: () => ({ meta: [{ title: "Collections — PHC" }, { name: "robots", content: "noindex" }] }),
  component: CollectionsPage,
});

const TEXT = {
  eyebrow: { en: "Pricing & Finance", ar: "التسعير والمالية" },
  title: { en: "Collections", ar: "التحصيل" },
  desc: { en: "Open invoices across all deals, most late first. Record receipts and claims on the deal.", ar: "الفواتير المفتوحة في كل الصفقات، الأكثر تأخراً أولاً. تُسجَّل المقبوضات والمطالبات في الصفقة." },
  noAccess: { en: "Collections are for finance and management.", ar: "التحصيل للمالية والإدارة." },
  outstanding: { en: "Outstanding (incl. VAT)", ar: "المتبقي للتحصيل (شامل الضريبة)" },
  late: { en: "Late", ar: "المتأخر" },
  notInvoiced: { en: "Due, not invoiced (excl. VAT)", ar: "مستحق غير مفوتر (بدون ضريبة)" },
  deal: { en: "Deal", ar: "الصفقة" },
  invoice: { en: "Invoice", ar: "الفاتورة" },
  dueOn: { en: "Due", ar: "الاستحقاق" },
  status: { en: "Status", ar: "الحالة" },
  none: { en: "No open invoices.", ar: "لا توجد فواتير مفتوحة." },
  toInvoice: { en: "Due, waiting to be invoiced", ar: "مستحق بانتظار الفوترة" },
  toInvoiceHint: { en: "Issue the tax invoice in the accounting system, then record it on the deal.", ar: "أصدر الفاتورة الضريبية من النظام المحاسبي ثم سجّلها في الصفقة." },
  amountExcl: { en: "Amount (excl. VAT)", ar: "المبلغ (بدون ضريبة)" },
  overdue: { en: "Past its date", ar: "تجاوز تاريخه" },
  openInvoices: { en: "Open invoices", ar: "الفواتير المفتوحة" },
} satisfies Record<string, Bi>;
const TONE = { 0: "neutral", 1: "attention", 2: "danger", 3: "danger" } as const;

function CollectionsPage() {
  const { lang } = useI18n();
  const { roles } = useAuth();
  const allowed = canSeeCollections(roles);
  const rec = useQuery({ queryKey: ["contract-collections"], queryFn: () => listReceivables(), enabled: allowed });
  const sums = useQuery({ queryKey: ["contract-collections-sums"], queryFn: listBillingSummaries, enabled: allowed });
  const dues = useQuery({ queryKey: ["contract-collections-dues"], queryFn: listAllDuesToInvoice, enabled: allowed });
  const dueContracts = [...new Set((dues.data ?? []).map((d) => d.contract_id))];
  const dueDeals = useQuery({
    queryKey: ["contract-collections-due-deals", dueContracts.join(",")],
    queryFn: () => listContractDeals(dueContracts),
    enabled: dueContracts.length > 0,
  });
  const ids = [...new Set([...(rec.data ?? []).map((r) => r.opportunity_id), ...(dueDeals.data?.values() ?? [])])];
  const names = useQuery({
    queryKey: ["contract-collections-deals", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("opportunities").select("id, project_name").in("id", ids);
      return new Map((data ?? []).map((o) => [o.id, o.project_name as string]));
    },
  });
  const money = (n: number) => formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!allowed) return <EmptyState title={pick(TEXT.noAccess, lang)} />;
  if (rec.isLoading || sums.isLoading) return <SkeletonTable />;
  if (rec.error || sums.error) return <QueryFailure retry={() => { void rec.refetch(); void sums.refetch(); }} />;
  const rows = rec.data ?? [];
  const totalOut = rows.reduce((s, r) => s + Number(r.outstanding), 0);
  const totalLate = rows.filter((r) => r.days_late > 0).reduce((s, r) => s + Number(r.outstanding), 0);
  const notInvoiced = (sums.data ?? []).reduce((s, r) => s + Number(r.amount_not_invoiced), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader eyebrow={pick(TEXT.eyebrow, lang)} title={pick(TEXT.title, lang)} description={pick(TEXT.desc, lang)} />
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {([[TEXT.outstanding, totalOut], [TEXT.late, totalLate], [TEXT.notInvoiced, notInvoiced]] as const).map(([l, v]) => (
          <div key={l.en} className="rounded-lg border border-border/70 bg-surface/60 p-4">
            <dt className="text-sm text-muted-foreground">{pick(l, lang)}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{money(v)}</dd>
          </div>
        ))}
      </dl>
      {(dues.data ?? []).length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">{pick(TEXT.toInvoice, lang)}</h2>
          <p className="text-sm text-muted-foreground">{pick(TEXT.toInvoiceHint, lang)}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(TEXT.deal, lang)}</TableHead>
                <TableHead>{pick(TEXT.dueOn, lang)}</TableHead>
                <TableHead className="text-end">{pick(TEXT.amountExcl, lang)}</TableHead>
                <TableHead>{pick(TEXT.status, lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(dues.data ?? []).map((d) => {
                const opp = dueDeals.data?.get(d.contract_id);
                const today = new Date().toISOString().slice(0, 10);
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      {opp ? <Link to="/opportunities/$id" params={{ id: opp }} className="hover:underline">{names.data?.get(opp) ?? "—"}</Link> : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">{d.due_on}</TableCell>
                    <TableCell className="text-end tabular-nums">{money(Number(d.amount))}</TableCell>
                    <TableCell>{d.due_on < today ? <StatusPill tone="attention">{pick(TEXT.overdue, lang)}</StatusPill> : null}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      ) : null}
      <h2 className="text-base font-semibold">{pick(TEXT.openInvoices, lang)}</h2>
      {rows.length === 0 ? (
        <EmptyState title={pick(TEXT.none, lang)} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.deal, lang)}</TableHead>
              <TableHead>{pick(TEXT.invoice, lang)}</TableHead>
              <TableHead>{pick(TEXT.dueOn, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.outstanding, lang)}</TableHead>
              <TableHead>{pick(TEXT.status, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.invoice_id}>
                <TableCell>
                  <Link to="/opportunities/$id" params={{ id: r.opportunity_id }} className="hover:underline">
                    {names.data?.get(r.opportunity_id) ?? "—"}
                  </Link>
                </TableCell>
                <TableCell className="font-medium">{r.invoice_number}</TableCell>
                <TableCell className="tabular-nums">{r.due_on}</TableCell>
                <TableCell className="text-end tabular-nums">{money(Number(r.outstanding))}</TableCell>
                <TableCell>
                  <StatusPill tone={TONE[r.tier]}>{pick(TIER_LABEL[r.tier], lang)}{r.days_late > 0 ? ` · ${r.days_late}` : ""}</StatusPill>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
