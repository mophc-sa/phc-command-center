import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { Panel } from "@/components/phc/Panel";
import { useI18n } from "@/lib/i18n";
import { startClientRound } from "@/lib/pricing-actions";
import { canMarkSent, canStartClientRound } from "@/lib/pricing-access";
import { asError, pick, type Bi } from "@/lib/pricing-text";
import { QuotationRevisions } from "@/components/phc/pricing/QuotationRevisions";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Quotations", ar: "عروض الأسعار" },
  subtitle: { en: "Every revision issued from this file. Rev 0 is the first one the client receives.", ar: "كل المراجعات الصادرة من هذا الملف. Rev 0 أول عرض يصل العميل." },
  approvedHint: { en: "The price is approved. The BD manager issues the quotation from the deal page.", ar: "السعر معتمد. يصدر مدير تطوير الأعمال عرض السعر من صفحة الصفقة." },
  round: { en: "Client changes", ar: "تعديلات العميل" },
  roundTitle: { en: "Open a client round", ar: "فتح جولة تعديل للعميل" },
  roundDesc: { en: "A new copy of the BOQ opens at package review. Edit it, freeze it and price it again; the client's current quotation stays valid until the next one replaces it.", ar: "تُفتح نسخة جديدة من جدول الكميات في دراسة الباكيج. عدّلها وجمّدها وسعّرها من جديد؛ يبقى عرض العميل الحالي صالحاً حتى يحل محله العرض التالي." },
  roundNote: { en: "What did the client change?", ar: "ما الذي غيّره العميل؟" },
  roundDone: { en: "Client round opened", ar: "فُتحت جولة العميل" },
  bafo: { en: "A discount without quantity changes goes through BAFO on the deal page.", ar: "الخصم بدون تغيير الكميات يمر عبر BAFO في صفحة الصفقة." },
} satisfies Record<string, Bi>;

export function QuotationsTab({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const [roundOpen, setRoundOpen] = useState(false);
  const canRound = canStartClientRound(file.state, rights);

  return (
    <div className="space-y-4">
      <Panel
        title={pick(TEXT.title, lang)}
        subtitle={pick(TEXT.subtitle, lang)}
        action={canRound ? <Button variant="outline" onClick={() => setRoundOpen(true)}>{pick(TEXT.round, lang)}</Button> : undefined}
      >
        {file.state === "approved" && !rights.can_issue_quotation ? (
          <p className="mb-3 text-sm text-muted-foreground">{pick(TEXT.approvedHint, lang)}</p>
        ) : null}
        <QuotationRevisions fileId={file.file_id} canSend={canMarkSent(rights)} onChanged={onChanged} />
        {canRound ? <p className="mt-3 text-xs text-muted-foreground">{pick(TEXT.bafo, lang)}</p> : null}
      </Panel>
      <ActionDialog
        open={roundOpen}
        onOpenChange={setRoundOpen}
        recordId={file.file_id}
        title={pick(TEXT.roundTitle, lang)}
        description={pick(TEXT.roundDesc, lang)}
        fields={[{ key: "note", type: "textarea", label: pick(TEXT.roundNote, lang), required: true }]}
        submitLabel={pick(TEXT.round, lang)}
        onSubmit={async (v) => {
          try {
            await startClientRound(file.file_id, v.note);
            toast.success(pick(TEXT.roundDone, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </div>
  );
}
