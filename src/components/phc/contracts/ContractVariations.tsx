import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { DealPricingCard } from "@/components/phc/pricing/DealPricingCard";
import { useI18n, formatNumber } from "@/lib/i18n";
import { listContractVariations } from "@/lib/pricing-actions";
import {
  acceptVariation, getExecutionSummary, listContractLines, openVariation, recordExecuted,
} from "@/lib/contract-terms-actions";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { riyadhToday } from "@/lib/supplier-portal";

// B4 (2026-11-12): variation orders priced through the pricing loop, and the
// executed quantities at close-out. Rules in SQL (20261112130000).
const TEXT = {
  title: { en: "Variations and executed quantities", ar: "أوامر التغيير والكميات المنفذة" },
  open: { en: "Open a variation", ar: "فتح أمر تغيير" },
  openDesc: { en: "Any sign beyond the contract needs a variation before it is made, or it cannot be invoiced. It is priced like a quotation (estimation, supplier, GM, finance).", ar: "أي لوحة زائدة عن العقد تحتاج أمر تغيير قبل تنفيذها، وإلا لا يمكن فوترتها. يُسعَّر مثل عرض السعر (التقدير، المورد، المدير العام، المالية)." },
  reason: { en: "What is added", ar: "ما الذي يُضاف" },
  opened: { en: "Variation opened; estimation is told", ar: "فُتح أمر التغيير وأُبلغ التقدير" },
  accept: { en: "Client accepted", ar: "وافق العميل" },
  acceptDesc: { en: "Adds the variation's value to the contract, as its own payment, and its lines to the contract quantities.", ar: "يضيف قيمة أمر التغيير إلى العقد كدفعة مستقلة، وبنوده إلى كميات العقد." },
  acceptedOn: { en: "Accepted on", ar: "تاريخ الموافقة" },
  clientRef: { en: "Client's reference (PO / letter)", ar: "مرجع العميل (أمر شراء / خطاب)" },
  file: { en: "Acceptance file", ar: "ملف الموافقة" },
  acceptedDone: { en: "Variation added to the contract", ar: "أُضيف أمر التغيير إلى العقد" },
  acceptedTag: { en: "In the contract", ar: "ضمن العقد" },
  executed: { en: "Executed quantities", ar: "الكميات المنفذة" },
  executedDesc: { en: "At close-out, enter what was actually installed. Less than the contract reduces the final payment; more needs a variation.", ar: "عند الإقفال أدخل ما رُكّب فعلاً. الأقل من العقد يُنقص الدفعة النهائية؛ والأكثر يحتاج أمر تغيير." },
  line: { en: "Line", ar: "البند" },
  contractQty: { en: "Contract", ar: "العقد" },
  executedQty: { en: "Executed", ar: "المنفذ" },
  save: { en: "Save", ar: "حفظ" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  executedDone: { en: "Executed quantities saved", ar: "حُفظت الكميات المنفذة" },
  contractValue: { en: "Contract value", ar: "قيمة العقد" },
  variations: { en: "Of which variations", ar: "منها أوامر تغيير" },
  executedValue: { en: "Executed value", ar: "قيمة المنفذ" },
  shortfall: { en: "Not executed", ar: "غير منفذ" },
} satisfies Record<string, Bi>;

export function ContractVariations({
  contractId, opportunityId, canRecord, onChanged,
}: {
  contractId: string;
  opportunityId: string;
  canRecord: boolean;
  onChanged: () => void;
}) {
  const { lang } = useI18n();
  const [openOpen, setOpenOpen] = useState(false);
  const [acceptFor, setAcceptFor] = useState<string | null>(null);
  const [execOpen, setExecOpen] = useState(false);
  const vos = useQuery({ queryKey: ["pricing-variations", contractId], queryFn: () => listContractVariations(contractId) });
  const summary = useQuery({ queryKey: ["contract-execution", contractId], queryFn: () => getExecutionSummary(contractId) });
  const money = (n: number | null | undefined) =>
    n == null ? "—" : formatNumber(Number(n), lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const s = summary.data;

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <p className="text-sm font-medium">{pick(TEXT.title, lang)}</p>
      {s ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="text-muted-foreground">{pick(TEXT.contractValue, lang)}</dt><dd className="tabular-nums">{money(s.contract_value)}</dd></div>
          <div><dt className="text-muted-foreground">{pick(TEXT.variations, lang)}</dt><dd className="tabular-nums">{money(s.variations_value)}</dd></div>
          <div><dt className="text-muted-foreground">{pick(TEXT.executedValue, lang)}</dt><dd className="tabular-nums">{money(s.executed_value)}</dd></div>
          <div><dt className="text-muted-foreground">{pick(TEXT.shortfall, lang)}</dt><dd className={`tabular-nums ${Number(s.shortfall) > 0 ? "text-destructive" : ""}`}>{money(s.shortfall)}</dd></div>
        </dl>
      ) : null}

      {(vos.data ?? []).map((v) => (
        <div key={v.id} className="space-y-1">
          <DealPricingCard opportunityId={opportunityId} file={v} title={`VO-${v.variation_number}${v.variation_accepted_at ? ` · ${pick(TEXT.acceptedTag, lang)}` : ""}`} />
          {canRecord && v.state === "quoted" && !v.variation_accepted_at ? (
            <Button size="sm" onClick={() => setAcceptFor(v.id)}>{pick(TEXT.accept, lang)}</Button>
          ) : null}
        </div>
      ))}

      {canRecord ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOpenOpen(true)}>{pick(TEXT.open, lang)}</Button>
          <Button variant="outline" onClick={() => setExecOpen(true)}>{pick(TEXT.executed, lang)}</Button>
        </div>
      ) : null}

      <ActionDialog
        open={openOpen}
        onOpenChange={setOpenOpen}
        recordId={contractId}
        title={pick(TEXT.open, lang)}
        description={pick(TEXT.openDesc, lang)}
        fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
        submitLabel={pick(TEXT.open, lang)}
        onSubmit={async (v) => {
          try {
            await openVariation(contractId, v.reason);
            toast.success(pick(TEXT.opened, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={acceptFor != null}
        onOpenChange={(o) => !o && setAcceptFor(null)}
        recordId={acceptFor}
        title={pick(TEXT.accept, lang)}
        description={pick(TEXT.acceptDesc, lang)}
        fields={[
          { key: "acceptedOn", type: "date", label: pick(TEXT.acceptedOn, lang), required: true, defaultValue: riyadhToday() },
          { key: "reference", type: "text", label: pick(TEXT.clientRef, lang) },
          { key: "file", type: "file", label: pick(TEXT.file, lang), folder: "contracts" },
        ]}
        submitLabel={pick(TEXT.accept, lang)}
        onSubmit={async (v) => {
          if (!acceptFor) return;
          try {
            await acceptVariation(acceptFor, v.acceptedOn, v.reference || null, v.file || null);
            toast.success(pick(TEXT.acceptedDone, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ExecutedDialog open={execOpen} onOpenChange={setExecOpen} contractId={contractId} onDone={onChanged} />
    </div>
  );
}

function ExecutedDialog({ open, onOpenChange, contractId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; contractId: string; onDone: () => void }) {
  const { lang } = useI18n();
  const lines = useQuery({ queryKey: ["contract-lines", contractId], queryFn: () => listContractLines(contractId), enabled: open });
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = (lines.data ?? []).filter((l) => !l.variation_file_id);
  const FIELD = "w-24 rounded-md border border-border bg-background px-2 py-1 text-end text-sm tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await recordExecuted(contractId, own.map((l) => ({
        line_id: l.id, executed: Number(values[l.id] ?? l.executed_quantity ?? l.quantity),
      })));
      toast.success(pick(TEXT.executedDone, lang));
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
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pick(TEXT.executed, lang)}</DialogTitle>
          <DialogDescription>{pick(TEXT.executedDesc, lang)}</DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.line, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.contractQty, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.executedQty, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {own.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.line_number} · {l.description}</TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(Number(l.quantity), lang, { maximumFractionDigits: 3 })}</TableCell>
                <TableCell className="text-end">
                  <input inputMode="decimal" className={FIELD}
                    value={values[l.id] ?? String(l.executed_quantity ?? l.quantity)}
                    onChange={(e) => setValues({ ...values, [l.id]: e.target.value })} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{pick(TEXT.cancel, lang)}</Button>
          <Button disabled={busy} onClick={() => void save()}>{pick(TEXT.save, lang)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
