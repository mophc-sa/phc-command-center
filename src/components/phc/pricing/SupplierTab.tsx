import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, localeFor, formatNumber } from "@/lib/i18n";
import { canPricerMove } from "@/lib/pricing";
import { listBoqLines, listSupplierCosts, movePricingFile, type BoqLineRow, type SupplierCostRow } from "@/lib/pricing-actions";
import { daysWaiting } from "@/lib/pricing-access";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { SupplierEntryForm } from "@/components/phc/pricing/SupplierEntryForm";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Supplier", ar: "المورد" },
  notYet: { en: "The BOQ is frozen first, on the Package tab.", ar: "تُجمَّد الكميات أولاً من تبويب الباكيج." },
  howToday: { en: "The supplier portal is not ready yet. Send the frozen BOQ and the files to the supplier as you do today, mark it sent here, then enter the supplier's prices on their behalf when they answer. The supplier sees the project code only.", ar: "بوابة المورد ليست جاهزة بعد. أرسل الكميات المجمّدة والملفات للمورد كما تفعل اليوم، وسجّل الإرسال هنا، ثم أدخل أسعار المورد نيابة عنه حين يرد. يرى المورد رمز المشروع فقط." },
  send: { en: "Mark as sent to the supplier", ar: "سجّل الإرسال للمورد" },
  sent: { en: "Marked as sent", ar: "سُجّل الإرسال" },
  atSupplier: { en: "At the supplier since", ar: "عند المورد منذ" },
  days: { en: "days", ar: "يوم" },
  pricedCount: { en: "lines have a supplier price", ar: "بنداً لها سعر مورد" },
  of: { en: "of", ar: "من" },
  nonSar: { en: "lines are quoted in another currency; they stay unpriced until the quote is in SAR.", ar: "بنداً مسعّرة بعملة أخرى؛ تبقى بلا سعر حتى يصبح عرض المورد بالريال." },
  priced: { en: "The supplier has priced", ar: "سعّر المورد" },
  confirm: { en: "Confirm: the supplier's prices are in and go to the GM", ar: "تأكيد: أسعار المورد وصلت وتذهب للمدير العام" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  movedOn: { en: "The file went to the GM", ar: "انتقل الملف للمدير العام" },
  noPrices: { en: "No supplier price is in the system yet; the Cost review will show every line unpriced.", ar: "لا يوجد سعر مورد في النظام بعد؛ ستظهر كل البنود بلا سعر في مراجعة التكلفة." },
  done: { en: "The supplier has priced this file. See Cost review.", ar: "سعّر المورد هذا الملف. راجع تبويب مراجعة التكلفة." },
  closed: { en: "This file is closed.", ar: "هذا الملف مغلق." },
  quotesTitle: { en: "Supplier prices received", ar: "أسعار المورد المستلمة" },
  quotesSub: { en: "Read-only. Cost, visible to cost readers only.", ar: "للقراءة فقط. تكلفة، تظهر لمن يحق له قراءة التكلفة فقط." },
  sign: { en: "Sign", ar: "اللوحة" },
  qty: { en: "Qty", ar: "الكمية" },
  vendor: { en: "Supplier", ar: "المورد" },
  currency: { en: "Currency", ar: "العملة" },
  unit: { en: "Unit price", ar: "سعر الوحدة" },
  screenUnit: { en: "With screen", ar: "مع الشاشة" },
  lead: { en: "Lead time (days)", ar: "مدة التوريد (يوم)" },
  noQuote: { en: "No price yet", ar: "لا سعر بعد" },
  notSar: { en: "Not SAR", ar: "ليس بالريال" },
  multi: { en: "More than one quote", ar: "أكثر من عرض" },
} satisfies Record<string, Bi>;

// The grid ignores cancelled and superseded quotes, so the Supplier tab does too.
const isLiveQuote = (c: SupplierCostRow) => c.status !== "cancelled" && c.status !== "superseded";

function QuotesTable({ lines, costs }: { lines: BoqLineRow[]; costs: SupplierCostRow[] }) {
  const { lang } = useI18n();
  const byLine = new Map<string, SupplierCostRow[]>();
  for (const c of costs.filter(isLiveQuote)) byLine.set(c.boq_line_id, [...(byLine.get(c.boq_line_id) ?? []), c]);
  const money = (n: number | null) => (n == null ? "—" : formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const amount = (n: number | null, q: SupplierCostRow) => (n != null && q.currency !== "SAR" ? `${money(n)} ${q.currency}` : money(n));
  return (
    <Panel title={pick(TEXT.quotesTitle, lang)} subtitle={pick(TEXT.quotesSub, lang)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{pick(TEXT.sign, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
            <TableHead>{pick(TEXT.vendor, lang)}</TableHead>
            <TableHead>{pick(TEXT.currency, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.unit, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.screenUnit, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.lead, lang)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => {
            const qs = byLine.get(l.id) ?? [];
            return (
              <TableRow key={l.id}>
                <TableCell>
                  <div className="font-medium">{l.sign_type}</div>
                  {qs.length > 1 ? <StatusPill tone="attention">{pick(TEXT.multi, lang)}</StatusPill> : null}
                </TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(l.quantity, lang)}</TableCell>
                {qs.length === 0 ? (
                  <TableCell colSpan={5} className="text-muted-foreground">{pick(TEXT.noQuote, lang)}</TableCell>
                ) : (
                  <>
                    <TableCell>{qs.map((q) => <div key={q.id}>{q.vendor_name}</div>)}</TableCell>
                    <TableCell>
                      {qs.map((q) => (
                        <div key={q.id}>
                          {q.currency}
                          {q.currency !== "SAR" ? <StatusPill tone="danger" className="ms-1">{pick(TEXT.notSar, lang)}</StatusPill> : null}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{qs.map((q) => <div key={q.id}>{amount(q.unit_cost, q)}</div>)}</TableCell>
                    <TableCell className="text-end tabular-nums">{qs.map((q) => <div key={q.id}>{amount(q.unit_cost_with_screen, q)}</div>)}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {qs.map((q) => <div key={q.id}>{q.lead_time_days == null ? "—" : formatNumber(q.lead_time_days, lang)}</div>)}
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Panel>
  );
}

export function SupplierTab({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const revisionId = file.boq_revision_id;
  const lines = useQuery({ queryKey: ["pricing-lines", revisionId], queryFn: () => listBoqLines(revisionId as string), enabled: revisionId != null });
  const costs = useQuery({
    queryKey: ["pricing-supplier-costs", revisionId],
    queryFn: () => listSupplierCosts(revisionId as string),
    enabled: revisionId != null && rights.can_read_cost,
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const costRows = rights.can_read_cost ? (costs.data ?? []).filter(isLiveQuote) : [];
  const costsReady = !rights.can_read_cost || (revisionId != null && costs.isSuccess);
  const sarPriced = new Set(costRows.filter((c) => c.unit_cost != null && c.currency === "SAR").map((c) => c.boq_line_id)).size;
  const nonSar = new Set(costRows.filter((c) => c.currency !== "SAR").map((c) => c.boq_line_id)).size;
  const lineCount = lines.data?.length ?? 0;

  async function move(to: "at_supplier" | "supplier_priced", ok: Bi) {
    if (busy) return;
    setBusy(true);
    try {
      await movePricingFile(file.file_id, to);
      toast.success(pick(ok, lang));
      setConfirming(false);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  if (revisionId != null && (lines.isLoading || (rights.can_read_cost && costs.isLoading))) return <SkeletonTable />;
  if (lines.isError || (rights.can_read_cost && costs.isError)) {
    return <QueryFailure retry={() => { void lines.refetch(); if (rights.can_read_cost) void costs.refetch(); }} />;
  }

  const before = ["received", "package_review", "needs_info"].includes(file.state);
  const showQuotes = rights.can_read_cost && revisionId != null && !before && file.state !== "boq_frozen";
  return (
    <div className="space-y-4">
      <Panel title={pick(TEXT.title, lang)}>
        <div className="space-y-4 text-sm">
          {before ? <p className="text-muted-foreground">{pick(TEXT.notYet, lang)}</p> : null}

          {file.state === "boq_frozen" ? (
            <>
              <p className="text-muted-foreground">{pick(TEXT.howToday, lang)}</p>
              {rights.is_pricer && canPricerMove("boq_frozen", "at_supplier") ? (
                <Button disabled={busy} onClick={() => void move("at_supplier", TEXT.sent)}>{pick(TEXT.send, lang)}</Button>
              ) : null}
            </>
          ) : null}

          {file.state === "at_supplier" ? (
            <>
              <p>
                {pick(TEXT.atSupplier, lang)} {new Date(file.state_changed_at).toLocaleDateString(localeFor(lang))} ·{" "}
                {daysWaiting(file.state_changed_at)} {pick(TEXT.days, lang)}
              </p>
              {rights.can_read_cost && costsReady ? (
                <>
                  <p>
                    {sarPriced} {pick(TEXT.of, lang)} {lineCount} {pick(TEXT.pricedCount, lang)}
                  </p>
                  {nonSar > 0 ? (
                    <p className="text-amber-light">
                      {nonSar} {pick(TEXT.nonSar, lang)}
                    </p>
                  ) : null}
                </>
              ) : null}
              {rights.is_pricer && rights.can_read_cost && revisionId != null ? (
                <SupplierEntryForm file={file} rights={rights} onChanged={onChanged} />
              ) : null}
              {rights.is_pricer && canPricerMove("at_supplier", "supplier_priced") ? (
                confirming ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {sarPriced === 0 && rights.can_read_cost && costsReady ? <p className="w-full text-amber-light">{pick(TEXT.noPrices, lang)}</p> : null}
                    <Button disabled={busy} onClick={() => void move("supplier_priced", TEXT.movedOn)}>{pick(TEXT.confirm, lang)}</Button>
                    <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>{pick(TEXT.cancel, lang)}</Button>
                  </div>
                ) : (
                  <Button onClick={() => setConfirming(true)}>{pick(TEXT.priced, lang)}</Button>
                )
              ) : null}
            </>
          ) : null}

          {file.state === "closed" ? <p className="text-muted-foreground">{pick(TEXT.closed, lang)}</p> : null}
          {!before && file.state !== "boq_frozen" && file.state !== "at_supplier" && file.state !== "closed" ? (
            <p className="text-muted-foreground">{pick(TEXT.done, lang)}</p>
          ) : null}
        </div>
      </Panel>
      {showQuotes && lines.data ? <QuotesTable lines={lines.data} costs={costRows} /> : null}
    </div>
  );
}
