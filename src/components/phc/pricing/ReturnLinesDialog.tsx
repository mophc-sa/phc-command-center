import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { returnLinesToSupplier } from "@/lib/pricing-actions";
import { riyadhToday } from "@/lib/supplier-portal";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";

const TEXT = {
  title: { en: "Return lines to the supplier", ar: "إرجاع بنود للمورد" },
  titlePr: { en: "Return lines to the supplier, and the selling price", ar: "إرجاع بنود للمورد، مع سعر البيع" },
  desc: { en: "Only the lines you tick reopen in the supplier's portal; the others keep their prices.", ar: "تُفتح في بوابة المورد البنود المختارة فقط، وتبقى أسعار البقية." },
  descPr: { en: "This also returns the GM's proposed price: it must be built and proposed again. Only the lines you tick reopen.", ar: "يُعيد هذا أيضاً السعر الذي اقترحه المدير العام: يجب بناؤه واقتراحه من جديد. تُفتح البنود المختارة فقط." },
  lines: { en: "Lines that go back", ar: "البنود المُرجعة" },
  replyBy: { en: "New reply-by date", ar: "موعد رد جديد" },
  note: { en: "Why (internal cost note; sales and the supplier do not see it)", ar: "السبب (ملاحظة تكلفة داخلية؛ لا يراها فريق المبيعات ولا المورد)" },
  message: { en: "Message to the supplier (optional, shown in the portal)", ar: "رسالة للمورد (اختيارية، تظهر في البوابة)" },
  send: { en: "Return the lines", ar: "أرجع البنود" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  done: { en: "Lines returned to the supplier", ar: "أُرجعت البنود للمورد" },
  pickLine: { en: "Tick at least one line.", ar: "اختر بنداً واحداً على الأقل." },
  needNote: { en: "Say why the lines go back.", ar: "اذكر سبب إرجاع البنود." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function ReturnLinesDialog({
  open, onOpenChange, fileId, fromPriceReview, lines, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fileId: string;
  fromPriceReview: boolean;
  lines: { id: string; label: string }[];
  onDone: () => void;
}) {
  const { lang } = useI18n();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [replyBy, setReplyBy] = useState(() => addDays(riyadhToday(), 3));
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function submit() {
    if (busy) return;
    if (picked.size === 0) { toast.error(pick(TEXT.pickLine, lang)); return; }
    if (!note.trim()) { toast.error(pick(TEXT.needNote, lang)); return; }
    setBusy(true);
    try {
      await returnLinesToSupplier(fileId, [...picked], replyBy, note.trim(), message.trim() || null);
      toast.success(pick(TEXT.done, lang));
      setPicked(new Set());
      setNote("");
      setMessage("");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{pick(fromPriceReview ? TEXT.titlePr : TEXT.title, lang)}</DialogTitle>
          <DialogDescription>{pick(fromPriceReview ? TEXT.descPr : TEXT.desc, lang)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <fieldset className="max-h-56 space-y-1 overflow-y-auto">
            <legend className="mb-1">{pick(TEXT.lines, lang)}</legend>
            {lines.map((l) => (
              <label key={l.id} className="flex items-center gap-2">
                <input type="checkbox" disabled={busy} checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
                <span>{l.label}</span>
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1">
            <span>{pick(TEXT.replyBy, lang)}</span>
            <input type="date" className={FIELD} min={riyadhToday()} disabled={busy} value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span>{pick(TEXT.note, lang)}</span>
            <textarea className={FIELD} rows={2} maxLength={1000} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span>{pick(TEXT.message, lang)}</span>
            <textarea className={FIELD} rows={2} maxLength={1000} disabled={busy} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{pick(TEXT.cancel, lang)}</Button>
          <Button disabled={busy} onClick={() => void submit()}>{pick(TEXT.send, lang)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
