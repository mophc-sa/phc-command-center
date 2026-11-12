import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import { CHANNEL_LABEL, TIER_LABEL, gauges, type ClaimChannel } from "@/lib/contract-billing";
import {
  getBillingSummary, listClaims, listDuesToInvoice, listReceivables, recordClaim, recordInvoice, recordReceipt, voidInvoice,
} from "@/lib/contract-terms-actions";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { riyadhToday } from "@/lib/supplier-portal";

// B3 (2026-11-12): billing and collection on an approved contract. The tax
// invoice comes from the accounting system; finance records it here against the
// dues it covers, and the receipts. The rep sees the figures and logs claims.
const TEXT = {
  title: { en: "Billing and collection", ar: "الفوترة والتحصيل" },
  invoiced: { en: "Invoiced (excl. VAT)", ar: "المفوتر (بدون ضريبة)" },
  left: { en: "Left to invoice", ar: "المتبقي للفوترة" },
  received: { en: "Collected", ar: "المحصّل" },
  outstanding: { en: "Outstanding (incl. VAT)", ar: "المتبقي للتحصيل (شامل الضريبة)" },
  late: { en: "Of which late", ar: "منه متأخر" },
  notInvoiced: { en: "{n} dues are past their date and not invoiced.", ar: "{n} استحقاقات تجاوزت تاريخها ولم تُفوتر." },
  invoice: { en: "Invoice", ar: "الفاتورة" },
  date: { en: "Date", ar: "التاريخ" },
  dueOn: { en: "Due", ar: "الاستحقاق" },
  total: { en: "Total", ar: "الإجمالي" },
  status: { en: "Status", ar: "الحالة" },
  recordInvoice: { en: "Record invoice", ar: "تسجيل فاتورة" },
  invoiceDesc: { en: "Issue the tax invoice in the accounting system first, then record it here: its number and date, and the dues it covers. Its amount is their total; VAT is added.", ar: "أصدر الفاتورة الضريبية من النظام المحاسبي أولاً، ثم سجّلها هنا: رقمها وتاريخها والاستحقاقات التي تغطيها. مبلغها مجموعها، وتُضاف الضريبة." },
  number: { en: "Invoice number", ar: "رقم الفاتورة" },
  pickDues: { en: "Dues it covers", ar: "الاستحقاقات التي تغطيها" },
  noDues: { en: "Nothing is due to invoice yet.", ar: "لا يوجد استحقاق للفوترة بعد." },
  note: { en: "Note", ar: "ملاحظة" },
  save: { en: "Record", ar: "تسجيل" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  invoiceDone: { en: "Invoice recorded", ar: "سُجّلت الفاتورة" },
  pickOne: { en: "Pick at least one due.", ar: "اختر استحقاقاً واحداً على الأقل." },
  receipt: { en: "Record receipt", ar: "تسجيل مقبوض" },
  receiptDesc: { en: "Money received against this invoice, including VAT.", ar: "مبلغ مستلم على هذه الفاتورة، شامل الضريبة." },
  amount: { en: "Amount (incl. VAT)", ar: "المبلغ (شامل الضريبة)" },
  reference: { en: "Bank reference", ar: "مرجع التحويل" },
  receiptDone: { en: "Receipt recorded", ar: "سُجّل المقبوض" },
  voidInv: { en: "Void", ar: "إلغاء" },
  voidTitle: { en: "Void this invoice?", ar: "إلغاء هذه الفاتورة؟" },
  voidDesc: { en: "Its dues can be invoiced again. Not possible once money was received on it.", ar: "يمكن فوترة استحقاقاتها من جديد. غير ممكن بعد استلام مبلغ عليها." },
  reason: { en: "Reason", ar: "السبب" },
  voided: { en: "Invoice voided", ar: "أُلغيت الفاتورة" },
  claims: { en: "Claims", ar: "المطالبات" },
  logClaim: { en: "Log a claim", ar: "تسجيل مطالبة" },
  claimDesc: { en: "Each claim to the client, so everyone knows what was asked, when, and when to follow up.", ar: "كل مطالبة للعميل، ليعرف الجميع ما طُلب ومتى وموعد المتابعة." },
  channel: { en: "How", ar: "الوسيلة" },
  claimedOn: { en: "Claimed on", ar: "تاريخ المطالبة" },
  followUp: { en: "Follow up on", ar: "المتابعة في" },
  forInvoice: { en: "Invoice (optional)", ar: "الفاتورة (اختياري)" },
  claimDone: { en: "Claim logged", ar: "سُجّلت المطالبة" },
  paid: { en: "Paid", ar: "مدفوعة" },
} satisfies Record<string, Bi>;

const TONE = { 0: "neutral", 1: "attention", 2: "danger", 3: "danger" } as const;
const CHANNELS: ClaimChannel[] = ["email", "letter", "call", "meeting", "other"];

export function ContractBilling({
  contractId, isFinance, canClaim, onChanged,
}: {
  contractId: string;
  isFinance: boolean;
  canClaim: boolean;
  onChanged: () => void;
}) {
  const { lang } = useI18n();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const summary = useQuery({ queryKey: ["contract-billing", contractId], queryFn: () => getBillingSummary(contractId) });
  const invoices = useQuery({ queryKey: ["contract-receivables", contractId], queryFn: () => listReceivables(contractId) });
  const claims = useQuery({ queryKey: ["contract-claims", contractId], queryFn: () => listClaims(contractId) });
  const money = (n: number | null | undefined) =>
    n == null ? "—" : formatNumber(Number(n), lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const s = summary.data;
  if (!s) return null;
  const g = gauges(s);
  const inv = invoices.data ?? [];

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <p className="text-sm font-medium">{pick(TEXT.title, lang)}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">{pick(TEXT.invoiced, lang)}</dt><dd className="tabular-nums">{money(s.invoiced_excl_vat)} · {g.invoicedPct}%</dd></div>
        <div><dt className="text-muted-foreground">{pick(TEXT.left, lang)}</dt><dd className="tabular-nums">{money(s.left_to_invoice)}</dd></div>
        <div><dt className="text-muted-foreground">{pick(TEXT.received, lang)}</dt><dd className="tabular-nums">{money(s.received)} · {g.collectedPct}%</dd></div>
        <div><dt className="text-muted-foreground">{pick(TEXT.outstanding, lang)}</dt><dd className="tabular-nums">{money(s.outstanding)}</dd></div>
        <div><dt className="text-muted-foreground">{pick(TEXT.late, lang)}</dt><dd className={`tabular-nums ${Number(s.late_outstanding) > 0 ? "font-medium text-destructive" : ""}`}>{money(s.late_outstanding)}</dd></div>
      </dl>
      {s.dues_not_invoiced > 0 ? (
        <p className="text-xs text-muted-foreground">{pick(TEXT.notInvoiced, lang).replace("{n}", String(s.dues_not_invoiced))}</p>
      ) : null}

      {inv.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.invoice, lang)}</TableHead>
              <TableHead>{pick(TEXT.date, lang)}</TableHead>
              <TableHead>{pick(TEXT.dueOn, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.total, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.outstanding, lang)}</TableHead>
              <TableHead>{pick(TEXT.status, lang)}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {inv.map((r) => (
              <TableRow key={r.invoice_id}>
                <TableCell className="font-medium">{r.invoice_number}</TableCell>
                <TableCell className="tabular-nums">{r.invoice_date}</TableCell>
                <TableCell className="tabular-nums">{r.due_on}</TableCell>
                <TableCell className="text-end tabular-nums">{money(r.total_incl_vat)}</TableCell>
                <TableCell className="text-end tabular-nums">{money(r.outstanding)}</TableCell>
                <TableCell>
                  {Number(r.outstanding) <= 0 ? (
                    <StatusPill tone="positive">{pick(TEXT.paid, lang)}</StatusPill>
                  ) : (
                    <StatusPill tone={TONE[r.tier]}>{pick(TIER_LABEL[r.tier], lang)}{r.days_late > 0 ? ` · ${r.days_late}` : ""}</StatusPill>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  {isFinance && Number(r.outstanding) > 0 ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setReceiptFor(r.invoice_id)}>{pick(TEXT.receipt, lang)}</Button>
                      {Number(r.received) === 0 ? (
                        <Button size="sm" variant="ghost" onClick={() => setVoidFor(r.invoice_id)}>{pick(TEXT.voidInv, lang)}</Button>
                      ) : null}
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {isFinance ? <Button variant="outline" onClick={() => setInvoiceOpen(true)}>{pick(TEXT.recordInvoice, lang)}</Button> : null}
        {canClaim || isFinance ? <Button variant="outline" onClick={() => setClaimOpen(true)}>{pick(TEXT.logClaim, lang)}</Button> : null}
      </div>

      {(claims.data ?? []).length > 0 ? (
        <div>
          <p className="mb-1 text-sm font-medium">{pick(TEXT.claims, lang)}</p>
          <ul className="space-y-1 text-sm">
            {(claims.data ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap gap-2">
                <span className="tabular-nums">{c.claimed_on}</span>
                <span className="text-muted-foreground">{pick(CHANNEL_LABEL[c.channel as ClaimChannel] ?? CHANNEL_LABEL.other, lang)}</span>
                <span>{c.note}</span>
                {c.follow_up_on ? <span className="tabular-nums text-muted-foreground">{pick(TEXT.followUp, lang)} {c.follow_up_on}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <InvoiceDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} contractId={contractId} onDone={onChanged} />
      <ActionDialog
        open={receiptFor != null}
        onOpenChange={(o) => !o && setReceiptFor(null)}
        recordId={receiptFor}
        title={pick(TEXT.receipt, lang)}
        description={pick(TEXT.receiptDesc, lang)}
        fields={[
          { key: "receivedOn", type: "date", label: pick(TEXT.date, lang), required: true, defaultValue: riyadhToday() },
          { key: "amount", type: "text", label: pick(TEXT.amount, lang), required: true,
            defaultValue: String(inv.find((r) => r.invoice_id === receiptFor)?.outstanding ?? "") },
          { key: "reference", type: "text", label: pick(TEXT.reference, lang) },
          { key: "note", type: "textarea", label: pick(TEXT.note, lang) },
        ]}
        submitLabel={pick(TEXT.save, lang)}
        onSubmit={async (v) => {
          if (!receiptFor) return;
          try {
            await recordReceipt(receiptFor, v.receivedOn, Number(v.amount), v.reference || null, v.note || null);
            toast.success(pick(TEXT.receiptDone, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={voidFor != null}
        onOpenChange={(o) => !o && setVoidFor(null)}
        recordId={voidFor}
        title={pick(TEXT.voidTitle, lang)}
        description={pick(TEXT.voidDesc, lang)}
        fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
        submitLabel={pick(TEXT.voidInv, lang)}
        destructive
        onSubmit={async (v) => {
          if (!voidFor) return;
          try {
            await voidInvoice(voidFor, v.reason);
            toast.success(pick(TEXT.voided, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={claimOpen}
        onOpenChange={setClaimOpen}
        recordId={contractId}
        title={pick(TEXT.logClaim, lang)}
        description={pick(TEXT.claimDesc, lang)}
        fields={[
          { key: "claimedOn", type: "date", label: pick(TEXT.claimedOn, lang), required: true, defaultValue: riyadhToday() },
          { key: "channel", type: "select", label: pick(TEXT.channel, lang), required: true, defaultValue: "email",
            options: CHANNELS.map((c) => ({ value: c, label: pick(CHANNEL_LABEL[c], lang) })) },
          { key: "invoice", type: "select", label: pick(TEXT.forInvoice, lang),
            options: inv.filter((r) => Number(r.outstanding) > 0).map((r) => ({ value: r.invoice_id, label: r.invoice_number })) },
          { key: "note", type: "textarea", label: pick(TEXT.note, lang), required: true },
          { key: "followUp", type: "date", label: pick(TEXT.followUp, lang) },
        ]}
        submitLabel={pick(TEXT.save, lang)}
        onSubmit={async (v) => {
          try {
            await recordClaim({ contractId, invoiceId: v.invoice || null, claimedOn: v.claimedOn, channel: v.channel, note: v.note, followUpOn: v.followUp || null });
            toast.success(pick(TEXT.claimDone, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </div>
  );
}

function InvoiceDialog({ open, onOpenChange, contractId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; contractId: string; onDone: () => void }) {
  const { lang } = useI18n();
  const dues = useQuery({ queryKey: ["contract-dues-open", contractId], queryFn: () => listDuesToInvoice(contractId), enabled: open });
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(riyadhToday());
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = dues.data ?? [];
  const total = list.filter((d) => picked.has(d.id)).reduce((s, d) => s + Number(d.amount), 0);
  const money = (n: number) => formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FIELD = "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  async function save() {
    if (busy) return;
    setError(null);
    if (picked.size === 0) { setError(pick(TEXT.pickOne, lang)); return; }
    setBusy(true);
    try {
      await recordInvoice(contractId, number, date, [...picked], note || null);
      toast.success(pick(TEXT.invoiceDone, lang));
      setPicked(new Set());
      setNumber("");
      setNote("");
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pick(TEXT.recordInvoice, lang)}</DialogTitle>
          <DialogDescription>{pick(TEXT.invoiceDesc, lang)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm"><span>{pick(TEXT.number, lang)}</span>
            <input className={FIELD} value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} /></label>
          <label className="space-y-1 text-sm"><span>{pick(TEXT.date, lang)}</span>
            <input type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 font-medium">{pick(TEXT.pickDues, lang)}</legend>
          {list.length === 0 ? <p className="text-muted-foreground">{pick(TEXT.noDues, lang)}</p> : null}
          {list.map((d) => (
            <label key={d.id} className="flex items-center gap-2">
              <input type="checkbox" checked={picked.has(d.id)} onChange={() => {
                const next = new Set(picked);
                if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                setPicked(next);
              }} />
              <span className="tabular-nums">{money(Number(d.amount))}</span>
              <span className="text-muted-foreground tabular-nums">{pick(TEXT.dueOn, lang)} {d.due_on}</span>
            </label>
          ))}
          {picked.size > 0 ? <p className="tabular-nums">{pick(TEXT.total, lang)}: {money(total)} + 15%</p> : null}
        </fieldset>
        <label className="space-y-1 text-sm"><span>{pick(TEXT.note, lang)}</span>
          <textarea className={FIELD} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{pick(TEXT.cancel, lang)}</Button>
          <Button disabled={busy} onClick={() => void save()}>{pick(TEXT.save, lang)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
