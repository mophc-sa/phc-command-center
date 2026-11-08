import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n } from "@/lib/i18n";
import { getFileInputs, setFileInputs, type FileInputs } from "@/lib/pricing-actions";
import { canEditFileInputs, canEditSelling } from "@/lib/pricing-access";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Logistics and project inputs", ar: "الشحن ومُدخلات المشروع" },
  sub: { en: "Spread over the lines by value. Rates come from Pricing settings.", ar: "تُوزَّع على البنود حسب القيمة. الأسعار من إعدادات التسعير." },
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
  save: { en: "Save inputs", ar: "احفظ المُدخلات" },
  saved: { en: "Inputs saved", ar: "حُفظت المُدخلات" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";
const DEFAULTS: Omit<FileInputs, "file_id"> = { is_cinema: false, containers: 0, delivery: "none", clearing: false, overhead_pct: 0, default_margin_pct: null };

export function CostInputsPanel({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const costOk = rights.can_read_cost;
  const inputs = useQuery({ queryKey: ["pricing-inputs", file.file_id], queryFn: () => getFileInputs(file.file_id), enabled: costOk });
  const editable = canEditFileInputs(file.state, rights);
  const marginEditable = canEditSelling(file.state, rights);
  const [draft, setDraft] = useState<Partial<Omit<FileInputs, "file_id">>>({});
  const [busy, setBusy] = useState(false);

  if (!costOk) return null;
  // Never show defaults over a failed read: saving them would overwrite the real inputs.
  if (inputs.isLoading) return <SkeletonTable />;
  if (inputs.isError) return <QueryFailure retry={() => void inputs.refetch()} />;

  const saved = { ...DEFAULTS, ...(inputs.data ?? {}) };
  const v = { ...saved, ...draft };
  const changed = Object.keys(draft).length > 0;

  async function save() {
    if (busy) return;
    const payload: Partial<Omit<FileInputs, "file_id">> = { ...draft };
    if (!marginEditable) delete payload.default_margin_pct;
    setBusy(true);
    try {
      await setFileInputs(file.file_id, payload);
      toast.success(pick(TEXT.saved, lang));
      setDraft({});
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  const numberField = (key: "containers" | "overhead_pct", label: Bi, step: string) => (
    <label className="space-y-1 text-sm">
      <span>{pick(label, lang)}</span>
      <input
        type="number" min={0} step={step} className={FIELD} disabled={!editable || busy}
        value={String(v[key])}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value === "" ? 0 : Number(e.target.value) }))}
      />
    </label>
  );

  return (
    <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.sub, lang)}
      action={editable || marginEditable ? <Button size="sm" disabled={!changed || busy} onClick={() => void save()}>{pick(TEXT.save, lang)}</Button> : undefined}>
      <div className="grid gap-3 sm:grid-cols-3">
        {numberField("containers", TEXT.containers, "1")}
        <label className="space-y-1 text-sm">
          <span>{pick(TEXT.delivery, lang)}</span>
          <select className={FIELD} disabled={!editable || busy} value={v.delivery}
            onChange={(e) => setDraft((d) => ({ ...d, delivery: e.target.value as FileInputs["delivery"] }))}>
            <option value="none">{pick(TEXT.none, lang)}</option>
            <option value="jeddah">{pick(TEXT.jeddah, lang)}</option>
            <option value="riyadh">{pick(TEXT.riyadh, lang)}</option>
          </select>
        </label>
        {numberField("overhead_pct", TEXT.overhead, "0.01")}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!editable || busy} checked={v.clearing} onChange={(e) => setDraft((d) => ({ ...d, clearing: e.target.checked }))} />
          {pick(TEXT.clearing, lang)}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!editable || busy} checked={v.is_cinema} onChange={(e) => setDraft((d) => ({ ...d, is_cinema: e.target.checked }))} />
          {pick(TEXT.cinema, lang)}
        </label>
        <label className="space-y-1 text-sm">
          <span>{pick(TEXT.margin, lang)}</span>
          <input
            type="number" step="0.01" className={FIELD} disabled={!marginEditable || busy} placeholder={pick(TEXT.marginHint, lang)}
            value={v.default_margin_pct == null ? "" : String(v.default_margin_pct)}
            onChange={(e) => setDraft((d) => ({ ...d, default_margin_pct: e.target.value === "" ? null : Number(e.target.value) }))}
          />
        </label>
      </div>
    </Panel>
  );
}
