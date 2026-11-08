import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n, formatNumber } from "@/lib/i18n";
import type { InstallType } from "@/lib/pricing";
import {
  getMarginFloor, listCatalog, listInstallationRates, listLogisticsRates, saveCatalogItem, setInstallationRate,
  setMarginFloor, updateLogisticsRate, type CatalogInput, type CatalogRow, type LogisticsRateKey,
} from "@/lib/pricing-actions";
import { INSTALL_TYPES, INSTALL_TYPE_LABEL } from "@/lib/boq-import";
import { draftText } from "@/lib/pricing-input";
import {
  canEditLogisticsKey, catalogCodeFrom, emptyRateDraft, parseCatalogMinHeight, parseCatalogRate,
  parseFloorValue, parseLogisticsValue, parseRateDraft, rateInForce,
  type Parsed, type RateDraft, type RateField,
} from "@/lib/pricing-settings";
import { dbMessage, draftError, pick, type Bi } from "@/lib/pricing-text";

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";
const today = () => new Date().toISOString().slice(0, 10);

function useSaver() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  return async (fn: () => Promise<unknown>, ok: Bi) => {
    try {
      await fn();
      toast.success(pick(ok, lang));
      await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("pricing-") });
      return true;
    } catch (e) {
      toast.error(dbMessage(e, lang));
      return false;
    }
  };
}

/** A refused typed number as the reader's sentence. */
function useFailure() {
  const { lang } = useI18n();
  return (f: Extract<Parsed<unknown>, { ok: false }>) => draftError(f.reason, lang, f.rules);
}

const Err = ({ children }: { children?: string }) =>
  children ? <span className="block text-xs text-destructive">{children}</span> : null;

// ---- Installation rate card ---------------------------------------------------

const RT = {
  title: { en: "Installation rate card", ar: "جدول أسعار التركيب" },
  sub: { en: "What PHC pays the installer per sign, by type. A new rate starts on a date; the one before it ends that day.", ar: "ما تدفعه PHC للمركّب لكل لوحة حسب النوع. يبدأ السعر الجديد في تاريخ وينتهي السابق في اليوم نفسه." },
  type: { en: "Type", ar: "النوع" },
  from: { en: "From", ar: "من" },
  fromHint: { en: "Today or later", ar: "اليوم أو بعده" },
  dateBad: { en: "Pick today or a later date.", ar: "اختر اليوم أو تاريخاً لاحقاً." },
  to: { en: "To", ar: "إلى" },
  base: { en: "Base", ar: "الأساس" },
  perKg: { en: "Per kg over", ar: "لكل كغ فوق" },
  kgFrom: { en: "kg threshold", ar: "حد الوزن (كغ)" },
  perM: { en: "Per m over", ar: "لكل متر فوق" },
  mFrom: { en: "Height threshold (m)", ar: "حد الارتفاع (م)" },
  cut: { en: "Floor cut", ar: "قص الأرضية" },
  scaffold: { en: "Scaffold", ar: "سقالة" },
  crane: { en: "Crane", ar: "رافعة" },
  inForce: { en: "In force", ar: "سارٍ" },
  open: { en: "open", ar: "مفتوح" },
  newRate: { en: "Set a rate", ar: "حدّد سعراً" },
  save: { en: "Save rate", ar: "احفظ السعر" },
  saved: { en: "Rate saved", ar: "حُفظ السعر" },
  none: { en: "No rates yet. Lines fall back to the % of materials.", ar: "لا أسعار بعد. تأخذ البنود النسبة الاحتياطية من المواد." },
} satisfies Record<string, Bi>;

export function InstallationRatesCard({ canEdit }: { canEdit: boolean }) {
  const { lang } = useI18n();
  const save = useSaver();
  const failure = useFailure();
  const rates = useQuery({ queryKey: ["pricing-installation-rates"], queryFn: listInstallationRates });
  const [form, setForm] = useState<RateDraft>(() => emptyRateDraft(today()));
  const [errors, setErrors] = useState<Partial<Record<RateField | "effective_from", string>>>({});
  const n = (v: number | null) => (v == null ? "—" : formatNumber(v, lang));
  const d = today();

  const numField = (k: RateField, label: Bi) => (
    <label className="space-y-1 text-sm">
      <span>{pick(label, lang)}</span>
      <input type="text" inputMode="decimal" className={FIELD} aria-invalid={errors[k] ? true : undefined}
        value={form[k]}
        onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined })); }} />
      <Err>{errors[k]}</Err>
    </label>
  );

  async function submit() {
    const r = parseRateDraft(form, d);
    if (!r.ok) {
      const next: Partial<Record<RateField | "effective_from", string>> = {};
      for (const [k, v] of Object.entries(r.errors) as [RateField | "effective_from", NonNullable<(typeof r.errors)[RateField]>][]) {
        next[k] = v === "date" ? pick(RT.dateBad, lang) : failure(v as Extract<Parsed<unknown>, { ok: false }>);
      }
      setErrors(next);
      return;
    }
    setErrors({});
    if (await save(() => setInstallationRate(r.value), RT.saved)) setForm(emptyRateDraft(today()));
  }

  return (
    <Panel title={pick(RT.title, lang)} subtitle={pick(RT.sub, lang)}>
      <div className="space-y-4">
        {rates.isLoading ? (
          <SkeletonTable />
        ) : rates.isError ? (
          <QueryFailure retry={() => void rates.refetch()} />
        ) : (rates.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{pick(RT.none, lang)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(RT.type, lang)}</TableHead>
                <TableHead>{pick(RT.from, lang)}</TableHead>
                <TableHead>{pick(RT.to, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.base, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.perKg, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.perM, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.cut, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.scaffold, lang)}</TableHead>
                <TableHead className="text-end">{pick(RT.crane, lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rates.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {pick(INSTALL_TYPE_LABEL[r.install_type], lang)}{" "}
                    {rateInForce(r, d) ? <StatusPill tone="positive">{pick(RT.inForce, lang)}</StatusPill> : null}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.effective_from}</TableCell>
                  <TableCell className="tabular-nums">{r.effective_to ?? pick(RT.open, lang)}</TableCell>
                  <TableCell className="text-end tabular-nums">{n(r.base_rate)}</TableCell>
                  <TableCell className="text-end tabular-nums">{n(r.per_kg_over)}{r.weight_threshold_kg != null ? ` > ${r.weight_threshold_kg}` : ""}</TableCell>
                  <TableCell className="text-end tabular-nums">{n(r.per_m_over)}{r.height_threshold_m != null ? ` > ${r.height_threshold_m}` : ""}</TableCell>
                  <TableCell className="text-end tabular-nums">{n(r.floor_cut_add)}</TableCell>
                  <TableCell className="text-end tabular-nums">{n(r.scaffold_add)}</TableCell>
                  <TableCell className="text-end tabular-nums">{n(r.crane_add)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {canEdit ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{pick(RT.newRate, lang)}</p>
            <div className="grid gap-3 sm:grid-cols-5">
              <label className="space-y-1 text-sm">
                <span>{pick(RT.type, lang)}</span>
                <select className={FIELD} value={form.install_type} onChange={(e) => setForm((f) => ({ ...f, install_type: e.target.value as InstallType }))}>
                  {INSTALL_TYPES.map((t) => <option key={t} value={t}>{pick(INSTALL_TYPE_LABEL[t], lang)}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>{pick(RT.from, lang)} <span className="text-xs text-muted-foreground">({pick(RT.fromHint, lang)})</span></span>
                <input type="date" min={d} className={FIELD} aria-invalid={errors.effective_from ? true : undefined} value={form.effective_from}
                  onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, effective_from: v })); setErrors((x) => ({ ...x, effective_from: undefined })); }} />
                <Err>{errors.effective_from}</Err>
              </label>
              {numField("base_rate", RT.base)}
              {numField("per_kg_over", RT.perKg)}
              {numField("weight_threshold_kg", RT.kgFrom)}
              {numField("per_m_over", RT.perM)}
              {numField("height_threshold_m", RT.mFrom)}
              {numField("floor_cut_add", RT.cut)}
              {numField("scaffold_add", RT.scaffold)}
              {numField("crane_add", RT.crane)}
            </div>
            <Button size="sm" onClick={() => void submit()}>{pick(RT.save, lang)}</Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

// ---- Logistics and pricing defaults, margin floor ------------------------------

const KEY_LABEL: Record<LogisticsRateKey, Bi> = {
  container_rate: { en: "Container from China (per container)", ar: "شحن حاوية من الصين (لكل حاوية)" },
  customs_pct: { en: "Customs, % of goods value", ar: "الجمارك، % من قيمة البضاعة" },
  clearing_fee: { en: "Clearing agent fee", ar: "أجرة المخلّص" },
  delivery_jeddah: { en: "Delivery inside Jeddah", ar: "التوصيل داخل جدة" },
  delivery_riyadh: { en: "Jeddah to Riyadh warehouse", ar: "جدة إلى مستودع الرياض" },
  install_fallback_pct: { en: "Installation fallback, % of materials", ar: "التركيب الاحتياطي، % من المواد" },
  default_margin_pct: { en: "Default margin, % on price", ar: "الهامش الافتراضي، % من سعر البيع" },
};
const DT = {
  title: { en: "Logistics and pricing defaults", ar: "الشحن والقيم الافتراضية للتسعير" },
  sub: { en: "A new value is in force from the day it is saved; earlier values stay in the audit log. The default margin and the floor are the GM's and finance's.", ar: "القيمة الجديدة سارية من يوم حفظها؛ القيم السابقة تبقى في سجل التدقيق. الهامش الافتراضي والحد الأدنى للمدير العام والمالية." },
  item: { en: "Item", ar: "البند" },
  value: { en: "Value", ar: "القيمة" },
  note: { en: "Note", ar: "ملاحظة" },
  since: { en: "In force since", ar: "سارٍ منذ" },
  save: { en: "Save", ar: "احفظ" },
  saved: { en: "Saved", ar: "تم الحفظ" },
  floor: { en: "Margin floor", ar: "الحد الأدنى للهامش" },
  floorSub: { en: "Below it, a price needs a written justification before it goes to review. The GM and finance set it.", ar: "تحته يحتاج السعر مبرراً مكتوباً قبل إرساله للمراجعة. يحدده المدير العام والمالية." },
  noFloor: { en: "No floor is set, so no justification is asked for.", ar: "لا حد أدنى محدد، فلا يُطلب مبرر." },
  pct: { en: "Floor %", ar: "الحد %" },
  why: { en: "Why", ar: "السبب" },
  setFloor: { en: "Set the floor", ar: "حدّد الحد الأدنى" },
} satisfies Record<string, Bi>;

export function DefaultsCard({ canEditRates, canSetMargins }: { canEditRates: boolean; canSetMargins: boolean }) {
  const { lang } = useI18n();
  const save = useSaver();
  const failure = useFailure();
  const rates = useQuery({ queryKey: ["pricing-logistics-rates"], queryFn: listLogisticsRates });
  const floor = useQuery({ queryKey: ["pricing-margin-floor"], queryFn: getMarginFloor });
  const [edits, setEdits] = useState<Record<string, { value?: string; note?: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [floorForm, setFloorForm] = useState({ pct: "", why: "" });
  const [floorError, setFloorError] = useState("");
  // Rights per row: the default margin follows can_set_margins, the other keys is_pricer.
  const rights = { is_pricer: canEditRates, is_gm: false, can_read_cost: true, can_set_margins: canSetMargins };
  const anyEdit = (rates.data ?? []).some((r) => canEditLogisticsKey(r.key, rights));

  async function saveRow(key: LogisticsRateKey, current: { value: number; note: string | null }) {
    const e = edits[key] ?? {};
    const parsed = parseLogisticsValue(key, e.value ?? draftText(current.value));
    if (!parsed.ok) { setErrors((m) => ({ ...m, [key]: failure(parsed) })); return; }
    setErrors((m) => ({ ...m, [key]: "" }));
    const note = e.note === undefined ? current.note : e.note.trim() || null;
    if (await save(() => updateLogisticsRate(key, parsed.value, note), DT.saved)) setEdits((m) => ({ ...m, [key]: {} }));
  }

  async function saveFloor() {
    const parsed = parseFloorValue(floorForm.pct);
    if (!parsed.ok) { setFloorError(failure(parsed)); return; }
    setFloorError("");
    if (await save(() => setMarginFloor(parsed.value, floorForm.why.trim()), DT.saved)) setFloorForm({ pct: "", why: "" });
  }

  return (
    <div className="space-y-6">
      <Panel title={pick(DT.title, lang)} subtitle={pick(DT.sub, lang)}>
        {rates.isLoading ? (
          <SkeletonTable />
        ) : rates.isError ? (
          <QueryFailure retry={() => void rates.refetch()} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(DT.item, lang)}</TableHead>
                <TableHead className="text-end">{pick(DT.value, lang)}</TableHead>
                <TableHead>{pick(DT.note, lang)}</TableHead>
                <TableHead>{pick(DT.since, lang)}</TableHead>
                {anyEdit ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rates.data ?? []).map((r) => {
                const e = edits[r.key] ?? {};
                const editable = canEditLogisticsKey(r.key, rights);
                const label = pick(KEY_LABEL[r.key], lang);
                return (
                  <TableRow key={r.key}>
                    <TableCell>{label} <span className="text-xs text-muted-foreground">({r.currency})</span></TableCell>
                    <TableCell className="text-end">
                      {editable ? (
                        <>
                          <input type="text" inputMode="decimal" className={`${FIELD} w-28`} aria-label={label}
                            aria-invalid={errors[r.key] ? true : undefined}
                            value={e.value ?? draftText(r.value)}
                            onChange={(ev) => { const v = ev.target.value; setEdits((m) => ({ ...m, [r.key]: { ...m[r.key], value: v } })); setErrors((x) => ({ ...x, [r.key]: "" })); }} />
                          <Err>{errors[r.key]}</Err>
                        </>
                      ) : (
                        <span className="tabular-nums">{formatNumber(r.value, lang)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <input className={FIELD} aria-label={`${pick(DT.note, lang)}: ${label}`}
                          value={e.note ?? r.note ?? ""} onChange={(ev) => { const v = ev.target.value; setEdits((m) => ({ ...m, [r.key]: { ...m[r.key], note: v } })); }} />
                      ) : (
                        <span className="text-muted-foreground">{r.note}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{r.effective_from}</TableCell>
                    {anyEdit ? (
                      <TableCell className="text-end">
                        {editable ? (
                          <Button size="sm" variant="outline" disabled={e.value === undefined && e.note === undefined}
                            onClick={() => void saveRow(r.key, r)}>
                            {pick(DT.save, lang)}
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel title={pick(DT.floor, lang)} subtitle={pick(DT.floorSub, lang)}>
        <div className="space-y-3 text-sm">
          {floor.isError ? (
            <QueryFailure retry={() => void floor.refetch()} />
          ) : floor.data ? (
            <p>
              <span className="text-lg font-semibold tabular-nums">{formatNumber(floor.data.min_margin_pct, lang)}%</span>{" "}
              <span className="text-muted-foreground">· {pick(DT.since, lang)} {floor.data.effective_from.slice(0, 10)}{floor.data.rationale ? ` · ${floor.data.rationale}` : ""}</span>
            </p>
          ) : floor.isLoading ? null : (
            <p className="text-muted-foreground">{pick(DT.noFloor, lang)}</p>
          )}
          {canSetMargins ? (
            <div className="grid items-start gap-2 sm:grid-cols-[1fr_3fr_auto]">
              <label className="space-y-1">
                <span>{pick(DT.pct, lang)}</span>
                <input type="text" inputMode="decimal" className={FIELD} aria-invalid={floorError ? true : undefined} value={floorForm.pct}
                  onChange={(e) => { const v = e.target.value; setFloorForm((f) => ({ ...f, pct: v })); setFloorError(""); }} />
                <Err>{floorError}</Err>
              </label>
              <label className="space-y-1">
                <span>{pick(DT.why, lang)}</span>
                <input className={FIELD} value={floorForm.why} onChange={(e) => setFloorForm((f) => ({ ...f, why: e.target.value }))} />
              </label>
              <Button size="sm" className="sm:mt-6" disabled={floorForm.pct.trim() === "" || !floorForm.why.trim()} onClick={() => void saveFloor()}>
                {pick(DT.setFloor, lang)}
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

// ---- Extras catalog --------------------------------------------------------------

const CT = {
  title: { en: "Extras catalog", ar: "كتالوج البنود الإضافية" },
  sub: { en: "Civil works, acoustic, lifting, painting and printing per m². Suggestions come from install type, mount height, or a cinema project.", ar: "أعمال مدنية وعزل صوتي ورفع ودهان وطباعة بالمتر. الاقتراحات من نوع التركيب أو ارتفاعه أو كون المشروع سينمائياً." },
  nameEn: { en: "Name (English)", ar: "الاسم (إنجليزي)" },
  nameAr: { en: "Name (Arabic)", ar: "الاسم (عربي)" },
  unit: { en: "Unit", ar: "الوحدة" },
  rate: { en: "Default rate", ar: "السعر الافتراضي" },
  suggests: { en: "Suggested for", ar: "يُقترح لـ" },
  minHeight: { en: "From mount height (m)", ar: "من ارتفاع تركيب (م)" },
  cinema: { en: "Cinema projects", ar: "المشاريع السينمائية" },
  active: { en: "Active", ar: "مفعّل" },
  since: { en: "Rate since", ar: "السعر منذ" },
  lump: { en: "Lump sum", ar: "مقطوع" },
  item: { en: "Per item", ar: "للقطعة" },
  m2: { en: "Per m²", ar: "للمتر المربع" },
  edit: { en: "Edit", ar: "تعديل" },
  add: { en: "Add an item", ar: "أضف بنداً" },
  save: { en: "Save item", ar: "احفظ البند" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  saved: { en: "Item saved", ar: "حُفظ البند" },
  inactive: { en: "Not active", ar: "غير مفعّل" },
} satisfies Record<string, Bi>;

type ItemDraft = { item: Omit<CatalogInput, "default_rate" | "suggest_min_height_m">; rate: string; minHeight: string };
const EMPTY_ITEM = (): ItemDraft => ({
  item: { code: "", name_en: "", name_ar: "", unit: "lump", suggest_for: [], suggest_if_cinema: false, active: true },
  rate: "", minHeight: "",
});

export function CatalogCard({ canEdit }: { canEdit: boolean }) {
  const { lang } = useI18n();
  const save = useSaver();
  const failure = useFailure();
  const catalog = useQuery({ queryKey: ["pricing-catalog"], queryFn: listCatalog });
  const [editing, setEditing] = useState<{ id: string | null; draft: ItemDraft } | null>(null);
  const [errors, setErrors] = useState<{ rate?: string; minHeight?: string }>({});
  const unitLabel = (u: CatalogRow["unit"]) => pick(CT[u], lang);

  async function submit(e: { id: string | null; draft: ItemDraft }) {
    const rate = parseCatalogRate(e.draft.rate);
    const height = parseCatalogMinHeight(e.draft.minHeight);
    if (!rate.ok || !height.ok) {
      setErrors({ rate: rate.ok ? undefined : failure(rate), minHeight: height.ok ? undefined : failure(height) });
      return;
    }
    setErrors({});
    const input: CatalogInput = { ...e.draft.item, default_rate: rate.value, suggest_min_height_m: height.value };
    if (await save(() => saveCatalogItem(e.id, input), CT.saved)) setEditing(null);
  }

  function form(e: { id: string | null; draft: ItemDraft }) {
    const it = e.draft.item;
    const setItem = (patch: Partial<ItemDraft["item"]>) => setEditing({ id: e.id, draft: { ...e.draft, item: { ...it, ...patch } } });
    const setText = (patch: Partial<Pick<ItemDraft, "rate" | "minHeight">>) => setEditing({ id: e.id, draft: { ...e.draft, ...patch } });
    return (
      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span>{pick(CT.nameEn, lang)}</span>
            <input className={FIELD} value={it.name_en} onChange={(ev) => setItem({ name_en: ev.target.value, ...(e.id ? {} : { code: catalogCodeFrom(ev.target.value) }) })} />
          </label>
          <label className="space-y-1 text-sm">
            <span>{pick(CT.nameAr, lang)}</span>
            <input className={FIELD} dir="rtl" value={it.name_ar} onChange={(ev) => setItem({ name_ar: ev.target.value })} />
          </label>
          <label className="space-y-1 text-sm">
            <span>{pick(CT.unit, lang)}</span>
            <select className={FIELD} value={it.unit} onChange={(ev) => setItem({ unit: ev.target.value as CatalogRow["unit"] })}>
              {(["lump", "item", "m2"] as const).map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>{pick(CT.rate, lang)}</span>
            <input type="text" inputMode="decimal" className={FIELD} aria-invalid={errors.rate ? true : undefined} value={e.draft.rate}
              onChange={(ev) => { setText({ rate: ev.target.value }); setErrors((x) => ({ ...x, rate: undefined })); }} />
            <Err>{errors.rate}</Err>
          </label>
          <fieldset className="space-y-1 text-sm sm:col-span-2">
            <legend>{pick(CT.suggests, lang)}</legend>
            <div className="flex flex-wrap gap-3">
              {INSTALL_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input type="checkbox" checked={it.suggest_for.includes(t)}
                    onChange={(ev) => setItem({ suggest_for: ev.target.checked ? [...it.suggest_for, t] : it.suggest_for.filter((x) => x !== t) })} />
                  {pick(INSTALL_TYPE_LABEL[t], lang)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="space-y-1 text-sm">
            <span>{pick(CT.minHeight, lang)}</span>
            <input type="text" inputMode="decimal" className={FIELD} aria-invalid={errors.minHeight ? true : undefined} value={e.draft.minHeight}
              onChange={(ev) => { setText({ minHeight: ev.target.value }); setErrors((x) => ({ ...x, minHeight: undefined })); }} />
            <Err>{errors.minHeight}</Err>
          </label>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={it.suggest_if_cinema} onChange={(ev) => setItem({ suggest_if_cinema: ev.target.checked })} />
              {pick(CT.cinema, lang)}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={it.active} onChange={(ev) => setItem({ active: ev.target.checked })} />
              {pick(CT.active, lang)}
            </label>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={it.code.length < 2 || !it.name_en.trim() || !it.name_ar.trim()} onClick={() => void submit(e)}>
            {pick(CT.save, lang)}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setEditing(null); setErrors({}); }}>{pick(CT.cancel, lang)}</Button>
        </div>
      </div>
    );
  }

  return (
    <Panel title={pick(CT.title, lang)} subtitle={pick(CT.sub, lang)}
      action={canEdit && !editing ? <Button size="sm" variant="outline" onClick={() => { setErrors({}); setEditing({ id: null, draft: EMPTY_ITEM() }); }}>{pick(CT.add, lang)}</Button> : undefined}>
      <div className="space-y-4">
        {editing ? form(editing) : null}
        {catalog.isLoading ? (
          <SkeletonTable />
        ) : catalog.isError ? (
          <QueryFailure retry={() => void catalog.refetch()} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(CT.nameEn, lang)}</TableHead>
                <TableHead>{pick(CT.unit, lang)}</TableHead>
                <TableHead className="text-end">{pick(CT.rate, lang)}</TableHead>
                <TableHead>{pick(CT.suggests, lang)}</TableHead>
                <TableHead>{pick(CT.since, lang)}</TableHead>
                {canEdit ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(catalog.data ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    {lang === "ar" ? c.name_ar : c.name_en}
                    {!c.active ? <span className="text-xs text-muted-foreground"> · {pick(CT.inactive, lang)}</span> : null}
                  </TableCell>
                  <TableCell>{unitLabel(c.unit)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatNumber(c.default_rate, lang)}</TableCell>
                  <TableCell className="text-sm">
                    {[
                      ...c.suggest_for.map((t) => pick(INSTALL_TYPE_LABEL[t], lang)),
                      ...(c.suggest_min_height_m != null ? [`≥ ${c.suggest_min_height_m} m`] : []),
                      ...(c.suggest_if_cinema ? [pick(CT.cinema, lang)] : []),
                    ].join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">{c.effective_from}</TableCell>
                  {canEdit ? (
                    <TableCell className="text-end">
                      <Button size="sm" variant="ghost" onClick={() => {
                        setErrors({});
                        setEditing({
                          id: c.id,
                          draft: {
                            item: {
                              code: c.code, name_en: c.name_en, name_ar: c.name_ar, unit: c.unit, suggest_for: c.suggest_for,
                              suggest_if_cinema: c.suggest_if_cinema, active: c.active,
                            },
                            rate: draftText(c.default_rate),
                            minHeight: draftText(c.suggest_min_height_m),
                          },
                        });
                      }}>
                        {pick(CT.edit, lang)}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Panel>
  );
}
