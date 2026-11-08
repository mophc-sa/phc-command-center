import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import {
  buildPrice, countOpenSuggestions, getPriceSummary, getSellingTotals, listSellingGrid, proposePrice, setLineChoice, suggestExtras,
  type GridRow, type LineChoice,
} from "@/lib/pricing-actions";
import { canBuildPrice, canEditSelling, canSuggestExtras } from "@/lib/pricing-access";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { CostInputsPanel } from "@/components/phc/pricing/CostInputsPanel";
import { ExtrasPanel } from "@/components/phc/pricing/ExtrasPanel";
import type { PricingTabProps } from "@/components/phc/pricing/types";

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
  totalsSub: { en: "Figures from the server, not a sum of the rows above.", ar: "أرقام من الخادم، وليست مجموع الصفوف أعلاه." },
  totalCost: { en: "Total cost", ar: "إجمالي التكلفة" },
  totalSelling: { en: "Total selling price", ar: "إجمالي سعر البيع" },
  marginTotal: { en: "Margin", ar: "الهامش" },
  floor: { en: "Margin floor", ar: "الحد الأدنى للهامش" },
  noFloor: { en: "No floor set", ar: "لا حد أدنى محدد" },
  materials: { en: "Materials", ar: "المواد" },
  installation: { en: "Installation", ar: "التركيب" },
  extrasT: { en: "Extras", ar: "البنود الإضافية" },
  logistics: { en: "Logistics", ar: "الشحن" },
  overhead: { en: "Overhead", ar: "المصاريف العامة" },
  belowFloor: { en: "Below the floor: write why this price is worth taking.", ar: "أقل من الحد الأدنى: اكتب لماذا يستحق هذا السعر." },
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
  pricerNote: { en: "Only the GM sets margins and selling prices. You set the cost choices: screen price, install type, logistics and extras.", ar: "الهوامش وأسعار البيع يضعها المدير العام فقط. أنت تضبط اختيارات التكلفة: سعر الشاشة ونوع التركيب والشحن والبنود الإضافية." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-24 rounded-md border border-border bg-background px-2 py-1 text-end text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

type SuggestRun = { key: string; ok: boolean };

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
  const suggestKey = `${file.file_id}:${revisionId}`;
  const [suggestRun, setSuggestRun] = useState<SuggestRun | null>(null);
  const started = useRef<string | null>(null);
  async function runSuggest() {
    started.current = suggestKey;
    setSuggestRun(null);
    let ok = true;
    try {
      await suggestExtras(file.file_id);
    } catch (e) {
      ok = false;
      toast.error(dbMessage(e, lang));
    }
    setSuggestRun({ key: suggestKey, ok });
    void qc.invalidateQueries({ queryKey: ["pricing-extras", file.file_id] });
  }
  useEffect(() => {
    if (suggestable && started.current !== suggestKey) void runSuggest();
    // runSuggest closes over suggestKey only through the key checked here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestable, suggestKey]);
  const suggestStatus: "na" | "running" | "done" | "failed" = !suggestable
    ? "na"
    : suggestRun?.key !== suggestKey
      ? "running"
      : suggestRun.ok ? "done" : "failed";

  const open = useQuery({
    queryKey: ["pricing-open-suggestions", file.file_id, revisionId],
    queryFn: () => countOpenSuggestions(file.file_id),
    enabled: costOk && (suggestStatus === "done" || suggestStatus === "na"),
  });

  const sellingEditable = canEditSelling(file.state, rights);
  const canBuild = canBuildPrice(file.state, rights);
  const [justification, setJustification] = useState("");
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
  const fresh = !totals.isFetching && !grid.isFetching && !open.isFetching;
  const extrasDecided = openCount === 0;
  const canPropose = canBuild && ready && extrasDecided && fresh && (!belowFloor || justification.trim().length > 0);
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
  const numOrNull = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

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

  async function propose() {
    if (busy || !t || t.total_selling == null) return;
    setBusy(true);
    try {
      await proposePrice(file.file_id, t.total_selling, t.total_cost, belowFloor ? justification.trim() : undefined);
      toast.success(pick(TEXT.proposed, lang));
      onChanged();
    } catch (e) {
      // A stale total (or any refusal) reloads the figures the GM is looking at.
      toast.error(`${dbMessage(e, lang)} ${pick(TEXT.reload, lang)}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const warn = (n: number | undefined, label: Bi) => (n && n > 0 ? <li>{formatNumber(n, lang)} {pick(label, lang)}</li> : null);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{pick(rights.is_gm ? TEXT.gmNote : TEXT.pricerNote, lang)}</p>
      <CostInputsPanel {...props} />
      <ExtrasPanel {...props} />

      <Panel title={pick(TEXT.lines, lang)} subtitle={pick(TEXT.linesSub, lang)}>
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
                  <input
                    key={`m-${g.boq_line_id}-${g.line_margin_pct ?? ""}-${resetNonce}`}
                    type="number" step="0.01" className={FIELD}
                    aria-label={`${pick(TEXT.marginIn, lang)}: ${g.sign_type}`}
                    defaultValue={g.line_margin_pct ?? ""}
                    placeholder={g.default_margin_pct == null ? "" : String(g.default_margin_pct)}
                    disabled={!sellingEditable || busy || g.typed_selling_price != null}
                    onBlur={(e) => {
                      const next = numOrNull(e.currentTarget.value);
                      if (next !== g.line_margin_pct) void choose(g, { margin_pct: next });
                    }}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <input
                    key={`s-${g.boq_line_id}-${g.typed_selling_price ?? ""}-${resetNonce}`}
                    type="number" step="0.01" min={0} className={FIELD}
                    aria-label={`${pick(TEXT.typed, lang)}: ${g.sign_type}`}
                    defaultValue={g.typed_selling_price ?? ""}
                    disabled={!sellingEditable || busy}
                    onBlur={(e) => {
                      const next = numOrNull(e.currentTarget.value);
                      if (next !== g.typed_selling_price) void choose(g, { selling_price: next });
                    }}
                  />
                </TableCell>
                <TableCell className="text-end tabular-nums">{money(g.selling_price)}</TableCell>
                <TableCell className="text-end tabular-nums">{pct(g.margin_pct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <Panel title={pick(TEXT.totals, lang)} subtitle={pick(TEXT.totalsSub, lang)} tone={belowFloor ? "attention" : "default"}>
        <div className="space-y-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-4">
            <div><dt className="text-muted-foreground">{pick(TEXT.totalCost, lang)}</dt><dd className="text-lg font-semibold tabular-nums">{money(t?.total_cost)}</dd></div>
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
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void runSuggest()}>{pick(TEXT.retry, lang)}</Button>
            </p>
          ) : null}
          {canBuild && suggestStatus !== "failed" && openCount == null ? <p className="text-muted-foreground">{pick(TEXT.openUnknown, lang)}</p> : null}
          {canBuild && openCount != null && openCount > 0 ? (
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
          {belowFloor && canBuild ? (
            <label className="block space-y-1">
              <span>{pick(TEXT.belowFloor, lang)}</span>
              <textarea
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                aria-label={pick(TEXT.justification, lang)}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
              />
            </label>
          ) : null}
          {canBuild ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || !ready || !fresh} onClick={() => void build()}>
                {pick(TEXT.build, lang)}
              </Button>
              <Button disabled={busy || !canPropose} onClick={() => void propose()}>
                {pick(TEXT.propose, lang)}
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
