import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { Callout } from "@/components/phc/Callout";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n } from "@/lib/i18n";
import { PRICING_STATE_LABEL } from "@/lib/pricing";
import { answerNeedsInfo, getDealPricingFile, issueQuotation, type DealPricingFile } from "@/lib/pricing-actions";
import { canIssue, canMarkSent, daysWaiting, nextOwner, NEXT_OWNER_LABEL } from "@/lib/pricing-access";
import { addDays, riyadhToday } from "@/lib/supplier-portal";
import { asError, pick, type Bi } from "@/lib/pricing-text";
import { QuotationRevisions } from "@/components/phc/pricing/QuotationRevisions";
import { usePricingRights } from "@/components/phc/pricing/usePricingRights";

// The deal page's view of its pricing file (spec §1: sales see the state and how
// long it has waited, then the selling price after approval; never cost).
const TEXT = {
  title: { en: "Pricing", ar: "التسعير" },
  waiting: { en: "days at this step", ar: "يوم في هذه الخطوة" },
  next: { en: "Next step:", ar: "الخطوة التالية:" },
  missing: { en: "Pricing needs from you", ar: "التسعير يحتاج منك" },
  due: { en: "by", ar: "قبل" },
  answer: { en: "Answer", ar: "الرد" },
  answerTitle: { en: "Answer the missing items", ar: "الرد على النواقص" },
  answerDesc: { en: "Say what you sent or attached. The file goes back to estimation.", ar: "اذكر ما أرسلته أو أرفقته. يعود الملف إلى التقدير." },
  answerNote: { en: "Your answer", ar: "ردّك" },
  answered: { en: "Answer sent to estimation", ar: "أُرسل الرد إلى التقدير" },
  issue: { en: "Issue quotation", ar: "إصدار عرض السعر" },
  issueTitle: { en: "Issue the quotation", ar: "إصدار عرض السعر" },
  issueDesc: { en: "The quotation carries the approved selling price and its lines, plus 15% VAT. After issuing, print it to PDF and send it, then mark it as sent.", ar: "يحمل العرض سعر البيع المعتمد وبنوده مع ضريبة 15%. بعد الإصدار اطبعه PDF وأرسله، ثم سجّل الإرسال." },
  validUntil: { en: "Valid until", ar: "صالح حتى" },
  payment: { en: "Payment terms", ar: "شروط الدفع" },
  paymentHint: { en: "e.g. 30% advance, 40% on delivery (MIR), 30% on installation (WIR)", ar: "مثال: 30% مقدمة، 40% عند التوريد (MIR)، 30% عند التركيب (WIR)" },
  delivery: { en: "Delivery and installation period", ar: "مدة التوريد والتركيب" },
  scope: { en: "Scope summary", ar: "ملخص النطاق" },
  issued: { en: "Quotation issued", ar: "صدر عرض السعر" },
  approvedNote: { en: "The selling price is approved; the BD manager issues the quotation.", ar: "اعتُمد سعر البيع؛ يصدر مدير تطوير الأعمال عرض السعر." },
} satisfies Record<string, Bi>;

/** The deal's main pricing file, or (B4) a given variation file with its own title. */
export function DealPricingCard({ opportunityId, file: given, title }: { opportunityId: string; file?: DealPricingFile; title?: string }) {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [answerOpen, setAnswerOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const rights = usePricingRights();
  const file = useQuery({
    queryKey: ["pricing-deal-file", opportunityId],
    queryFn: () => getDealPricingFile(opportunityId),
    enabled: !given,
  });
  const onChanged = () => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("pricing-") });

  const f = given ?? file.data;
  if (!f || !rights.data) return null;
  const r = rights.data;
  const owner = nextOwner(f.state);
  const days = daysWaiting(f.state_changed_at);
  const today = riyadhToday();

  return (
    <Panel
      title={title ?? pick(TEXT.title, lang)}
      action={canIssue(f.state, r) ? <Button onClick={() => setIssueOpen(true)}>{pick(TEXT.issue, lang)}</Button> : undefined}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusPill tone={f.state === "quoted" ? "positive" : f.state === "needs_info" ? "attention" : "neutral"}>
          {pick(PRICING_STATE_LABEL[f.state], lang)}
        </StatusPill>
        <span className="tabular-nums text-muted-foreground">{days} {pick(TEXT.waiting, lang)}</span>
        {owner !== "none" ? (
          <span className="text-muted-foreground">{pick(TEXT.next, lang)} {pick(NEXT_OWNER_LABEL[owner], lang)}</span>
        ) : null}
      </div>

      {f.state === "needs_info" ? (
        <Callout
          tone="attention"
          className="mt-3"
          title={`${pick(TEXT.missing, lang)}${f.needs_info_due ? ` ${pick(TEXT.due, lang)} ${f.needs_info_due}` : ""}`}
          action={<Button size="sm" onClick={() => setAnswerOpen(true)}>{pick(TEXT.answer, lang)}</Button>}
        >
          <ul className="list-disc ps-5">
            {(f.needs_info_items ?? []).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Callout>
      ) : null}

      {f.state === "approved" && !r.can_issue_quotation ? (
        <p className="mt-3 text-sm text-muted-foreground">{pick(TEXT.approvedNote, lang)}</p>
      ) : null}

      {/* Every round's revisions; the client's current one stays valid during a new round. */}
      <div className="mt-4">
        <QuotationRevisions fileId={f.id} canSend={canMarkSent(r)} onChanged={onChanged} />
      </div>

      <ActionDialog
        open={answerOpen}
        onOpenChange={setAnswerOpen}
        recordId={f.id}
        title={pick(TEXT.answerTitle, lang)}
        description={pick(TEXT.answerDesc, lang)}
        fields={[{ key: "note", type: "textarea", label: pick(TEXT.answerNote, lang), required: true }]}
        submitLabel={pick(TEXT.answer, lang)}
        onSubmit={async (v) => {
          try {
            await answerNeedsInfo(f.id, v.note);
            toast.success(pick(TEXT.answered, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        recordId={f.id}
        title={pick(TEXT.issueTitle, lang)}
        description={pick(TEXT.issueDesc, lang)}
        fields={[
          { key: "validUntil", type: "date", label: pick(TEXT.validUntil, lang), required: true, defaultValue: addDays(today, 30) },
          { key: "payment", type: "textarea", label: pick(TEXT.payment, lang), placeholder: pick(TEXT.paymentHint, lang) },
          { key: "delivery", type: "text", label: pick(TEXT.delivery, lang) },
          { key: "scope", type: "textarea", label: pick(TEXT.scope, lang) },
        ]}
        submitLabel={pick(TEXT.issue, lang)}
        onSubmit={async (v) => {
          let revisionId: string;
          try {
            revisionId = await issueQuotation(f.id, {
              validUntil: v.validUntil,
              paymentTerms: v.payment ?? "",
              deliveryTerms: v.delivery ?? "",
              scopeSummary: v.scope ?? "",
            });
          } catch (e) {
            throw asError(e, lang);
          }
          toast.success(pick(TEXT.issued, lang));
          onChanged();
          void navigate({ to: "/quotation-print/$revisionId", params: { revisionId } });
        }}
      />
    </Panel>
  );
}
