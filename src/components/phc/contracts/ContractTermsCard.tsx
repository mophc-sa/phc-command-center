import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { Callout } from "@/components/phc/Callout";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n, formatNumber } from "@/lib/i18n";
import { canManageSalesPipeline, isFinanceManager } from "@/lib/roles";
import {
  DEFAULT_PAYMENTS, DEFAULT_PERIOD, PAYMENT_KIND_LABEL, TERMS_STATUS_LABEL, expectedDate, paymentAmounts, pctTotal,
  valueDifference, type PaymentDraft, type PaymentKind,
} from "@/lib/contract-terms";
import {
  getCurrentQuote, getDealContractTerms, listContractPayments, reviewContractTerms, saveContractTerms, submitContractTerms,
  type ContractTermsRow,
} from "@/lib/contract-terms-actions";
import { revisionLabel } from "@/lib/quotation-doc";
import { ContractExecution } from "@/components/phc/contracts/ContractExecution";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";

// B1 (2026-11-12): the contract's terms and payment schedule on the deal page.
// The rep records them from the client's quotation; finance approves or returns
// them. Every rule is in SQL; this shows them and previews the arithmetic.
const TEXT = {
  title: { en: "Contract terms and payments", ar: "شروط العقد والدفعات" },
  subtitle: { en: "From the quotation sent to the client. Finance approves them; they are then the reference for invoicing.", ar: "من عرض السعر المرسل للعميل. تعتمدها المالية فتصبح مرجع الفوترة." },
  none: { en: "No contract terms recorded yet.", ar: "لم تُسجَّل شروط العقد بعد." },
  noQuote: { en: "Issue and send the quotation first; the contract starts from it.", ar: "أصدر عرض السعر وأرسله أولاً؛ العقد يبدأ منه." },
  record: { en: "Record the contract", ar: "تسجيل العقد" },
  edit: { en: "Edit", ar: "تعديل" },
  submit: { en: "Send to finance", ar: "إرسال للمالية" },
  submitted: { en: "Sent to finance", ar: "أُرسل للمالية" },
  approve: { en: "Approve", ar: "اعتماد" },
  approveTitle: { en: "Approve these contract terms?", ar: "اعتماد شروط العقد هذه؟" },
  approveDesc: { en: "They become final and the reference for invoicing and collection.", ar: "تصبح نهائية ومرجعاً للفوترة والتحصيل." },
  approved: { en: "Contract approved", ar: "اعتُمد العقد" },
  ret: { en: "Return", ar: "إرجاع" },
  retTitle: { en: "Return the contract to the rep", ar: "إرجاع العقد للمندوب" },
  reason: { en: "Reason", ar: "السبب" },
  returned: { en: "Contract returned", ar: "أُرجع العقد" },
  returnedWith: { en: "Returned by finance:", ar: "أرجعته المالية:" },
  value: { en: "Contract value (excl. VAT)", ar: "قيمة العقد (بدون ضريبة)" },
  vsQuote: { en: "vs quotation", ar: "مقابل عرض السعر" },
  diffReason: { en: "Why it differs:", ar: "سبب الاختلاف:" },
  reference: { en: "Contract / PO reference", ar: "رقم العقد / أمر الشراء" },
  signedOn: { en: "Signed on", ar: "تاريخ التوقيع" },
  periods: { en: "Execution period (days)", ar: "مدة التنفيذ (أيام)" },
  drawings: { en: "Drawings approval", ar: "اعتماد الرسومات" },
  supply: { en: "Supply and installation", ar: "التوريد والتركيب" },
  handover: { en: "Testing and handover", ar: "الاختبار والتسليم" },
  credit: { en: "Credit period after invoice (days)", ar: "مدة السداد بعد الفاتورة (أيام)" },
  payments: { en: "Payments", ar: "الدفعات" },
  kind: { en: "Payment", ar: "الدفعة" },
  pct: { en: "%", ar: "%" },
  amount: { en: "Amount", ar: "المبلغ" },
  expected: { en: "Expected", ar: "المتوقع" },
  label: { en: "Label (for Other)", ar: "الوصف (لـ أخرى)" },
  add: { en: "Add a payment", ar: "إضافة دفعة" },
  remove: { en: "Remove", ar: "حذف" },
  total: { en: "Total", ar: "المجموع" },
  mustBe100: { en: "The payments must add up to 100%.", ar: "يجب أن يكون مجموع الدفعات 100%." },
  needReason: { en: "Say why the value differs from the quotation.", ar: "اذكر سبب اختلاف القيمة عن عرض السعر." },
  save: { en: "Save draft", ar: "حفظ المسودة" },
  saved: { en: "Contract saved", ar: "حُفظ العقد" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  periodSummary: { en: "Drawings {d} · supply and installation {s} · handover {h} days · credit {c} days", ar: "الرسومات {d} · التوريد والتركيب {s} · التسليم {h} يوماً · السداد {c} يوماً" },
} satisfies Record<string, Bi>;

const KINDS: PaymentKind[] = ["advance", "drawings_approval", "mir", "wir", "other"];
const FIELD = "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";
const TONE = { draft: "neutral", in_review: "attention", returned: "danger", approved: "positive" } as const;

export function ContractTermsCard({ opportunityId, ownerId }: { opportunityId: string; ownerId: string | null }) {
  const { lang } = useI18n();
  const { user, roles } = useAuth();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const terms = useQuery({ queryKey: ["contract-terms", opportunityId], queryFn: () => getDealContractTerms(opportunityId) });
  const quote = useQuery({ queryKey: ["contract-quote", opportunityId], queryFn: () => getCurrentQuote(opportunityId) });
  const payments = useQuery({
    queryKey: ["contract-payments", terms.data?.id],
    queryFn: () => listContractPayments(terms.data!.id),
    enabled: !!terms.data,
  });
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("contract-") });

  // Mirrors can_record_contract_terms (SQL decides): the deal owner or a pipeline operator.
  const canRecord = canManageSalesPipeline(roles) || (!!user && user.id === ownerId);
  const isFinance = isFinanceManager(roles);
  const money = (n: number | null | undefined) =>
    n == null ? "—" : formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (terms.isLoading || quote.isLoading) return null;
  const c = terms.data;
  const q = quote.data;
  if (!c && !q && !canRecord) return null;
  const editable = !!c && (c.terms_status === "draft" || c.terms_status === "returned") && canRecord;
  const isAuthor = !!c && !!user && (user.id === c.terms_saved_by || user.id === c.submitted_by);
  const diff = c && q ? valueDifference(c.contract_value, q.subtotal_excl_vat) : null;

  return (
    <Panel
      title={pick(TEXT.title, lang)}
      subtitle={pick(TEXT.subtitle, lang)}
      action={
        canRecord && q && (!c || editable) ? (
          <Button variant={c ? "outline" : "default"} onClick={() => setFormOpen(true)}>{pick(c ? TEXT.edit : TEXT.record, lang)}</Button>
        ) : undefined
      }
    >
      {!c ? (
        <p className="text-sm text-muted-foreground">{pick(q ? TEXT.none : TEXT.noQuote, lang)}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusPill tone={TONE[c.terms_status]}>{pick(TERMS_STATUS_LABEL[c.terms_status], lang)}</StatusPill>
            {c.contract_reference_number ? <span className="text-muted-foreground">{c.contract_reference_number}</span> : null}
            {c.signed_on ? <span className="tabular-nums text-muted-foreground">{pick(TEXT.signedOn, lang)} {c.signed_on}</span> : null}
          </div>
          {c.terms_status === "returned" && c.return_reason ? (
            <Callout tone="warning" compact>{pick(TEXT.returnedWith, lang)} {c.return_reason}</Callout>
          ) : null}
          <div className="text-sm">
            <span className="text-muted-foreground">{pick(TEXT.value, lang)}: </span>
            <span className="font-semibold tabular-nums">{money(c.contract_value)}</span>
            {diff && q ? (
              <span className={`ms-2 tabular-nums ${diff.amount < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                ({pick(TEXT.vsQuote, lang)} {revisionLabel(q.revision_number)} {money(q.subtotal_excl_vat)}: {diff.pct > 0 ? "+" : ""}{diff.pct}%)
              </span>
            ) : null}
            {c.value_difference_reason ? (
              <p className="text-muted-foreground">{pick(TEXT.diffReason, lang)} {c.value_difference_reason}</p>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {pick(TEXT.periodSummary, lang)
              .replace("{d}", String(c.drawings_days ?? "—")).replace("{s}", String(c.supply_install_days ?? "—"))
              .replace("{h}", String(c.handover_days ?? "—")).replace("{c}", String(c.credit_days ?? "—"))}
          </p>
          {c.terms_status === "approved" ? (
            <ContractExecution
              contractId={c.id}
              consultantDelayDays={c.consultant_delay_days ?? 0}
              canRecord={canRecord}
              isFinance={isFinance}
              onChanged={refresh}
            />
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(TEXT.kind, lang)}</TableHead>
                <TableHead className="text-end">{pick(TEXT.pct, lang)}</TableHead>
                <TableHead className="text-end">{pick(TEXT.amount, lang)}</TableHead>
                <TableHead>{pick(TEXT.expected, lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(payments.data ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.kind === "other" && p.label ? p.label : pick(PAYMENT_KIND_LABEL[p.kind], lang)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatNumber(p.pct, lang, { maximumFractionDigits: 3 })}%</TableCell>
                  <TableCell className="text-end tabular-nums">{money(p.amount)}</TableCell>
                  <TableCell className="tabular-nums">{p.expected_on ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <Button
                onClick={async () => {
                  try {
                    await submitContractTerms(c.id);
                    toast.success(pick(TEXT.submitted, lang));
                    refresh();
                  } catch (e) {
                    toast.error(dbMessage(e, lang));
                  }
                }}
              >
                {pick(TEXT.submit, lang)}
              </Button>
            ) : null}
            {isFinance && c.terms_status === "in_review" && !isAuthor ? (
              <>
                <Button onClick={() => setApproveOpen(true)}>{pick(TEXT.approve, lang)}</Button>
                <Button variant="outline" onClick={() => setReturnOpen(true)}>{pick(TEXT.ret, lang)}</Button>
              </>
            ) : null}
          </div>
        </div>
      )}

      {q ? (
        <TermsForm
          open={formOpen}
          onOpenChange={setFormOpen}
          opportunityId={opportunityId}
          quoteValue={q.subtotal_excl_vat}
          current={c}
          currentPayments={payments.data?.map((p) => ({ kind: p.kind, pct: Number(p.pct), label: p.label ?? undefined, expected_on: p.expected_on ?? undefined })) ?? null}
          onSaved={refresh}
        />
      ) : null}
      {c ? (
        <>
          <ActionDialog
            open={approveOpen}
            onOpenChange={setApproveOpen}
            recordId={c.id}
            draftId={false}
            title={pick(TEXT.approveTitle, lang)}
            description={pick(TEXT.approveDesc, lang)}
            fields={[]}
            submitLabel={pick(TEXT.approve, lang)}
            onSubmit={async () => {
              try {
                await reviewContractTerms(c.id, "approve");
                toast.success(pick(TEXT.approved, lang));
                refresh();
              } catch (e) {
                throw asError(e, lang);
              }
            }}
          />
          <ActionDialog
            open={returnOpen}
            onOpenChange={setReturnOpen}
            recordId={c.id}
            title={pick(TEXT.retTitle, lang)}
            fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
            submitLabel={pick(TEXT.ret, lang)}
            destructive
            onSubmit={async (v) => {
              try {
                await reviewContractTerms(c.id, "return", v.reason);
                toast.success(pick(TEXT.returned, lang));
                refresh();
              } catch (e) {
                throw asError(e, lang);
              }
            }}
          />
        </>
      ) : null}
    </Panel>
  );
}

function TermsForm({
  open, onOpenChange, opportunityId, quoteValue, current, currentPayments, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  opportunityId: string;
  quoteValue: number;
  current: ContractTermsRow | null | undefined;
  currentPayments: PaymentDraft[] | null;
  onSaved: () => void;
}) {
  const { lang } = useI18n();
  const [reference, setReference] = useState(current?.contract_reference_number ?? "");
  const [signedOn, setSignedOn] = useState(current?.signed_on ?? "");
  const [value, setValue] = useState(String(current?.contract_value ?? quoteValue));
  const [reason, setReason] = useState(current?.value_difference_reason ?? "");
  const [days, setDays] = useState({
    drawings: current?.drawings_days ?? DEFAULT_PERIOD.drawingsDays,
    supply: current?.supply_install_days ?? DEFAULT_PERIOD.supplyInstallDays,
    handover: current?.handover_days ?? DEFAULT_PERIOD.handoverDays,
    credit: current?.credit_days ?? DEFAULT_PERIOD.creditDays,
  });
  const [rows, setRows] = useState<PaymentDraft[]>(currentPayments?.length ? currentPayments : [...DEFAULT_PAYMENTS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const val = Number(value);
  const total = pctTotal(rows);
  const amounts = Number.isFinite(val) ? paymentAmounts(val, rows) : [];
  const differs = Number.isFinite(val) && valueDifference(val, quoteValue) != null;
  const period = { signedOn, drawingsDays: days.drawings, supplyInstallDays: days.supply, handoverDays: days.handover };
  const money = (n: number) => formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const setRow = (i: number, patch: Partial<PaymentDraft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const num = (s: string) => (s === "" ? 0 : Number(s));

  async function save() {
    if (busy) return;
    setError(null);
    if (total !== 100) { setError(pick(TEXT.mustBe100, lang)); return; }
    if (differs && !reason.trim()) { setError(pick(TEXT.needReason, lang)); return; }
    setBusy(true);
    try {
      await saveContractTerms(opportunityId, {
        reference, signed_on: signedOn, value: val, value_difference_reason: reason,
        drawings_days: days.drawings, supply_install_days: days.supply, handover_days: days.handover, credit_days: days.credit,
        payments: rows,
      });
      toast.success(pick(TEXT.saved, lang));
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pick(TEXT.record, lang)}</DialogTitle>
          <DialogDescription>{pick(TEXT.subtitle, lang)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span>{pick(TEXT.reference, lang)}</span>
            <input className={FIELD} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span>{pick(TEXT.signedOn, lang)}</span>
            <input type="date" className={FIELD} value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span>{pick(TEXT.value, lang)}</span>
            <input inputMode="decimal" className={`${FIELD} tabular-nums`} value={value} onChange={(e) => setValue(e.target.value)} />
            <span className="text-xs text-muted-foreground tabular-nums">{pick(TEXT.vsQuote, lang)}: {money(quoteValue)}</span>
          </label>
          {differs ? (
            <label className="space-y-1 text-sm">
              <span>{pick(TEXT.diffReason, lang)}</span>
              <input className={FIELD} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
            </label>
          ) : null}
        </div>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-1 text-sm font-medium">{pick(TEXT.periods, lang)}</legend>
          {([["drawings", TEXT.drawings], ["supply", TEXT.supply], ["handover", TEXT.handover], ["credit", TEXT.credit]] as const).map(([k, l]) => (
            <label key={k} className="space-y-1 text-sm">
              <span>{pick(l, lang)}</span>
              <input type="number" min={0} className={`${FIELD} tabular-nums`} value={days[k]} onChange={(e) => setDays({ ...days, [k]: num(e.target.value) })} />
            </label>
          ))}
        </fieldset>
        <div>
          <p className="mb-1 text-sm font-medium">{pick(TEXT.payments, lang)}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(TEXT.kind, lang)}</TableHead>
                <TableHead className="w-24 text-end">{pick(TEXT.pct, lang)}</TableHead>
                <TableHead className="text-end">{pick(TEXT.amount, lang)}</TableHead>
                <TableHead>{pick(TEXT.expected, lang)}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="space-y-1">
                    <select className={FIELD} value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as PaymentKind })}>
                      {KINDS.map((k) => <option key={k} value={k}>{pick(PAYMENT_KIND_LABEL[k], lang)}</option>)}
                    </select>
                    {r.kind === "other" ? (
                      <input className={FIELD} placeholder={pick(TEXT.label, lang)} value={r.label ?? ""} maxLength={200} onChange={(e) => setRow(i, { label: e.target.value })} />
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <input inputMode="decimal" className={`${FIELD} text-end tabular-nums`} value={r.pct} onChange={(e) => setRow(i, { pct: num(e.target.value) })} />
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{amounts[i] == null ? "—" : money(amounts[i])}</TableCell>
                  <TableCell className="tabular-nums">
                    {r.kind === "other" ? (
                      <input type="date" className={FIELD} value={r.expected_on ?? ""} onChange={(e) => setRow(i, { expected_on: e.target.value })} />
                    ) : (expectedDate(r.kind, period) ?? "—")}
                  </TableCell>
                  <TableCell className="text-end">
                    {rows.length > 1 ? (
                      <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>{pick(TEXT.remove, lang)}</Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-2 flex items-center justify-between text-sm">
            <Button size="sm" variant="outline" onClick={() => setRows([...rows, { kind: "other", pct: 0 }])}>{pick(TEXT.add, lang)}</Button>
            <span className={`tabular-nums ${total === 100 ? "text-muted-foreground" : "font-medium text-destructive"}`}>
              {pick(TEXT.total, lang)}: {formatNumber(total, lang, { maximumFractionDigits: 3 })}%
            </span>
          </div>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{pick(TEXT.cancel, lang)}</Button>
          <Button disabled={busy} onClick={() => void save()}>{pick(TEXT.save, lang)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
