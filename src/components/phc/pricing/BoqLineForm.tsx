import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { InstallType } from "@/lib/pricing";
import { importBoqLines } from "@/lib/pricing-actions";
import { BOQ_FIELD_LABEL, INSTALL_TYPES, INSTALL_TYPE_LABEL } from "@/lib/boq-import";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";

const TEXT = {
  title: { en: "Add a line by hand", ar: "أضف بنداً يدوياً" },
  none: { en: "None", ar: "بدون" },
  add: { en: "Add line", ar: "أضف البند" },
  added: { en: "Line added", ar: "أُضيف البند" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";
const EMPTY = { sign_type: "", description: "", quantity: "", unit: "", install_type: "", width_mm: "", height_mm: "", weight_kg: "", mount_height_m: "", has_screen: false, needs_floor_cut: false };

export function BoqLineForm({ fileId, onDone }: { fileId: string; onDone: () => void }) {
  const { lang } = useI18n();
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function add() {
    setBusy(true);
    try {
      await importBoqLines(fileId, [{
        sign_type: v.sign_type.trim(),
        description: v.description.trim() || null,
        quantity: Number(v.quantity),
        unit: v.unit.trim() || null,
        install_type: (v.install_type || null) as InstallType | null,
        width_mm: num(v.width_mm),
        height_mm: num(v.height_mm),
        weight_kg: num(v.weight_kg),
        mount_height_m: num(v.mount_height_m),
        has_screen: v.has_screen,
        needs_floor_cut: v.needs_floor_cut,
      }]);
      toast.success(pick(TEXT.added, lang));
      setV(EMPTY);
      onDone();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  const input = (k: "sign_type" | "description" | "quantity" | "unit" | "width_mm" | "height_mm" | "weight_kg" | "mount_height_m", type = "text") => (
    <label className="space-y-1 text-sm">
      <span>{pick(BOQ_FIELD_LABEL[k], lang)}</span>
      <input className={FIELD} type={type} value={v[k]} onChange={set(k)} />
    </label>
  );

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">{pick(TEXT.title, lang)}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        {input("sign_type")}
        {input("description")}
        {input("quantity", "number")}
        {input("unit")}
        <label className="space-y-1 text-sm">
          <span>{pick(BOQ_FIELD_LABEL.install_type, lang)}</span>
          <select className={FIELD} value={v.install_type} onChange={set("install_type")}>
            <option value="">{pick(TEXT.none, lang)}</option>
            {INSTALL_TYPES.map((t) => (
              <option key={t} value={t}>{pick(INSTALL_TYPE_LABEL[t], lang)}</option>
            ))}
          </select>
        </label>
        {input("width_mm", "number")}
        {input("height_mm", "number")}
        {input("weight_kg", "number")}
        {input("mount_height_m", "number")}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.has_screen} onChange={(e) => setV((x) => ({ ...x, has_screen: e.target.checked }))} />
          {pick(BOQ_FIELD_LABEL.has_screen, lang)}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.needs_floor_cut} onChange={(e) => setV((x) => ({ ...x, needs_floor_cut: e.target.checked }))} />
          {pick(BOQ_FIELD_LABEL.needs_floor_cut, lang)}
        </label>
      </div>
      <Button size="sm" disabled={busy || !v.sign_type.trim() || !(Number(v.quantity) > 0)} onClick={() => void add()}>
        {pick(TEXT.add, lang)}
      </Button>
    </div>
  );
}
