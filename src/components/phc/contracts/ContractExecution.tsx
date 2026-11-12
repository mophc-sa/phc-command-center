import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import { PAYMENT_KIND_LABEL, shareLeft } from "@/lib/contract-terms";
import {
  listContractApprovals, listPaymentSchedule, recordContractApproval, voidContractApproval, type ScheduleRow,
} from "@/lib/contract-terms-actions";
import { asError, pick, type Bi } from "@/lib/pricing-text";
import { riyadhToday } from "@/lib/supplier-portal";

// B2 (2026-11-12): an approved contract's execution. Each approval (drawings,
// MIR, WIR, other) makes its share of a payment due, credit days later; the
// advance fell due when finance approved the terms. Rules in SQL.
const TEXT = {
  payment: { en: "Payment", ar: "الدفعة" },
  amount: { en: "Amount", ar: "المبلغ" },
  expected: { en: "Expected", ar: "المتوقع" },
  shifted: { en: "consultant delay", ar: "تأخير الاستشاري" },
  due: { en: "Due so far", ar: "المستحق حتى الآن" },
  dueOn: { en: "Due on", ar: "تاريخ الاستحقاق" },
  record: { en: "Record an approval", ar: "تسجيل اعتماد" },
  recordDesc: { en: "The consultant's approval makes its share of the payment due, the contract's credit period after the approval date. Finance is told.", ar: "اعتماد الاستشاري يجعل نسبته من الدفعة مستحقة بعد مدة السداد من تاريخ الاعتماد. تُبلَّغ المالية." },
  approvedOn: { en: "Approval date", ar: "تاريخ الاعتماد" },
  share: { en: "Share of the work it covers (%)", ar: "نسبة العمل التي يغطيها (%)" },
  submittedOn: { en: "Date the drawings were submitted to the consultant", ar: "تاريخ تقديم الرسومات للاستشاري" },
  reference: { en: "Consultant's reference", ar: "مرجع الاستشاري" },
  file: { en: "Approval file", ar: "ملف الاعتماد" },
  note: { en: "Note", ar: "ملاحظة" },
  recorded: { en: "Approval recorded", ar: "سُجّل الاعتماد" },
  approvals: { en: "Approvals", ar: "الاعتمادات" },
  voided: { en: "Voided", ar: "ملغى" },
  void: { en: "Void", ar: "إلغاء" },
  voidTitle: { en: "Void this approval?", ar: "إلغاء هذا الاعتماد؟" },
  voidDesc: { en: "Its due no longer counts. Use it for an approval entered by mistake.", ar: "لا يُحسب استحقاقه بعد الآن. للاعتماد المُدخل خطأً." },
  reason: { en: "Reason", ar: "السبب" },
  voidDone: { en: "Approval voided", ar: "أُلغي الاعتماد" },
  delay: { en: "Consultant delay on the drawings: {n} days (MIR and WIR move by it).", ar: "تأخير الاستشاري في الرسومات: {n} يوماً (يتأخر MIR وWIR بمقداره)." },
  advanceNote: { en: "The advance fell due when finance approved the contract.", ar: "استحقت الدفعة المقدمة عند اعتماد المالية للعقد." },
} satisfies Record<string, Bi>;

const label = (r: Pick<ScheduleRow, "kind" | "label">, lang: "en" | "ar") =>
  r.kind === "other" && r.label ? r.label : pick(PAYMENT_KIND_LABEL[r.kind], lang);

export function ContractExecution({
  contractId, consultantDelayDays, canRecord, isFinance, onChanged,
}: {
  contractId: string;
  consultantDelayDays: number;
  canRecord: boolean;
  isFinance: boolean;
  onChanged: () => void;
}) {
  const { lang } = useI18n();
  const [recordOpen, setRecordOpen] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  const schedule = useQuery({ queryKey: ["contract-schedule", contractId], queryFn: () => listPaymentSchedule(contractId) });
  const approvals = useQuery({ queryKey: ["contract-approvals", contractId], queryFn: () => listContractApprovals(contractId) });
  const money = (n: number) => formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctText = (n: number) => `${formatNumber(Number(n), lang, { maximumFractionDigits: 3 })}%`;

  const rows = schedule.data ?? [];
  const recordable = rows.filter((r) => r.kind !== "advance" && shareLeft(Number(r.share_due)) > 0);
  const drawings = rows.find((r) => r.kind === "drawings_approval");
  const byPayment = new Map(rows.map((r) => [r.payment_id, r]));

  return (
    <div className="space-y-3">
      {consultantDelayDays > 0 ? (
        <p className="text-xs text-muted-foreground">{pick(TEXT.delay, lang).replace("{n}", String(consultantDelayDays))}</p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{pick(TEXT.payment, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.amount, lang)}</TableHead>
            <TableHead>{pick(TEXT.expected, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.due, lang)}</TableHead>
            <TableHead>{pick(TEXT.dueOn, lang)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.payment_id}>
              <TableCell>{label(r, lang)} <span className="text-muted-foreground tabular-nums">({pctText(r.pct)})</span></TableCell>
              <TableCell className="text-end tabular-nums">{money(r.amount)}</TableCell>
              <TableCell className="tabular-nums">
                {r.expected_on_adjusted ?? "—"}
                {r.expected_on_adjusted && r.expected_on && r.expected_on_adjusted !== r.expected_on ? (
                  <span className="ms-1 text-xs text-muted-foreground">({r.expected_on} + {pick(TEXT.shifted, lang)})</span>
                ) : null}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {Number(r.share_due) > 0 ? `${money(r.amount_due)} · ${pctText(r.share_due)}` : "—"}
              </TableCell>
              <TableCell className="tabular-nums">{r.next_due_on ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{pick(TEXT.advanceNote, lang)}</p>

      {canRecord && recordable.length > 0 ? (
        <Button variant="outline" onClick={() => setRecordOpen(true)}>{pick(TEXT.record, lang)}</Button>
      ) : null}

      {(approvals.data ?? []).length > 0 ? (
        <div>
          <p className="mb-1 text-sm font-medium">{pick(TEXT.approvals, lang)}</p>
          <ul className="space-y-1 text-sm">
            {(approvals.data ?? []).map((a) => {
              const p = byPayment.get(a.payment_id);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">{a.approved_on}</span>
                  <span>{p ? label(p, lang) : ""}</span>
                  <span className="tabular-nums text-muted-foreground">{pctText(a.share_pct)}</span>
                  {a.reference ? <span className="text-muted-foreground">{a.reference}</span> : null}
                  {a.voided_at ? <StatusPill tone="muted">{pick(TEXT.voided, lang)}: {a.void_reason}</StatusPill> : null}
                  {isFinance && !a.voided_at ? (
                    <Button size="sm" variant="ghost" onClick={() => setVoidId(a.id)}>{pick(TEXT.void, lang)}</Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <ActionDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        recordId={contractId}
        title={pick(TEXT.record, lang)}
        description={pick(TEXT.recordDesc, lang)}
        fields={[
          {
            key: "payment", type: "select", label: pick(TEXT.payment, lang), required: true,
            defaultValue: recordable[0]?.payment_id,
            options: recordable.map((r) => ({ value: r.payment_id, label: `${label(r, lang)} (${pctText(shareLeft(Number(r.share_due)))})` })),
          },
          { key: "approvedOn", type: "date", label: pick(TEXT.approvedOn, lang), required: true, defaultValue: riyadhToday() },
          { key: "share", type: "text", label: pick(TEXT.share, lang), required: true, defaultValue: "100" },
          ...(drawings
            ? [{ key: "submittedOn", type: "date" as const, label: pick(TEXT.submittedOn, lang), required: true,
                 showWhen: { field: "payment", equals: drawings.payment_id } }]
            : []),
          { key: "reference", type: "text", label: pick(TEXT.reference, lang) },
          { key: "file", type: "file", label: pick(TEXT.file, lang), folder: "contracts" },
          { key: "note", type: "textarea", label: pick(TEXT.note, lang) },
        ]}
        submitLabel={pick(TEXT.record, lang)}
        onSubmit={async (v) => {
          try {
            await recordContractApproval({
              contractId, paymentId: v.payment, approvedOn: v.approvedOn, sharePct: Number(v.share),
              submittedOn: v.payment === drawings?.payment_id ? v.submittedOn || null : null,
              reference: v.reference || null, documentPath: v.file || null, note: v.note || null,
            });
            toast.success(pick(TEXT.recorded, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={voidId != null}
        onOpenChange={(o) => !o && setVoidId(null)}
        recordId={voidId}
        title={pick(TEXT.voidTitle, lang)}
        description={pick(TEXT.voidDesc, lang)}
        fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
        submitLabel={pick(TEXT.void, lang)}
        destructive
        onSubmit={async (v) => {
          if (!voidId) return;
          try {
            await voidContractApproval(voidId, v.reason);
            toast.success(pick(TEXT.voidDone, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </div>
  );
}
