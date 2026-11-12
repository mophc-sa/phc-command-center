import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { Callout } from "@/components/phc/Callout";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n, formatNumber } from "@/lib/i18n";
import { getPriceSummary, getSellingTotals, listSellingGrid, reviewPrice } from "@/lib/pricing-actions";
import { canReturnLinesFromReview, canReview } from "@/lib/pricing-access";
import { asError, pick, type Bi } from "@/lib/pricing-text";
import { ReturnLinesDialog } from "@/components/phc/pricing/ReturnLinesDialog";
import type { PricingTabProps } from "@/components/phc/pricing/types";

// Finance's review of the price the GM proposed (spec §1 "price_review"). The
// buttons mirror SQL; pricing_file_review and the price guard decide.
const TEXT = {
  title: { en: "Price review", ar: "مراجعة السعر" },
  subtitle: { en: "The GM set this selling price. Approve it, return it with a reason, or send lines back to the supplier.", ar: "وضع المدير العام سعر البيع هذا. اعتمده، أو أرجعه مع السبب، أو أرجع بنوداً للمورد." },
  selling: { en: "Selling price (excl. VAT)", ar: "سعر البيع (بدون ضريبة)" },
  cost: { en: "Total cost", ar: "إجمالي التكلفة" },
  margin: { en: "Margin", ar: "الهامش" },
  floor: { en: "Margin floor", ar: "حد الهامش" },
  noFloor: { en: "None set", ar: "غير محدد" },
  proposedAt: { en: "Proposed on", ar: "اقتُرح في" },
  belowFloor: { en: "Below the margin floor. The GM gave a justification when proposing it.", ar: "تحت حد الهامش. قدّم المدير العام مبرراً عند اقتراحه." },
  approve: { en: "Approve", ar: "اعتماد" },
  approveTitle: { en: "Approve this selling price?", ar: "اعتماد سعر البيع هذا؟" },
  approveDesc: { en: "It goes to the quotation exactly as it is. The BD manager and the rep are told.", ar: "يذهب إلى عرض السعر كما هو تماماً. يُبلَّغ مدير تطوير الأعمال والمندوب." },
  approved: { en: "Price approved", ar: "اعتُمد السعر" },
  returnGm: { en: "Return to the GM", ar: "إرجاع للمدير العام" },
  returnTitle: { en: "Return the price to the GM", ar: "إرجاع السعر للمدير العام" },
  returnDesc: { en: "The GM rebuilds and proposes again. The reason stays on the file; it is not in the notice.", ar: "يعيد المدير العام البناء والاقتراح. يبقى السبب في الملف ولا يظهر في الإشعار." },
  reason: { en: "Reason", ar: "السبب" },
  returned: { en: "Price returned to the GM", ar: "أُرجع السعر للمدير العام" },
  returnLines: { en: "Return lines to the supplier", ar: "إرجاع بنود للمورد" },
  waiting: { en: "No price is waiting for review. The GM proposes it from the Selling price tab.", ar: "لا يوجد سعر بانتظار المراجعة. يقترحه المدير العام من تبويب سعر البيع." },
  approvedNote: { en: "The price is approved. The quotation is issued from the deal page.", ar: "السعر معتمد. يصدر عرض السعر من صفحة الصفقة." },
  lastReturn: { en: "Last returned with:", ar: "آخر إرجاع بسبب:" },
  readOnly: { en: "Finance reviews this price.", ar: "مراجعة هذا السعر للمالية." },
} satisfies Record<string, Bi>;

export function ApprovalTab({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const [approveOpen, setApproveOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [linesOpen, setLinesOpen] = useState(false);
  const priceId = file.internal_price_id;

  const totals = useQuery({ queryKey: ["pricing-totals", file.file_id], queryFn: () => getSellingTotals(file.file_id) });
  const price = useQuery({
    queryKey: ["pricing-price", priceId],
    queryFn: () => (priceId ? getPriceSummary(priceId) : Promise.resolve(null)),
  });
  const grid = useQuery({
    queryKey: ["pricing-grid", file.file_id],
    queryFn: () => listSellingGrid(file.file_id),
    enabled: linesOpen,
  });

  const money = (n: number | null | undefined) =>
    n == null ? "—" : formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n: number | null | undefined) => (n == null ? "—" : `${formatNumber(n, lang, { maximumFractionDigits: 2 })}%`);

  if (totals.isLoading || price.isLoading) return <SkeletonTable />;
  if (totals.error || price.error)
    return <QueryFailure retry={() => { void totals.refetch(); void price.refetch(); }} />;

  const t = totals.data;
  const p = price.data;
  const reviewable = canReview(file.state, rights);

  if (file.state !== "price_review") {
    return (
      <Panel title={pick(TEXT.title, lang)}>
        <p className="text-sm text-muted-foreground">
          {file.state === "approved" || file.state === "quoted" ? pick(TEXT.approvedNote, lang) : pick(TEXT.waiting, lang)}
        </p>
        {p?.status === "returned" && p.return_reason ? (
          <p className="mt-2 text-sm">
            <span className="text-muted-foreground">{pick(TEXT.lastReturn, lang)} </span>
            {p.return_reason}
          </p>
        ) : null}
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.subtitle, lang)}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <dt className="text-muted-foreground">{pick(TEXT.selling, lang)}</dt>
          <dd className="text-end font-semibold tabular-nums">{money(p?.proposed_price ?? t?.total_selling)}</dd>
          <dt className="text-muted-foreground">{pick(TEXT.cost, lang)}</dt>
          <dd className="text-end tabular-nums">{money(t?.total_cost)}</dd>
          <dt className="text-muted-foreground">{pick(TEXT.margin, lang)}</dt>
          <dd className="text-end tabular-nums">{pct(p?.margin_percentage ?? t?.margin_pct)}</dd>
          <dt className="text-muted-foreground">{pick(TEXT.floor, lang)}</dt>
          <dd className="text-end tabular-nums">{t?.floor_pct == null ? pick(TEXT.noFloor, lang) : pct(t.floor_pct)}</dd>
          {p?.proposed_at ? (
            <>
              <dt className="text-muted-foreground">{pick(TEXT.proposedAt, lang)}</dt>
              <dd className="text-end">{p.proposed_at.slice(0, 10)}</dd>
            </>
          ) : null}
        </dl>
        {t?.below_floor ? (
          <Callout tone="warning" className="mt-3" compact>
            {pick(TEXT.belowFloor, lang)}
          </Callout>
        ) : null}
        {reviewable ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setApproveOpen(true)}>{pick(TEXT.approve, lang)}</Button>
            <Button variant="outline" onClick={() => setReturnOpen(true)}>{pick(TEXT.returnGm, lang)}</Button>
            {canReturnLinesFromReview(file.state, rights) ? (
              <Button variant="outline" onClick={() => setLinesOpen(true)}>{pick(TEXT.returnLines, lang)}</Button>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{pick(TEXT.readOnly, lang)}</p>
        )}
      </Panel>

      <ActionDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        recordId={file.file_id}
        draftId={false}
        title={pick(TEXT.approveTitle, lang)}
        description={pick(TEXT.approveDesc, lang)}
        fields={[]}
        submitLabel={pick(TEXT.approve, lang)}
        onSubmit={async () => {
          try {
            await reviewPrice(file.file_id, "approve");
            toast.success(pick(TEXT.approved, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        recordId={file.file_id}
        title={pick(TEXT.returnTitle, lang)}
        description={pick(TEXT.returnDesc, lang)}
        fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
        submitLabel={pick(TEXT.returnGm, lang)}
        destructive
        onSubmit={async (v) => {
          try {
            await reviewPrice(file.file_id, "return", v.reason);
            toast.success(pick(TEXT.returned, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ReturnLinesDialog
        open={linesOpen}
        onOpenChange={setLinesOpen}
        fileId={file.file_id}
        fromPriceReview
        lines={(grid.data ?? []).map((g) => ({ id: g.boq_line_id, label: `${g.line_number ?? ""} ${g.sign_type}`.trim() }))}
        onDone={onChanged}
      />
    </div>
  );
}
