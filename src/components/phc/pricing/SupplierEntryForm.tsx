import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n, formatNumber } from "@/lib/i18n";
import { enterSupplierQuote, listBoqLines, listSupplierCosts, listVendors, type SupplierPriceInput } from "@/lib/pricing-actions";
import { parseDraft, draftText, type DraftRules } from "@/lib/pricing-input";
import { dbMessage, draftError, pick, type Bi } from "@/lib/pricing-text";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Enter the supplier's prices on their behalf", ar: "أدخل أسعار المورد نيابة عنه" },
  hint: { en: "From the supplier's Excel or PDF. The quote is recorded as the supplier's, entered by you. Saving again corrects it; a line left empty has no price.", ar: "من ملف المورد (Excel أو PDF). يُسجَّل العرض باسم المورد وأنت من أدخله. الحفظ مرة أخرى يصحّحه، والبند الفارغ بلا سعر." },
  supplier: { en: "Supplier", ar: "المورد" },
  pick: { en: "Choose the supplier", ar: "اختر المورد" },
  oneSupplier: { en: "One supplier per file for now.", ar: "مورد واحد لكل ملف حالياً." },
  sign: { en: "Sign", ar: "اللوحة" },
  qty: { en: "Qty", ar: "الكمية" },
  unit: { en: "Unit price", ar: "سعر الوحدة" },
  screen: { en: "With screen", ar: "مع الشاشة" },
  differs: { en: "Differs from spec", ar: "يختلف عن المواصفة" },
  lead: { en: "Lead time (days)", ar: "مدة التوريد (أيام)" },
  terms: { en: "Payment terms", ar: "شروط الدفع" },
  valid: { en: "Valid until", ar: "صالح حتى" },
  currency: { en: "Currency", ar: "العملة" },
  currencyWarn: { en: "Only SAR is priced. Lines in another currency stay unpriced until the quote is in SAR.", ar: "يُسعَّر الريال فقط. تبقى البنود بعملة أخرى بلا سعر حتى يصبح العرض بالريال." },
  keepBlank: { en: "Empty keeps what was saved.", ar: "الفارغ يُبقي المحفوظ." },
  save: { en: "Save the supplier's prices", ar: "احفظ أسعار المورد" },
  saving: { en: "Saving…", ar: "جارٍ الحفظ…" },
  saved: { en: "lines saved", ar: "بنداً حُفظ" },
  fixErrors: { en: "Some boxes need fixing before saving.", ar: "بعض الحقول تحتاج تصحيحاً قبل الحفظ." },
  chooseSupplier: { en: "Choose the supplier first.", ar: "اختر المورد أولاً." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";
const CURRENCIES = ["SAR", "USD", "EUR", "AED", "GBP", "CNY"];
// numeric(14,2) in the database; the SQL refuses 1e12 and above.
const PRICE: DraftRules = { min: 0, below: 1e12 };
const LEAD: DraftRules = { min: 0, max: 9999, integer: true };

type CellKey = "unit_cost" | "unit_cost_with_screen" | "alternate_spec";
type Cells = Partial<Record<CellKey, string>>;

export function SupplierEntryForm({ file, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const revisionId = file.boq_revision_id as string;
  const vendors = useQuery({ queryKey: ["pricing-vendors"], queryFn: listVendors });
  const lines = useQuery({ queryKey: ["pricing-lines", revisionId], queryFn: () => listBoqLines(revisionId) });
  const costs = useQuery({ queryKey: ["pricing-supplier-costs", revisionId], queryFn: () => listSupplierCosts(revisionId) });
  const live = (costs.data ?? []).filter((c) => c.status !== "cancelled" && c.status !== "superseded");
  const current = live[0];
  const [vendorId, setVendorId] = useState("");
  const [cells, setCells] = useState<Record<string, Cells>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [terms, setTerms] = useState({ lead: "", payment: "", valid: "", currency: "" });
  const [busy, setBusy] = useState(false);

  if (vendors.isLoading || lines.isLoading || costs.isLoading) return <SkeletonTable />;
  if (vendors.isError || lines.isError || costs.isError) {
    return <QueryFailure retry={() => { void vendors.refetch(); void lines.refetch(); void costs.refetch(); }} />;
  }

  const chosen = current?.vendor_id ?? vendorId;
  const currency = terms.currency || current?.currency || "SAR";
  const saved = (lineId: string) => live.find((c) => c.boq_line_id === lineId);
  const val = (lineId: string, k: CellKey): string => {
    const typed = cells[lineId]?.[k];
    if (typed !== undefined) return typed;
    const c = saved(lineId);
    return c ? (k === "alternate_spec" ? (c.alternate_spec ?? "") : draftText(c[k])) : "";
  };
  const setCell = (lineId: string, k: CellKey, v: string) => {
    setCells((m) => ({ ...m, [lineId]: { ...m[lineId], [k]: v } }));
    setErrors((x) => { const { [`${lineId}:${k}`]: _gone, ...rest } = x; return rest; });
  };
  const err = (id: string) => errors[id];

  async function save() {
    if (busy) return;
    if (!chosen) { toast.error(pick(TEXT.chooseSupplier, lang)); return; }
    const found: Record<string, string> = {};
    const payload: SupplierPriceInput[] = [];
    for (const l of lines.data ?? []) {
      const unit = parseDraft(val(l.id, "unit_cost"), PRICE);
      const screen = parseDraft(val(l.id, "unit_cost_with_screen"), PRICE);
      if (!unit.ok) found[`${l.id}:unit_cost`] = draftError(unit.reason, lang, PRICE);
      if (!screen.ok) found[`${l.id}:unit_cost_with_screen`] = draftError(screen.reason, lang, PRICE);
      payload.push({
        boq_line_id: l.id,
        unit_cost: unit.ok ? unit.value : null,
        unit_cost_with_screen: screen.ok ? screen.value : null,
        alternate_spec: val(l.id, "alternate_spec").trim() || null,
      });
    }
    const lead = parseDraft(terms.lead, LEAD);
    if (!lead.ok) found.lead = draftError(lead.reason, lang, LEAD);
    setErrors(found);
    if (Object.keys(found).length > 0) { toast.error(pick(TEXT.fixErrors, lang)); return; }
    setBusy(true);
    try {
      const r = await enterSupplierQuote(file.file_id, chosen, payload, {
        lead_time_days: lead.ok ? lead.value : null,
        payment_terms: terms.payment.trim() || null,
        valid_until: terms.valid || null,
        currency: terms.currency || (current ? null : "SAR"),
      });
      // Drop the typed text only once the saved prices are back, so no box flashes its old value.
      await qc.invalidateQueries({ queryKey: ["pricing-supplier-costs", revisionId] });
      setCells({});
      setTerms({ lead: "", payment: "", valid: "", currency: "" });
      toast.success(`${r.lines} ${pick(TEXT.saved, lang)}`);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  const priceInput = (lineId: string, k: "unit_cost" | "unit_cost_with_screen", label: Bi, sign: string) => (
    <>
      <input type="text" inputMode="decimal" className={FIELD} disabled={busy} aria-label={`${pick(label, lang)}: ${sign}`}
        aria-invalid={err(`${lineId}:${k}`) ? true : undefined}
        value={val(lineId, k)} onChange={(e) => setCell(lineId, k, e.target.value)} />
      {err(`${lineId}:${k}`) ? <span className="block text-xs text-destructive">{err(`${lineId}:${k}`)}</span> : null}
    </>
  );

  return (
    <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.hint, lang)}>
      <div className="space-y-3 text-sm">
        <label className="block max-w-sm space-y-1">
          <span>{pick(TEXT.supplier, lang)}</span>
          <select className={FIELD} value={chosen} disabled={busy || !!current} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">{pick(TEXT.pick, lang)}</option>
            {(vendors.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          {current ? <span className="block text-xs text-muted-foreground">{pick(TEXT.oneSupplier, lang)}</span> : null}
        </label>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.sign, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
              <TableHead>{pick(TEXT.unit, lang)}</TableHead>
              <TableHead>{pick(TEXT.screen, lang)}</TableHead>
              <TableHead>{pick(TEXT.differs, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(lines.data ?? []).map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.sign_type}</TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(l.quantity, lang)}</TableCell>
                <TableCell>{priceInput(l.id, "unit_cost", TEXT.unit, l.sign_type)}</TableCell>
                <TableCell>{priceInput(l.id, "unit_cost_with_screen", TEXT.screen, l.sign_type)}</TableCell>
                <TableCell>
                  <input type="text" maxLength={500} className={FIELD} disabled={busy} aria-label={`${pick(TEXT.differs, lang)}: ${l.sign_type}`}
                    value={val(l.id, "alternate_spec")} onChange={(e) => setCell(l.id, "alternate_spec", e.target.value)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1">
            <span>{pick(TEXT.lead, lang)}</span>
            <input type="text" inputMode="numeric" className={FIELD} disabled={busy} aria-invalid={err("lead") ? true : undefined}
              value={terms.lead} onChange={(e) => { setTerms((t) => ({ ...t, lead: e.target.value })); setErrors((x) => { const { lead: _gone, ...rest } = x; return rest; }); }} />
            {err("lead") ? <span className="block text-xs text-destructive">{err("lead")}</span> : <span className="block text-xs text-muted-foreground">{pick(TEXT.keepBlank, lang)}</span>}
          </label>
          <label className="space-y-1">
            <span>{pick(TEXT.terms, lang)}</span>
            <input type="text" maxLength={500} className={FIELD} disabled={busy} value={terms.payment} onChange={(e) => setTerms((t) => ({ ...t, payment: e.target.value }))} />
          </label>
          <label className="space-y-1">
            <span>{pick(TEXT.valid, lang)}</span>
            <input type="date" className={FIELD} disabled={busy} value={terms.valid} onChange={(e) => setTerms((t) => ({ ...t, valid: e.target.value }))} />
          </label>
          <label className="space-y-1">
            <span>{pick(TEXT.currency, lang)}</span>
            <select className={FIELD} disabled={busy} value={currency} onChange={(e) => setTerms((t) => ({ ...t, currency: e.target.value }))}>
              {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        {currency !== "SAR" ? <p className="text-amber-light">{pick(TEXT.currencyWarn, lang)}</p> : null}
        <Button disabled={busy || !chosen} onClick={() => void save()}>{pick(busy ? TEXT.saving : TEXT.save, lang)}</Button>
      </div>
    </Panel>
  );
}
