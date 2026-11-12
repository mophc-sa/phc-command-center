import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatNumber } from "@/lib/i18n";
import { COST_CATEGORY_LABEL, COST_ENTRY_LABEL, marginPct } from "@/lib/contract-billing";
import {
  addCostItem, getProfit, listCostItems, loadCosts, recordCostEntry, type CostCategory, type CostEntryKind,
} from "@/lib/contract-terms-actions";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { riyadhToday } from "@/lib/supplier-portal";

// B5 (2026-11-12): the contract's costs and profit, for cost readers only (RLS
// returns nothing to anyone else; the card is not shown to them). The budget
// comes from the approved price; finance records invoices and payments.
const TEXT = {
  title: { en: "Costs and profit", ar: "التكاليف والربحية" },
  item: { en: "Cost", ar: "التكلفة" },
  planned: { en: "Planned", ar: "المخطط" },
  actual: { en: "Actual invoices", ar: "الفواتير الفعلية" },
  paid: { en: "Paid", ar: "المسدد" },
  plannedPay: { en: "Planned payments", ar: "دفعات مخططة" },
  reload: { en: "Reload from pricing", ar: "إعادة التحميل من التسعير" },
  reloaded: { en: "Budget reloaded", ar: "أُعيد تحميل الميزانية" },
  addItem: { en: "Add a cost item", ar: "إضافة بند تكلفة" },
  category: { en: "Category", ar: "الفئة" },
  label: { en: "Label", ar: "الوصف" },
  amount: { en: "Amount", ar: "المبلغ" },
  added: { en: "Cost item added", ar: "أُضيف بند التكلفة" },
  entry: { en: "Record invoice / payment", ar: "تسجيل فاتورة / دفعة" },
  entryDesc: { en: "The supplier's or workshop's invoice, a payment planned with its date, or a payment made.", ar: "فاتورة المورد أو الورشة، أو دفعة مخططة بتاريخها، أو دفعة مسددة." },
  kind: { en: "What", ar: "النوع" },
  date: { en: "Date", ar: "التاريخ" },
  reference: { en: "Reference", ar: "المرجع" },
  note: { en: "Note", ar: "ملاحظة" },
  recorded: { en: "Recorded", ar: "سُجّل" },
  sold: { en: "Sold", ar: "البيع" },
  expectedCost: { en: "Expected cost", ar: "التكلفة المتوقعة" },
  gross: { en: "Gross profit", ar: "الربح الإجمالي" },
  financing: { en: "Cost of late collection", ar: "تكلفة تأخر التحصيل" },
  net: { en: "Net profit", ar: "صافي الربح" },
} satisfies Record<string, Bi>;
const CATS: CostCategory[] = ["manufacturing", "installation", "logistics", "extras", "other"];
const KINDS: CostEntryKind[] = ["actual_cost", "planned_payment", "payment"];

export function ContractCosts({ contractId, isFinance, onChanged }: { contractId: string; isFinance: boolean; onChanged: () => void }) {
  const { lang } = useI18n();
  const [addOpen, setAddOpen] = useState(false);
  const [entryFor, setEntryFor] = useState<string | null>(null);
  const costs = useQuery({ queryKey: ["contract-costs", contractId], queryFn: () => listCostItems(contractId) });
  const profit = useQuery({ queryKey: ["contract-profit", contractId], queryFn: () => getProfit(contractId) });
  const money = (n: number | null | undefined) =>
    n == null ? "—" : formatNumber(Number(n), lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const p = profit.data;
  if (!p) return null; // not a cost reader, or not loaded
  const items = costs.data?.items ?? [];
  const live = (costs.data?.entries ?? []).filter((e) => !e.voided_at);
  const sum = (itemId: string, kind: CostEntryKind) => live.filter((e) => e.item_id === itemId && e.kind === kind).reduce((s, e) => s + Number(e.amount), 0);
  const net = Number(p.net_profit);
  const sold = Number(p.executed_value ?? p.sold);

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <p className="text-sm font-medium">{pick(TEXT.title, lang)}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
        <div><dt className="text-muted-foreground">{pick(TEXT.sold, lang)}</dt><dd className="tabular-nums">{money(sold)}</dd></div>
        <div><dt className="text-muted-foreground">{pick(TEXT.expectedCost, lang)}</dt><dd className="tabular-nums">{money(p.expected_cost)}</dd></div>
        <div><dt className="text-muted-foreground">{pick(TEXT.gross, lang)}</dt><dd className="tabular-nums">{money(p.gross_profit_expected)}</dd></div>
        <div><dt className="text-muted-foreground">{pick(TEXT.financing, lang)}</dt><dd className="tabular-nums">{money(p.financing_cost)}</dd></div>
        <div><dt className="text-muted-foreground">{pick(TEXT.net, lang)}</dt>
          <dd className={`font-semibold tabular-nums ${net < 0 ? "text-destructive" : ""}`}>{money(net)} · {marginPct(net, sold) ?? "—"}%</dd></div>
      </dl>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{pick(TEXT.item, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.planned, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.actual, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.paid, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.plannedPay, lang)}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell>{pick(COST_CATEGORY_LABEL[it.category], lang)}{it.label ? ` · ${it.label}` : ""}{it.source === "variation" ? " · VO" : ""}</TableCell>
              <TableCell className="text-end tabular-nums">{money(it.planned_amount)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(sum(it.id, "actual_cost") || null)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(sum(it.id, "payment") || null)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(sum(it.id, "planned_payment") || null)}</TableCell>
              <TableCell className="text-end">
                {isFinance ? <Button size="sm" variant="ghost" onClick={() => setEntryFor(it.id)}>{pick(TEXT.entry, lang)}</Button> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {isFinance ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={async () => {
            try { await loadCosts(contractId); toast.success(pick(TEXT.reloaded, lang)); onChanged(); }
            catch (e) { toast.error(dbMessage(e, lang)); }
          }}>{pick(TEXT.reload, lang)}</Button>
          <Button variant="outline" onClick={() => setAddOpen(true)}>{pick(TEXT.addItem, lang)}</Button>
        </div>
      ) : null}

      <ActionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        recordId={contractId}
        title={pick(TEXT.addItem, lang)}
        fields={[
          { key: "category", type: "select", label: pick(TEXT.category, lang), required: true, defaultValue: "other",
            options: CATS.map((c) => ({ value: c, label: pick(COST_CATEGORY_LABEL[c], lang) })) },
          { key: "label", type: "text", label: pick(TEXT.label, lang), required: true },
          { key: "amount", type: "text", label: pick(TEXT.planned, lang), required: true },
        ]}
        submitLabel={pick(TEXT.addItem, lang)}
        onSubmit={async (v) => {
          try {
            await addCostItem(contractId, v.category as CostCategory, v.label, Number(v.amount));
            toast.success(pick(TEXT.added, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={entryFor != null}
        onOpenChange={(o) => !o && setEntryFor(null)}
        recordId={entryFor}
        title={pick(TEXT.entry, lang)}
        description={pick(TEXT.entryDesc, lang)}
        fields={[
          { key: "kind", type: "select", label: pick(TEXT.kind, lang), required: true, defaultValue: "actual_cost",
            options: KINDS.map((k) => ({ value: k, label: pick(COST_ENTRY_LABEL[k], lang) })) },
          { key: "date", type: "date", label: pick(TEXT.date, lang), required: true, defaultValue: riyadhToday() },
          { key: "amount", type: "text", label: pick(TEXT.amount, lang), required: true },
          { key: "reference", type: "text", label: pick(TEXT.reference, lang) },
          { key: "note", type: "textarea", label: pick(TEXT.note, lang) },
        ]}
        submitLabel={pick(TEXT.entry, lang)}
        onSubmit={async (v) => {
          if (!entryFor) return;
          try {
            await recordCostEntry(entryFor, v.kind as CostEntryKind, v.date, Number(v.amount), v.reference || null, v.note || null);
            toast.success(pick(TEXT.recorded, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </div>
  );
}
