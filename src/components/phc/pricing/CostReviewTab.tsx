import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatNumber } from "@/lib/i18n";
import { canGmMove, canPricerMove, type InstallType } from "@/lib/pricing";
import {
  listFileInvitations,
  listSellingGrid,
  listSupplierCosts,
  movePricingFile,
  setLineChoice,
  type LineChoice,
  type SupplierCostRow,
} from "@/lib/pricing-actions";
import { canEditLineCost } from "@/lib/pricing-access";
import { INSTALL_TYPES, INSTALL_TYPE_LABEL } from "@/lib/boq-import";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";
import type { PricingTabProps } from "@/components/phc/pricing/types";
import { ReturnLinesDialog } from "@/components/phc/pricing/ReturnLinesDialog";
import { QuoteCheckPanel } from "@/components/phc/pricing/QuoteCheckPanel";

const TEXT = {
  title: { en: "Supplier prices against the BOQ", ar: "أسعار المورد مقابل الكميات" },
  sub: { en: "Pick the normal or the with-screen price, and correct an install type. Cost only; the GM sets the selling price.", ar: "اختر السعر العادي أو مع الشاشة، وصحّح نوع التركيب. هذه تكلفة فقط؛ سعر البيع يضعه المدير العام." },
  noBoq: { en: "No BOQ on this file yet.", ar: "لا كميات في هذا الملف بعد." },
  sign: { en: "Sign", ar: "اللوحة" },
  qty: { en: "Qty", ar: "الكمية" },
  unit: { en: "Supplier unit", ar: "سعر المورد للوحدة" },
  screenUnit: { en: "With screen", ar: "مع الشاشة" },
  useScreen: { en: "Use screen price", ar: "سعر الشاشة" },
  install: { en: "Install type", ar: "نوع التركيب" },
  noType: { en: "No type (fallback %)", ar: "بلا نوع (نسبة احتياطية)" },
  materials: { en: "Materials", ar: "المواد" },
  installation: { en: "Installation", ar: "التركيب" },
  fallback: { en: "% fallback", ar: "نسبة احتياطية" },
  unpriced: { en: "No supplier price", ar: "بلا سعر مورد" },
  nonSar: { en: "Not in SAR: treated as unpriced", ar: "ليس بالريال: يُعامل كبلا سعر" },
  noScreen: { en: "Screen price missing", ar: "سعر الشاشة ناقص" },
  differs: { en: "Differs from spec", ar: "يختلف عن المواصفة" },
  multi: { en: "More than one supplier", ar: "أكثر من مورد" },
  quoteBy: { en: "Quote", ar: "العرض" },
  back: { en: "Send lines back to the supplier", ar: "أرجع بنوداً للمورد" },
  backTitle: { en: "Lines back to the supplier", ar: "إرجاع بنود للمورد" },
  backDesc: { en: "Say which lines and why. This note is internal: it is a cost note, and sales do not see it.", ar: "اذكر البنود والسبب. هذه ملاحظة داخلية: هي ملاحظة تكلفة لا يراها فريق المبيعات." },
  which: { en: "Which lines, and what is wrong (internal note)", ar: "أي البنود، وما المشكلة (ملاحظة داخلية)" },
  start: { en: "Start the selling price", ar: "ابدأ بناء سعر البيع" },
  started: { en: "Selling build started", ar: "بدأ بناء سعر البيع" },
  backPr: { en: "Send back to the supplier and return the price", ar: "أرجع للمورد وأعد السعر" },
  backPrTitle: { en: "Send back to the supplier, and return the selling price", ar: "إرجاع للمورد وإعادة سعر البيع" },
  backPrDesc: {
    en: "This also returns the GM's proposed selling price for a new build: the price goes back to the GM and must be proposed again. Say which lines and why. This note is internal: it is a cost note, and sales do not see it.",
    ar: "هذا يُعيد أيضاً سعر البيع الذي اقترحه المدير العام ليُبنى من جديد: يعود السعر إلى المدير العام ويجب اقتراحه مرة أخرى. اذكر البنود والسبب. هذه ملاحظة داخلية: هي ملاحظة تكلفة لا يراها فريق المبيعات.",
  },
  backed: { en: "Sent back to the supplier", ar: "أُرجع للمورد" },
  backedPr: { en: "Sent back to the supplier; the selling price was returned too", ar: "أُرجع للمورد وأُعيد سعر البيع أيضاً" },
  requestsLoading: { en: "Checking the supplier request…", ar: "جارٍ التحقق من طلب المورد…" },
  requestsFailed: { en: "The supplier request could not be loaded, so lines cannot be sent back now.", ar: "تعذر تحميل طلب المورد، فلا يمكن إرجاع البنود الآن." },
  noLines: { en: "This BOQ has no lines.", ar: "لا بنود في هذه الكميات." },
} satisfies Record<string, Bi>;

const FIELD =
  "rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

export function CostReviewTab({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const costOk = rights.can_read_cost;
  const revisionId = file.boq_revision_id;
  const grid = useQuery({
    queryKey: ["pricing-grid", file.file_id],
    queryFn: () => listSellingGrid(file.file_id),
    enabled: revisionId != null && costOk,
  });
  const quotes = useQuery({
    queryKey: ["pricing-supplier-costs", revisionId],
    queryFn: () => listSupplierCosts(revisionId as string),
    enabled: revisionId != null && costOk,
  });
  // PR 3: a file the supplier answered through the portal reopens only the lines Zayed picks.
  const invitations = useQuery({
    queryKey: ["pricing-invitations", file.file_id],
    queryFn: () => listFileInvitations(file.file_id),
    enabled: costOk,
  });
  const editable = canEditLineCost(file.state, rights);
  const [backOpen, setBackOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnPreset, setReturnPreset] = useState<{ lines: string[]; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (n: number | null) => (n == null ? "—" : formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  // The current quotes per BOQ line, to show each one's currency and supplier.
  const quotesByLine = new Map<string, SupplierCostRow[]>();
  for (const q of quotes.data ?? []) quotesByLine.set(q.boq_line_id, [...(quotesByLine.get(q.boq_line_id) ?? []), q]);

  async function choose(lineId: string, choice: LineChoice) {
    if (busy) return;
    setBusy(true);
    try {
      await setLineChoice(file.file_id, lineId, choice);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  async function startSelling() {
    if (busy) return;
    setBusy(true);
    try {
      await movePricingFile(file.file_id, "selling_build");
      toast.success(pick(TEXT.started, lang));
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  if (!costOk) return null;
  if (!revisionId) return <p className="text-sm text-muted-foreground">{pick(TEXT.noBoq, lang)}</p>;

  if (grid.isLoading || quotes.isLoading) return <SkeletonTable />;
  if (grid.isError || quotes.isError) {
    return <QueryFailure retry={() => { void grid.refetch(); void quotes.refetch(); }} />;
  }
  const fromPriceReview = file.state === "price_review";
  const gridRows = grid.data ?? [];

  const canSendBack =
    rights.is_pricer &&
    ((file.state === "supplier_priced" && canPricerMove("supplier_priced", "at_supplier")) ||
      (file.state === "price_review" && canPricerMove("price_review", "at_supplier")));
  // PR 2's whole-file send-back must not open while the request list is unknown.
  const requestsKnown = !invitations.isLoading && !invitations.isError;
  const portalRequest = (invitations.data ?? []).find((i) => i.status === "submitted" && i.boq_revision_id === revisionId) ?? null;

  return (
    <div className="space-y-4">
      {file.state === "supplier_priced" || file.state === "price_review" ? (
        <QuoteCheckPanel
          fileId={file.file_id}
          revisionId={revisionId}
          portalRequest={portalRequest != null}
          onReturn={canSendBack && requestsKnown ? (preset) => { setReturnPreset(preset); setReturnOpen(true); } : undefined}
        />
      ) : null}
      <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.sub, lang)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.sign, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.unit, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.screenUnit, lang)}</TableHead>
              <TableHead>{pick(TEXT.useScreen, lang)}</TableHead>
              <TableHead>{pick(TEXT.install, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.materials, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.installation, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gridRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">{pick(TEXT.noLines, lang)}</TableCell>
              </TableRow>
            ) : null}
            {gridRows.map((g) => {
              const qs = quotesByLine.get(g.boq_line_id) ?? [];
              const chosen = qs.find((q) => q.id === g.supplier_quote_line_id) ?? qs[0];
              const cur = chosen?.currency;
              // A non-SAR quote is shown as its own number and currency code, never as SAR.
              const amount = (grid: number | null, quote: number | null | undefined) =>
                g.currency_mismatch ? `${money(quote ?? grid)}${cur ? ` ${cur}` : ""}` : money(grid);
              return (
                <TableRow key={g.boq_line_id}>
                  <TableCell>
                    <div className="font-medium">{g.sign_type}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.unpriced ? <StatusPill tone="danger">{pick(TEXT.unpriced, lang)}</StatusPill> : null}
                      {g.currency_mismatch ? <StatusPill tone="danger">{pick(TEXT.nonSar, lang)}{cur ? `: ${cur}` : ""}</StatusPill> : null}
                      {g.screen_price_missing ? <StatusPill tone="attention">{pick(TEXT.noScreen, lang)}</StatusPill> : null}
                      {g.quotes_count > 1 ? <StatusPill tone="attention">{pick(TEXT.multi, lang)}</StatusPill> : null}
                      {g.alternate_spec ? <StatusPill tone="attention">{pick(TEXT.differs, lang)}: {g.alternate_spec}</StatusPill> : null}
                    </div>
                    {chosen ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {pick(TEXT.quoteBy, lang)}: {chosen.vendor_name}{cur ? ` · ${cur}` : ""}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{formatNumber(g.quantity, lang)}</TableCell>
                  <TableCell className="text-end tabular-nums">{amount(g.unit_cost, chosen?.unit_cost)}</TableCell>
                  <TableCell className="text-end tabular-nums">{amount(g.unit_cost_with_screen, chosen?.unit_cost_with_screen)}</TableCell>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`${pick(TEXT.useScreen, lang)}: ${g.sign_type}`}
                      checked={g.use_screen_price}
                      disabled={!editable || busy || g.currency_mismatch || (!g.use_screen_price && g.unit_cost_with_screen == null)}
                      onChange={(e) => void choose(g.boq_line_id, { use_screen_price: e.target.checked })}
                    />
                  </TableCell>
                  <TableCell>
                    <select
                      className={FIELD}
                      aria-label={`${pick(TEXT.install, lang)}: ${g.sign_type}`}
                      value={g.install_type ?? ""}
                      disabled={!editable || busy}
                      onChange={(e) => void choose(g.boq_line_id, { install_type: (e.target.value || null) as InstallType | null })}
                    >
                      <option value="">{pick(TEXT.noType, lang)}</option>
                      {INSTALL_TYPES.map((t) => (
                        <option key={t} value={t}>{pick(INSTALL_TYPE_LABEL[t], lang)}</option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{money(g.materials)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {money(g.installation)}
                    {g.install_basis === "fallback" ? <div className="text-xs text-muted-foreground">{pick(TEXT.fallback, lang)}</div> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Panel>

      <div className="flex flex-wrap gap-2">
        {canSendBack && invitations.isError ? <p role="alert" className="text-sm text-destructive">{pick(TEXT.requestsFailed, lang)}</p> : null}
        {canSendBack ? <Button variant="outline" disabled={busy || !requestsKnown} title={invitations.isLoading ? pick(TEXT.requestsLoading, lang) : undefined} onClick={() => { setReturnPreset(null); if (portalRequest) setReturnOpen(true); else setBackOpen(true); }}>{pick(fromPriceReview ? TEXT.backPr : TEXT.back, lang)}</Button> : null}
        {rights.is_gm && file.state === "supplier_priced" && canGmMove("supplier_priced", "selling_build") ? (
          <Button disabled={busy} onClick={() => void startSelling()}>{pick(TEXT.start, lang)}</Button>
        ) : null}
      </div>

      <ActionDialog
        open={backOpen}
        onOpenChange={setBackOpen}
        title={pick(fromPriceReview ? TEXT.backPrTitle : TEXT.backTitle, lang)}
        description={pick(fromPriceReview ? TEXT.backPrDesc : TEXT.backDesc, lang)}
        fields={[{ key: "note", type: "textarea", label: pick(TEXT.which, lang), required: true }]}
        submitLabel={pick(fromPriceReview ? TEXT.backPr : TEXT.back, lang)}
        recordId={file.file_id}
        onSubmit={async (v) => {
          try {
            await movePricingFile(file.file_id, "at_supplier", v.note);
            toast.success(pick(fromPriceReview ? TEXT.backedPr : TEXT.backed, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ReturnLinesDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        fileId={file.file_id}
        fromPriceReview={fromPriceReview}
        lines={gridRows.map((g) => ({ id: g.boq_line_id, label: `${g.line_number ?? ""} ${g.sign_type}`.trim() }))}
        onDone={onChanged}
        preset={returnPreset}
      />
    </div>
  );
}
