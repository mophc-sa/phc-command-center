import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n } from "@/lib/i18n";
import { getFileInputs, setFileInputs, type FileInputs } from "@/lib/pricing-actions";
import { canEditFileInputs, canEditSelling } from "@/lib/pricing-access";
import { parseDraft, draftText, type DraftRules } from "@/lib/pricing-input";
import { dbMessage, draftError, pick, type Bi } from "@/lib/pricing-text";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Logistics and project inputs", ar: "الشحن ومُدخلات المشروع" },
  sub: { en: "Spread over the lines by value. Rates come from Pricing settings. Changes save when you leave a box.", ar: "تُوزَّع على البنود حسب القيمة. الأسعار من إعدادات التسعير. تُحفظ التغييرات عند مغادرة الحقل." },
  containers: { en: "Containers", ar: "عدد الحاويات" },
  delivery: { en: "Inland delivery", ar: "التوصيل الداخلي" },
  none: { en: "None", ar: "بدون" },
  jeddah: { en: "Inside Jeddah", ar: "داخل جدة" },
  riyadh: { en: "Jeddah to Riyadh", ar: "جدة إلى الرياض" },
  clearing: { en: "Clearing agent", ar: "المخلّص الجمركي" },
  overhead: { en: "Overhead %", ar: "المصاريف العامة %" },
  cinema: { en: "Cinema project (suggests acoustic items)", ar: "مشروع سينمائي (يقترح بنود العزل الصوتي)" },
  margin: { en: "Default margin % for this file (GM)", ar: "الهامش الافتراضي % لهذا الملف (المدير العام)" },
  marginHint: { en: "Empty uses the settings default.", ar: "الفارغ يأخذ الافتراضي من الإعدادات." },
  saving: { en: "Saving…", ar: "جارٍ الحفظ…" },
  saved: { en: "Inputs saved", ar: "حُفظت المُدخلات" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";
const DEFAULTS: Omit<FileInputs, "file_id"> = { is_cinema: false, containers: 0, delivery: "none", clearing: false, overhead_pct: 0, default_margin_pct: null };

type NumKey = "containers" | "overhead_pct" | "default_margin_pct";
const RULES: Record<NumKey, DraftRules> = {
  containers: { min: 0, integer: true },
  overhead_pct: { min: 0 },
  default_margin_pct: { above: -100, below: 100 },
};

type Props = PricingTabProps & {
  /** True while a box holds text that is not saved (typed, refused, or being saved). The tab blocks Build and Propose then. */
  onPending?: (pending: boolean) => void;
};

export function CostInputsPanel({ file, rights, onChanged, onPending }: Props) {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const costOk = rights.can_read_cost;
  const inputs = useQuery({ queryKey: ["pricing-inputs", file.file_id], queryFn: () => getFileInputs(file.file_id), enabled: costOk });
  const editable = canEditFileInputs(file.state, rights);
  const marginEditable = canEditSelling(file.state, rights);
  // Number boxes keep what was typed as text until it is saved.
  const [drafts, setDrafts] = useState<Partial<Record<NumKey, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<NumKey, string>>>({});
  const [saving, setSaving] = useState(0);

  const pending = Object.keys(drafts).length > 0 || saving > 0;
  const report = useRef(onPending);
  report.current = onPending;
  useEffect(() => { report.current?.(pending); }, [pending]);
  useEffect(() => () => report.current?.(false), []);

  if (!costOk) return null;
  // Never show defaults over a failed read: saving them would overwrite the real inputs.
  if (inputs.isLoading) return <SkeletonTable />;
  if (inputs.isError) return <QueryFailure retry={() => void inputs.refetch()} />;

  const saved = { ...DEFAULTS, ...(inputs.data ?? {}) };

  async function commit(payload: Partial<Omit<FileInputs, "file_id">>, clear?: NumKey) {
    setSaving((n) => n + 1);
    try {
      await setFileInputs(file.file_id, payload);
      await qc.invalidateQueries({ queryKey: ["pricing-inputs", file.file_id] });
      if (clear) {
        setDrafts((d) => { const { [clear]: _gone, ...rest } = d; return rest; });
        setErrors((e) => { const { [clear]: _gone, ...rest } = e; return rest; });
      }
      toast.success(pick(TEXT.saved, lang));
      onChanged();
    } catch (e) {
      const msg = dbMessage(e, lang);
      toast.error(msg);
      if (clear) setErrors((x) => ({ ...x, [clear]: msg })); // the text stays, so the screen never claims it was saved
    } finally {
      setSaving((n) => n - 1);
    }
  }

  function leave(key: NumKey) {
    const text = drafts[key];
    if (text == null) return;
    const r = parseDraft(text, RULES[key]);
    if (!r.ok) { setErrors((e) => ({ ...e, [key]: draftError(r.reason, lang, RULES[key]) })); return; }
    const value = key === "default_margin_pct" ? r.value : (r.value ?? 0);
    if (value === saved[key]) {
      setDrafts((d) => { const { [key]: _gone, ...rest } = d; return rest; });
      setErrors((e) => { const { [key]: _gone, ...rest } = e; return rest; });
      return;
    }
    void commit({ [key]: value }, key);
  }

  const numberField = (key: NumKey, label: Bi, enabled: boolean, placeholder?: string) => (
    <label className="space-y-1 text-sm">
      <span>{pick(label, lang)}</span>
      <input
        type="text" inputMode="decimal" className={FIELD} disabled={!enabled}
        aria-invalid={errors[key] ? true : undefined}
        placeholder={placeholder}
        value={drafts[key] ?? draftText(saved[key])}
        onChange={(e) => { const text = e.target.value; setDrafts((d) => ({ ...d, [key]: text })); setErrors((x) => { const { [key]: _gone, ...rest } = x; return rest; }); }}
        onBlur={() => leave(key)}
      />
      {errors[key] ? <span className="block text-xs text-destructive">{errors[key]}</span> : null}
    </label>
  );

  return (
    <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.sub, lang)}
      action={saving > 0 ? <span className="text-xs text-muted-foreground">{pick(TEXT.saving, lang)}</span> : undefined}>
      <div className="grid gap-3 sm:grid-cols-3">
        {numberField("containers", TEXT.containers, editable)}
        <label className="space-y-1 text-sm">
          <span>{pick(TEXT.delivery, lang)}</span>
          <select className={FIELD} disabled={!editable} value={saved.delivery}
            onChange={(e) => void commit({ delivery: e.target.value as FileInputs["delivery"] })}>
            <option value="none">{pick(TEXT.none, lang)}</option>
            <option value="jeddah">{pick(TEXT.jeddah, lang)}</option>
            <option value="riyadh">{pick(TEXT.riyadh, lang)}</option>
          </select>
        </label>
        {numberField("overhead_pct", TEXT.overhead, editable)}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!editable} checked={saved.clearing} onChange={(e) => void commit({ clearing: e.target.checked })} />
          {pick(TEXT.clearing, lang)}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!editable} checked={saved.is_cinema} onChange={(e) => void commit({ is_cinema: e.target.checked })} />
          {pick(TEXT.cinema, lang)}
        </label>
        {numberField("default_margin_pct", TEXT.margin, marginEditable, pick(TEXT.marginHint, lang))}
      </div>
    </Panel>
  );
}
