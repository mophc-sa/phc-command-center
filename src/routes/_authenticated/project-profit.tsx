import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/phc/EmptyState";
import { PageHeader } from "@/components/phc/PageHeader";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n, formatNumber } from "@/lib/i18n";
import { canSeePricingNav } from "@/lib/pricing-access";
import { isFinanceManager } from "@/lib/roles";
import { marginPct } from "@/lib/contract-billing";
import { getLateFinancingRate, listProfit, setFinanceSetting } from "@/lib/contract-terms-actions";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";

// B5 (2026-11-12): the management board the meeting asked for: sold, cost,
// collected, late, and profit after the cost of late collection. Cost readers
// only (contract_profit is gated on them in SQL).
export const Route = createFileRoute("/_authenticated/project-profit")({
  head: () => ({ meta: [{ title: "Project profit — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ProjectProfitPage,
});

const TEXT = {
  eyebrow: { en: "Pricing & Finance", ar: "التسعير والمالية" },
  title: { en: "Project profit", ar: "ربحية المشاريع" },
  desc: { en: "Each approved contract: what it sold for, what it costs, what was collected and what is late. Late collection costs money: net profit takes it off.", ar: "كل عقد معتمد: بكم بيع، وكم يكلّف، وكم حُصّل، وما المتأخر. تأخر التحصيل تكلفة: صافي الربح يخصمها." },
  noAccess: { en: "This page is for finance and management.", ar: "هذه الصفحة للمالية والإدارة." },
  none: { en: "No approved contracts yet.", ar: "لا توجد عقود معتمدة بعد." },
  deal: { en: "Deal", ar: "الصفقة" },
  sold: { en: "Sold", ar: "البيع" },
  cost: { en: "Expected cost", ar: "التكلفة المتوقعة" },
  gross: { en: "Gross profit", ar: "الربح الإجمالي" },
  financing: { en: "Late cost", ar: "تكلفة التأخير" },
  net: { en: "Net profit", ar: "صافي الربح" },
  collected: { en: "Collected", ar: "المحصّل" },
  late: { en: "Late", ar: "المتأخر" },
  total: { en: "Total", ar: "الإجمالي" },
  rate: { en: "Cost of late collection: % a month", ar: "تكلفة تأخر التحصيل: % شهرياً" },
  save: { en: "Save", ar: "حفظ" },
  saved: { en: "Rate saved", ar: "حُفظت النسبة" },
} satisfies Record<string, Bi>;

function ProjectProfitPage() {
  const { lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const allowed = canSeePricingNav(roles);
  const finance = isFinanceManager(roles);
  const rows = useQuery({ queryKey: ["contract-profit-all"], queryFn: listProfit, enabled: allowed });
  const rate = useQuery({ queryKey: ["contract-late-rate"], queryFn: getLateFinancingRate, enabled: allowed });
  const [rateText, setRateText] = useState<string | null>(null);
  const money = (n: number | null | undefined) =>
    n == null ? "—" : formatNumber(Number(n), lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!allowed) return <EmptyState title={pick(TEXT.noAccess, lang)} />;
  if (rows.isLoading) return <SkeletonTable />;
  if (rows.error) return <QueryFailure retry={() => void rows.refetch()} />;
  const list = rows.data ?? [];
  const tot = (k: "sold" | "expected_cost" | "gross_profit_expected" | "financing_cost" | "net_profit" | "received" | "late_outstanding") =>
    list.reduce((s, r) => s + Number(r[k] ?? 0), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader eyebrow={pick(TEXT.eyebrow, lang)} title={pick(TEXT.title, lang)} description={pick(TEXT.desc, lang)} />
      {finance ? (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="space-y-1">
            <span className="block text-muted-foreground">{pick(TEXT.rate, lang)}</span>
            <input inputMode="decimal" className="w-24 rounded-md border border-border bg-background px-2 py-1 text-end tabular-nums"
              value={rateText ?? String(rate.data ?? "")} onChange={(e) => setRateText(e.target.value)} />
          </label>
          <Button size="sm" variant="outline" disabled={rateText == null} onClick={async () => {
            try {
              await setFinanceSetting("late_financing_pct_month", Number(rateText));
              toast.success(pick(TEXT.saved, lang));
              setRateText(null);
              void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("contract-") });
            } catch (e) {
              toast.error(dbMessage(e, lang));
            }
          }}>{pick(TEXT.save, lang)}</Button>
        </div>
      ) : null}
      {list.length === 0 ? (
        <EmptyState title={pick(TEXT.none, lang)} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.deal, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.sold, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.cost, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.gross, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.financing, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.net, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.collected, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.late, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((r) => {
              const sold = Number(r.executed_value ?? r.sold);
              return (
                <TableRow key={r.contract_id}>
                  <TableCell>
                    <Link to="/opportunities/$id" params={{ id: r.opportunity_id }} className="hover:underline">{r.project_name ?? "—"}</Link>
                    {r.project_code ? <div className="text-xs text-muted-foreground">{r.project_code}</div> : null}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{money(sold)}</TableCell>
                  <TableCell className="text-end tabular-nums">{money(r.expected_cost)}</TableCell>
                  <TableCell className="text-end tabular-nums">{money(r.gross_profit_expected)}</TableCell>
                  <TableCell className="text-end tabular-nums">{money(r.financing_cost)}</TableCell>
                  <TableCell className={`text-end font-medium tabular-nums ${Number(r.net_profit) < 0 ? "text-destructive" : ""}`}>
                    {money(r.net_profit)} <span className="text-xs text-muted-foreground">{marginPct(Number(r.net_profit), sold) ?? "—"}%</span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{money(r.received)}</TableCell>
                  <TableCell className={`text-end tabular-nums ${Number(r.late_outstanding ?? 0) > 0 ? "text-destructive" : ""}`}>{money(r.late_outstanding)}</TableCell>
                </TableRow>
              );
            })}
            <TableRow className="font-semibold">
              <TableCell>{pick(TEXT.total, lang)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(tot("sold"))}</TableCell>
              <TableCell className="text-end tabular-nums">{money(tot("expected_cost"))}</TableCell>
              <TableCell className="text-end tabular-nums">{money(tot("gross_profit_expected"))}</TableCell>
              <TableCell className="text-end tabular-nums">{money(tot("financing_cost"))}</TableCell>
              <TableCell className="text-end tabular-nums">{money(tot("net_profit"))}</TableCell>
              <TableCell className="text-end tabular-nums">{money(tot("received"))}</TableCell>
              <TableCell className="text-end tabular-nums">{money(tot("late_outstanding"))}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  );
}
