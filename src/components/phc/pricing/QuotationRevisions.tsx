import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import { listFileQuotations, markQuotationSent } from "@/lib/pricing-actions";
import { QUOTE_STATUS_LABEL, revisionLabel } from "@/lib/quotation-doc";
import { asError, pick, type Bi } from "@/lib/pricing-text";

// The revisions issued from one pricing file. Selling figures only: used on the
// pricing file (Quotations tab) and on the deal page.
const TEXT = {
  rev: { en: "Revision", ar: "المراجعة" },
  status: { en: "Status", ar: "الحالة" },
  subtotal: { en: "Excl. VAT", ar: "بدون ضريبة" },
  total: { en: "Incl. VAT", ar: "شامل الضريبة" },
  valid: { en: "Valid until", ar: "صالح حتى" },
  open: { en: "Open / print", ar: "فتح / طباعة" },
  markSent: { en: "Mark as sent", ar: "تسجيل الإرسال" },
  sentTitle: { en: "Mark this quotation as sent to the client?", ar: "تسجيل أن هذا العرض أُرسل للعميل؟" },
  sentDesc: { en: "Do this after you send the PDF. The quotation cannot be edited afterwards; a change needs a new round.", ar: "سجّل هذا بعد إرسال ملف PDF. لا يُعدَّل العرض بعدها؛ أي تغيير يحتاج جولة جديدة." },
  sent: { en: "Recorded as sent", ar: "سُجّل الإرسال" },
  none: { en: "No quotation has been issued from this file yet.", ar: "لم يصدر عرض سعر من هذا الملف بعد." },
} satisfies Record<string, Bi>;

const TONE = { approved: "attention", submitted: "positive", superseded: "muted", withdrawn: "muted", draft: "neutral", pending_approval: "attention" } as const;

export function QuotationRevisions({ fileId, canSend, onChanged }: { fileId: string; canSend: boolean; onChanged: () => void }) {
  const { lang } = useI18n();
  const [sendId, setSendId] = useState<string | null>(null);
  const revs = useQuery({ queryKey: ["pricing-quotes", fileId], queryFn: () => listFileQuotations(fileId) });
  const money = (n: number) => formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (revs.isLoading) return <SkeletonTable />;
  if (revs.error) return <QueryFailure retry={() => void revs.refetch()} />;
  const list = revs.data ?? [];
  if (list.length === 0) return <p className="text-sm text-muted-foreground">{pick(TEXT.none, lang)}</p>;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{pick(TEXT.rev, lang)}</TableHead>
            <TableHead>{pick(TEXT.status, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.subtotal, lang)}</TableHead>
            <TableHead className="text-end">{pick(TEXT.total, lang)}</TableHead>
            <TableHead>{pick(TEXT.valid, lang)}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{revisionLabel(r.revision_number)}</TableCell>
              <TableCell>
                <StatusPill tone={TONE[r.status]}>{pick(QUOTE_STATUS_LABEL[r.status], lang)}</StatusPill>
              </TableCell>
              <TableCell className="text-end tabular-nums">{money(r.subtotal_excl_vat)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(r.total_incl_vat)}</TableCell>
              <TableCell className="tabular-nums">{r.valid_until ?? "—"}</TableCell>
              <TableCell className="text-end">
                <div className="flex justify-end gap-2">
                  {canSend && r.is_current && r.status === "approved" ? (
                    <Button size="sm" variant="outline" onClick={() => setSendId(r.id)}>{pick(TEXT.markSent, lang)}</Button>
                  ) : null}
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/quotation-print/$revisionId" params={{ revisionId: r.id }}>{pick(TEXT.open, lang)}</Link>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ActionDialog
        open={sendId != null}
        onOpenChange={(o) => !o && setSendId(null)}
        recordId={sendId}
        draftId={false}
        title={pick(TEXT.sentTitle, lang)}
        description={pick(TEXT.sentDesc, lang)}
        fields={[]}
        submitLabel={pick(TEXT.markSent, lang)}
        onSubmit={async () => {
          if (!sendId) return;
          try {
            await markQuotationSent(sendId);
            toast.success(pick(TEXT.sent, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </>
  );
}
