import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import {
  buildPrice, countOpenSuggestions, getPriceSummary, getSellingTotals, listSellingGrid, proposePrice, setLineChoice, suggestExtras,
  type GridRow, type LineChoice, type TotalsRow,
} from "@/lib/pricing-actions";
import { canBuildPrice, canEditSelling, canSuggestExtras } from "@/lib/pricing-access";
import { parseDraft, draftText, type DraftRules } from "@/lib/pricing-input";
import { dbMessage, draftError, pick, type Bi } from "@/lib/pricing-text";
import { CostInputsPanel } from "@/components/phc/pricing/CostInputsPanel";
import { ExtrasPanel } from "@/components/phc/pricing/ExtrasPanel";
import { suggestRunKey, type PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  noBoq: { en: "No BOQ on this file yet.", ar: "لا كميات في هذا الملف بعد." },
  lines: { en: "Selling price by line", ar: "سعر البيع لكل بند" },
  linesSub: { en: "Cost includes installation, extras and logistics spread by value, and overhead. Margin is on price.", ar: "التكلفة تشمل التركيب والبنود الإضافية والشحن موزعة حسب القيمة والمصاريف العامة. الهامش من سعر البيع." },
  sign: { en: "Sign", ar: "اللوحة" },
  qty: { en: "Qty", ar: "الكمية" },
  cost: { en: "Cost", ar: "التكلفة" },
  marginIn: { en: "Margin %", ar: "الهامش %" },
  typed: { en: "Selling (typed)", ar: "سعر البيع (يدوي)" },
  selling: { en: "Selling", ar: "سعر البيع" },
  margin: { en: "Margin", ar: "الهامش" },
  unpriced: { en: "No supplier price", ar: "بلا سعر مورد" },
  nonSar: { en: "Not in SAR", ar: "ليس بالريال" },
  noScreen: { en: "Screen price missing", ar: "سعر الشاشة ناقص" },
  multi: { en: "More than one supplier", ar: "أكثر من مورد" },
  noLines: { en: "This BOQ has no lines.", ar: "لا بنود في هذه الكميات." },
  totals: { en: "Totals", ar: "الإجماليات" },
  totalsSub: { en: "SAR, excluding VAT. Figures from the server, not a sum of the rows above.", ar: "بالريال السعودي، بدون ضريبة القيمة المضافة. أرقام من الخادم، وليست مجموع الصفوف أعلاه." },
  totalCost: { en: "Total cost (SAR)", ar: "إجمالي التكلفة (ريال)" },
  partial: { en: "partial", ar: "جزئي" },
  totalSelling: { en: "Total selling price (SAR)", ar: "إجمالي سعر البيع (ريال)" },
  marginTotal: { en: "Margin", ar: "الهامش" },
  floor: { en: "Margin floor", ar: "الحد الأدنى للهامش" },
  noFloor: { en: "No floor set", ar: "لا حد أدنى محدد" },
  materials: { en: "Materials", ar: "المواد" },
  installation: { en: "Installation", ar: "التركيب" },
  extrasT: { en: "Extras", ar: "البنود الإضافية" },
  logistics: { en: "Logistics", ar: "الشحن" },
  overhead: { en: "Overhead", ar: "المصاريف العامة" },
  belowFloor: { en: "Below the floor: you will be asked to write why this price is worth taking.", ar: "أقل من الحد الأدنى: ستُسأل عن سبب أخذ هذا السعر." },
  belowFloorDlg: { en: "Below the margin floor: write why this price is worth taking.", ar: "أقل من الحد الأدنى للهامش: اكتب لماذا يستحق هذا السعر." },
  aboveFloorDlg: { en: "At or above the floor", ar: "عند الحد الأدنى أو أعلى منه" },
  confirmTitle: { en: "Propose this price to Zayed?", ar: "اقتراح هذا السعر على زايد؟" },
  confirmSub: { en: "These are the figures that will be proposed (SAR, excluding VAT). If they changed meanwhile, the server refuses and you review the new ones.", ar: "هذه الأرقام التي ستُقترح (ريال، بدون ضريبة). إن تغيّرت في الأثناء يرفض الخادم وتراجع الجديدة." },
  status: { en: "Floor check", ar: "فحص الحد الأدنى" },
  justification: { en: "Justification", ar: "المبرر" },
  warnTitle: { en: "The price is not complete yet:", ar: "السعر غير مكتمل بعد:" },
  unpricedWarn: { en: "lines have no price (no supplier price in SAR, or no margin or typed price)", ar: "بنود بلا سعر (لا سعر مورد بالريال، أو لا هامش ولا سعر يدوي)" },
  nonSarWarn: { en: "lines are quoted in another currency", ar: "بنود مسعّرة بعملة أخرى" },
  multiWarn: { en: "lines have prices from more than one supplier (one supplier per file for now)", ar: "بنود لها أسعار من أكثر من مورد (مورد واحد لكل ملف حالياً)" },
  screenWarn: { en: "lines use the with-screen price but the supplier gave none", ar: "بنود تستخدم سعر الشاشة ولم يحدده المورد" },
  openWarn: {
    en: "Propose is blocked: some suggested extras are not decided yet. Accept or dismiss each suggested item in Extras above. If the list shows none, press Check suggestions: an expected item may have no row yet.",
    ar: "الاقتراح موقوف: بعض البنود الإضافية المقترحة لم يُقرَّر فيها بعد. اقبل أو ارفض كل بند مقترح في البنود الإضافية أعلاه. إن لم تظهر بنود فاضغط افحص الاقتراحات: قد يكون بند متوقع بلا صف بعد.",
  },
  openUnknown: { en: "Checking which extras are still open…", ar: "جارٍ فحص البنود الإضافية المفتوحة…" },
  inputsPending: { en: "Some logistics or project inputs are not saved yet (or were refused). Finish them before building or proposing.", ar: "بعض مُدخلات الشحن أو المشروع لم تُحفظ بعد (أو رُفضت). أنهِها قبل البناء أو الاقتراح." },
  suggestFailed: { en: "Could not check the extras suggestions. Try again before proposing.", ar: "تعذّر فحص اقتراحات البنود الإضافية. أعد المحاولة قبل الاقتراح." },
  retry: { en: "Try again", ar: "أعد المحاولة" },
  buildBlocked: { en: "Build price is off until the lines above are fully priced.", ar: "بناء السعر موقوف حتى تُسعَّر البنود أعلاه بالكامل." },
  price: { en: "Internal price", ar: "السعر الداخلي" },
  stale: { en: "The grid changed since the last build; propose again to use the new figures.", ar: "تغيّر الجدول منذ آخر بناء؛ اقترح مجدداً لاعتماد الأرقام الجديدة." },
  returned: { en: "Returned by Zayed", ar: "أعاده زايد" },
  build: { en: "Build price", ar: "ابنِ السعر" },
  built: { en: "Price built", ar: "بُني السعر" },
  propose: { en: "Propose price", ar: "اقترح السعر" },
  proposed: { en: "Proposed: the price goes to Zayed's review", ar: "اقتُرح السعر: يذهب لمراجعة زايد" },
  reload: { en: "The figures were reloaded. Review the new totals before proposing again.", ar: "أُعيد تحميل الأرقام. راجع الإجماليات الجديدة قبل الاقتراح مجدداً." },
  gmNote: { en: "Zayed reviews the price you propose. He can approve a price only if he did not set its figures; prices you build are yours.", ar: "يراجع زايد السعر الذي تقترحه. لا يعتمد سعراً وضع هو أرقامه؛ الأسعار التي تبنيها أنت أرقامها لك." },
  costLink: { en: "Screen or normal price and install type are set on the Cost review tab.", ar: "سعر الشاشة أو العادي ونوع التركيب يُحددان في تبويب مراجعة التكلفة." },
  costLinkBtn: { en: "Open Cost review", ar: "افتح مراجعة التكلفة" },
  inEffect: { en: "In effect", ar: "المعمول به" },
  byTyped: { en: "Typed price", ar: "السعر اليدوي" },
  byMargin: { en: "Line margin", ar: "هامش البند" },
  byDefault: { en: "Default margin", ar: "الهامش الافتراضي" },
  marginSwitch: { en: "Typing a margin replaces the typed price on this line.", ar: "كتابة هامش تحل محل السعر اليدوي في هذا البند." },
  priceSwitch: { en: "Typing a price replaces the margin on this line.", ar: "كتابة سعر تحل محل الهامش في هذا البند." },
  pricerNote: { en: "Only the GM sets margins and selling prices. You set the cost choices: screen price, install type, logistics and extras.", ar: "الهوامش وأسعار البيع يضعها المدير العام فقط. أنت تضبط اختيارات التكلفة: سعر الشاشة ونوع التركيب والشحن والبنود الإضافية." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-24 rounded-md border border-border bg-background px-2 py-1 text-end text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

/**
 * A number box that keeps its text as typed and turns it into a number only when you leave it
 * ("1.0", "1.05" and "20.05" stay as typed). A refused entry stays on screen with the reason.
 */
function NumberBox(props: {
  saved: number | null;
  rules: DraftRules;
  disabled: boolean;
  label: string;
  title?: string;
  placeholder?: string;
  onCommit: (next: number | null) => void;
}) {
  const { lang } = useI18n();
  const [text, setText] = useState(draftText(props.saved));
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <input
        type="text" inputMode="decimal" className={FIELD} aria-label={props.label} title={props.title}
        aria-invalid={error ? true : undefined}
        value={text} placeholder={props.placeholder} disabled={props.disabled}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        onBlur={() => {
          const r = parseDraft(text, props.rules);
          if (!r.ok) return setError(draftError(r.reason, lang));
          if (r.value !== props.saved) props.onCommit(r.value);
        }}
      />
      {error ? <div className="mt-1 max-w-48 text-xs text-destructive">{error}</div> : null}
    </div>
  );
}

export function SellingPriceTab(props: PricingTabProps) {
  const { file, rights, onChanged } = props;
  const { lang } = useI18n();
  const qc = useQueryClient();
  const revisionId = file.boq_revision_id;
  // The tab shows cost; a GM delegate without cost access never sees it (RLS returns nothing anyway).
  const costOk = rights.can_read_cost && revisionId != null;
  const grid = useQuery({ queryKey: ["pricing-grid", file.file_id], queryFn: () => listSellingGrid(file.file_id), enabled: costOk });
  const totals = useQuery({ queryKey: ["pricing-totals", file.file_id], queryFn: () => getSellingTotals(file.file_id), enabled: costOk });
  const price = useQuery({
    queryKey: ["pricing-price", file.internal_price_id],
    queryFn: () => getPriceSummary(file.internal_price_id as string),
    enabled: costOk && file.internal_price_id != null,
  });

  // Suggest on open, once per file and round, so the open count below is true.
  const suggestable = costOk && canSuggestExtras(file.state, rights);
  const suggestKey = suggestRunKey(file.file_id, revisionId);
  // The query is the "has the on-open check finished for this file and round" record. Check suggestions
  // in the Extras panel writes a success into it. Never refetches by itself; Try again does.
  const suggest = useQuery({
    queryKey: suggestKey,
    queryFn: async () => {
      try {
        const n = await suggestExtras(file.file_id);
        void qc.invalidateQueries({ queryKey: ["pricing-extras", file.file_id] });
        void qc.invalidateQueries({ queryKey: ["pricing-open-suggestions", file.file_id] });
        return n;
      } catch (e) {
        toast.error(dbMessage(e, lang));
        throw e;
      }
    },
    enabled: suggestable,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const suggestStatus: "na" | "running" | "done" | "failed" = !suggestable
    ? "na"
    : suggest.isSuccess ? "done" : suggest.isError && !suggest.isFetching ? "failed" : "running";

  const open = useQuery({
    queryKey: ["pricing-open-suggestions", file.file_id, revisionId],
    queryFn: () => countOpenSuggestions(file.file_id),
    enabled: costOk && (suggestStatus === "done" || suggestStatus === "na"),
  });

  const sellingEditable = canEditSelling(file.state, rights);
  const canBuild = canBuildPrice(file.state, rights);
  const [snapshot, setSnapshot] = useState<TotalsRow | null>(null);
  const [inputsPending, setInputsPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const money = (n: number | null | undefined) => (n == null ? "—" : formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (n: number | null | undefined) => (n == null ? "—" : `${formatNumber(n, lang, { maximumFractionDigits: 2 })}%`);

  if (!rights.can_read_cost) return null;
  if (!revisionId) return <p className="text-sm text-muted-foreground">{pick(TEXT.noBoq, lang)}</p>;
  if (grid.isLoading || totals.isLoading) return <SkeletonTable />;
  if (grid.isError || totals.isError) {
    return <QueryFailure retry={() => { void grid.refetch(); void totals.refetch(); }} />;
  }

  const t = totals.data;
  const gridRows = grid.data ?? [];
  const openCount = open.data;
  const unpriced = t?.unpriced_lines ?? 0;
  const incomplete = !!t && (t.unpriced_lines > 0 || t.non_sar_lines > 0 || t.multi_quote_lines > 0 || t.screen_price_missing_lines > 0);
  // The server refuses all of these too; this only says why the button is off.
  const ready = !!t && !incomplete && t.line_count > 0 && (t.total_selling ?? 0) > 0;
  const belowFloor = t?.below_floor === true;
  const fresh = !totals.isFetching && !grid.isFetching && !open.isFetching && !suggest.isFetching;
  // Propose waits for the on-open suggestion check of this file and round, a fresh open count, and saved inputs.
  const suggestSettled = suggestStatus === "done" || suggestStatus === "na";
  const extrasDecided = suggestSettled && !open.isError && openCount === 0;
  const canPropose = canBuild && ready && extrasDecided && fresh && !inputsPending;
  const priceStale = price.data?.proposed_price != null && t?.total_selling != null && price.data.proposed_price !== t.total_selling;

  async function choose(g: GridRow, choice: LineChoice) {
    if (busy) return;
    setBusy(true);
    try {
      await setLineChoice(file.file_id, g.boq_line_id, choice);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
      setResetNonce((n) => n + 1); // the box shows the saved figure again
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    if (busy) return;
    setBusy(true);
    try {
      await buildPrice(file.file_id);
      toast.success(pick(TEXT.built, lang));
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function propose(snap: TotalsRow, justification: string) {
    if (busy || snap.total_selling == null) return;
    setBusy(true);
    try {
      // Exactly the figures the confirmation showed.
      await proposePrice(file.file_id, snap.total_selling, snap.total_cost, snap.below_floor ? justification.trim() : undefined);
      toast.success(pick(TEXT.proposed, lang));
      onChanged();
    } catch (e) {
      // A stale total (or any refusal) reloads the figures the GM is looking at.
      toast.error(`${dbMessage(e, lang)} ${pick(TEXT.reload, lang)}`);
      onChanged();
    } finally {
      setBusy(false);
      setSnapshot(null);
    }
  }

  const warn = (n: number | undefined, label: Bi) => (n && n > 0 ? <li>{formatNumber(n, lang)} {pick(label, lang)}</li> : null);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{pick(rights.is_gm ? TEXT.gmNote : TEXT.pricerNote, lang)}</p>
      {props.goToCost ? (
        <p className="text-sm text-muted-foreground">
          {pick(TEXT.costLink, lang)}{" "}
          <Button size="sm" variant="outline" onClick={props.goToCost}>{pick(TEXT.costLinkBtn, lang)}</Button>
        </p>
      ) : null}
      <CostInputsPanel {...props} onPending={setInputsPending} />
      <ExtrasPanel {...props} />

      <Panel title={pick(TEXT.lines, lang)} subtitle={pick(TEXT.linesSub, lang)}>
        {sellingEditable ? <p className="mb-2 text-xs text-muted-foreground">{pick(TEXT.marginSwitch, lang)} {pick(TEXT.priceSwitch, lang)}</p> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.sign, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.cost, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.marginIn, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.typed, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.selling, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.margin, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gridRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">{pick(TEXT.noLines, lang)}</TableCell>
              </TableRow>
            ) : null}
            {gridRows.map((g) => (
              <TableRow key={g.boq_line_id}>
                <TableCell>
                  <div className="font-medium">{g.sign_type}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.unpriced ? <StatusPill tone="danger">{pick(TEXT.unpriced, lang)}</StatusPill> : null}
                    {g.currency_mismatch ? <StatusPill tone="danger">{pick(TEXT.nonSar, lang)}</StatusPill> : null}
                    {g.screen_price_missing ? <StatusPill tone="attention">{pick(TEXT.noScreen, lang)}</StatusPill> : null}
                    {g.quotes_count > 1 ? <StatusPill tone="attention">{pick(TEXT.multi, lang)}</StatusPill> : null}
                  </div>
                </TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(g.quantity, lang)}</TableCell>
                <TableCell className="text-end tabular-nums">{money(g.line_cost)}</TableCell>
                <TableCell className="text-end">
                  <NumberBox
                    key={`m-${g.boq_line_id}-${g.line_margin_pct ?? ""}-${resetNonce}`}
                    saved={g.line_margin_pct} rules={{ above: -100, below: 100 }}
                    label={`${pick(TEXT.marginIn, lang)}: ${g.sign_type}`}
                    title={pick(TEXT.marginSwitch, lang)}
                    placeholder={g.default_margin_pct == null ? "" : String(g.default_margin_pct)}
                    disabled={!sellingEditable || busy}
                    onCommit={(next) => void choose(g, { margin_pct: next })}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <NumberBox
                    key={`s-${g.boq_line_id}-${g.typed_selling_price ?? ""}-${resetNonce}`}
                    saved={g.typed_selling_price} rules={{ above: 0 }}
                    label={`${pick(TEXT.typed, lang)}: ${g.sign_type}`}
                    title={pick(TEXT.priceSwitch, lang)}
                    disabled={!sellingEditable || busy}
                    onCommit={(next) => void choose(g, { selling_price: next })}
                  />
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {money(g.selling_price)}
                  {g.selling_price != null ? (
                    <div className="text-xs font-normal text-muted-foreground">
                      {pick(TEXT.inEffect, lang)}: {pick(g.typed_selling_price != null ? TEXT.byTyped : g.line_margin_pct != null ? TEXT.byMargin : TEXT.byDefault, lang)}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-end tabular-nums">{pct(g.margin_pct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <Panel title={pick(TEXT.totals, lang)} subtitle={pick(TEXT.totalsSub, lang)} tone={belowFloor ? "attention" : "default"}>
        <div className="space-y-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-4">
            <div><dt className="text-muted-foreground">{pick(TEXT.totalCost, lang)}</dt><dd className="text-lg font-semibold tabular-nums">
              {unpriced > 0 ? <>{money(t?.total_cost)} <StatusPill tone="attention">{pick(TEXT.partial, lang)}</StatusPill></> : money(t?.total_cost)}
            </dd></div>
            <div><dt className="text-muted-foreground">{pick(TEXT.totalSelling, lang)}</dt><dd className="text-lg font-semibold tabular-nums">{unpriced > 0 ? "—" : money(t?.total_selling)}</dd></div>
            <div><dt className="text-muted-foreground">{pick(TEXT.marginTotal, lang)}</dt><dd className="text-lg font-semibold tabular-nums">{unpriced > 0 ? "—" : pct(t?.margin_pct)}</dd></div>
            <div><dt className="text-muted-foreground">{pick(TEXT.floor, lang)}</dt><dd className="text-lg font-semibold tabular-nums">{t?.floor_pct == null ? pick(TEXT.noFloor, lang) : pct(t.floor_pct)}</dd></div>
          </dl>
          {t ? (
            <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-5">
              <div><dt>{pick(TEXT.materials, lang)}</dt><dd className="tabular-nums">{money(t.materials_total)}</dd></div>
              <div><dt>{pick(TEXT.installation, lang)}</dt><dd className="tabular-nums">{money(t.installation_total)}</dd></div>
              <div><dt>{pick(TEXT.extrasT, lang)}</dt><dd className="tabular-nums">{money(t.extras_total)}</dd></div>
              <div><dt>{pick(TEXT.logistics, lang)}</dt><dd className="tabular-nums">{money(t.logistics_total)}</dd></div>
              <div><dt>{pick(TEXT.overhead, lang)}</dt><dd className="tabular-nums">{pct(t.overhead_pct)}</dd></div>
            </dl>
          ) : null}
          {incomplete && t ? (
            <div className="text-destructive">
              <p>{pick(TEXT.warnTitle, lang)}</p>
              <ul className="ms-5 list-disc">
                {warn(t.unpriced_lines, TEXT.unpricedWarn)}
                {warn(t.non_sar_lines, TEXT.nonSarWarn)}
                {warn(t.multi_quote_lines, TEXT.multiWarn)}
                {warn(t.screen_price_missing_lines, TEXT.screenWarn)}
              </ul>
            </div>
          ) : null}
          {canBuild && incomplete ? <p className="text-muted-foreground">{pick(TEXT.buildBlocked, lang)}</p> : null}
          {canBuild && suggestStatus === "failed" ? (
            <p className="text-destructive">
              {pick(TEXT.suggestFailed, lang)}{" "}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void suggest.refetch()}>{pick(TEXT.retry, lang)}</Button>
            </p>
          ) : null}
          {canBuild && suggestStatus !== "failed" && (openCount == null || suggestStatus === "running") ? <p className="text-muted-foreground">{pick(TEXT.openUnknown, lang)}</p> : null}
          {canBuild && suggestSettled && openCount != null && openCount > 0 ? (
            <p className="text-amber-light">{formatNumber(openCount, lang)} · {pick(TEXT.openWarn, lang)}</p>
          ) : null}
          {price.data ? (
            <p>
              {pick(TEXT.price, lang)}: {money(price.data.proposed_price)} · {price.data.status}
              {priceStale ? <span className="text-amber-light"> · {pick(TEXT.stale, lang)}</span> : null}
            </p>
          ) : null}
          {price.data?.status === "returned" && price.data.return_reason ? (
            <p className="text-amber-light">{pick(TEXT.returned, lang)}: {price.data.return_reason}</p>
          ) : null}
          {belowFloor && canBuild ? <p className="text-amber-light">{pick(TEXT.belowFloor, lang)}</p> : null}
          {canBuild && inputsPending ? <p className="text-destructive">{pick(TEXT.inputsPending, lang)}</p> : null}
          {canBuild ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || !ready || !fresh || inputsPending} onClick={() => void build()}>
                {pick(TEXT.build, lang)}
              </Button>
              <Button disabled={busy || !canPropose} onClick={() => setSnapshot(t ?? null)}>
                {pick(TEXT.propose, lang)}
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>
      <ActionDialog
        open={snapshot != null}
        recordId={file.file_id}
        onOpenChange={(o) => !o && !busy && setSnapshot(null)}
        title={pick(TEXT.confirmTitle, lang)}
        description={snapshot ? (
          <span className="block space-y-2">
            <span className="block">{pick(TEXT.confirmSub, lang)}</span>
            <span className="grid grid-cols-2 gap-x-4 gap-y-1 text-foreground">
              <span>{pick(TEXT.totalSelling, lang)}</span><span className="text-end tabular-nums">{money(snapshot.total_selling)}</span>
              <span>{pick(TEXT.totalCost, lang)}</span><span className="text-end tabular-nums">{money(snapshot.total_cost)}</span>
              <span>{pick(TEXT.marginTotal, lang)}</span><span className="text-end tabular-nums">{pct(snapshot.margin_pct)}</span>
              <span>{pick(TEXT.floor, lang)}</span><span className="text-end tabular-nums">{snapshot.floor_pct == null ? pick(TEXT.noFloor, lang) : pct(snapshot.floor_pct)}</span>
              <span>{pick(TEXT.status, lang)}</span>
              <span className="text-end">{snapshot.below_floor ? pick(TEXT.belowFloorDlg, lang) : pick(TEXT.aboveFloorDlg, lang)}</span>
            </span>
          </span>
        ) : undefined}
        fields={snapshot?.below_floor ? [{ key: "justification", type: "textarea", label: pick(TEXT.justification, lang), required: true }] : []}
        submitLabel={pick(TEXT.propose, lang)}
        onSubmit={async (v) => { if (snapshot) await propose(snapshot, v.justification ?? ""); }}
      />
    </div>
  );
}
