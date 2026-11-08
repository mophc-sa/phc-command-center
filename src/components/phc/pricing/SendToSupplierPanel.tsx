import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n } from "@/lib/i18n";
import { formatBytes, listEntityDocuments } from "@/lib/document-actions";
import { listEarlierQuotes, listVendors, sendToSupplier } from "@/lib/pricing-actions";
import { riyadhToday } from "@/lib/supplier-portal";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { SupplierAccountsPanel } from "@/components/phc/pricing/SupplierAccountsPanel";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Send to the supplier", ar: "أرسل للمورد" },
  sub: {
    en: "The supplier sees the project code, the lines (sign type, description, size, material, specs, quantity) and the files you tick. Never the client, the site or any price but its own. Check the descriptions name no client.",
    ar: "يرى المورد رمز المشروع والبنود (نوع اللوحة والوصف والمقاس والخامة والمواصفات والكمية) والملفات التي تختارها. لا يرى العميل ولا الموقع ولا أي سعر غير سعره. تأكد أن الأوصاف لا تذكر اسم العميل.",
  },
  supplier: { en: "Supplier", ar: "المورد" },
  pick: { en: "Choose the supplier", ar: "اختر المورد" },
  replyBy: { en: "Reply by", ar: "موعد الرد" },
  files: { en: "Files to send", ar: "الملفات المرسلة" },
  noFiles: { en: "No file is attached to this deal. Attach the drawings and the location plan on the Package tab first.", ar: "لا ملفات مرفقة بهذه الفرصة. أرفق الرسومات ومخطط المواقع من تبويب الباكيج أولاً." },
  renamed: { en: "The supplier sees each file under the project code (e.g. code-01.pdf), not its name here.", ar: "يرى المورد كل ملف باسم رمز المشروع (مثل code-01.pdf) لا باسمه هنا." },
  note: { en: "Note to the supplier (optional, no client names)", ar: "ملاحظة للمورد (اختيارية، دون أسماء العملاء)" },
  earlier: { en: "This BOQ already has prices from before the freeze from:", ar: "لهذه الكميات أسعار من قبل التجميد من:" },
  selection: { en: "This BOQ has a supplier selection from before the freeze.", ar: "لهذه الكميات اختيار مورد من قبل التجميد." },
  replace: { en: "Cancel those earlier prices for this file (one supplier per file)", ar: "ألغِ تلك الأسعار السابقة لهذا الملف (مورد واحد لكل ملف)" },
  send: { en: "Send to the supplier", ar: "أرسل للمورد" },
  sending: { en: "Sending…", ar: "جارٍ الإرسال…" },
  sent: { en: "Sent to the supplier", ar: "أُرسل للمورد" },
  lines: { en: "lines", ar: "بنود" },
  filesSent: { en: "files", ar: "ملفات" },
  chooseVendor: { en: "Choose the supplier first.", ar: "اختر المورد أولاً." },
  chooseFiles: { en: "Tick at least one file.", ar: "اختر ملفاً واحداً على الأقل." },
  confirmEarlier: { en: "Tick the box to cancel the earlier prices first.", ar: "ضع العلامة لإلغاء الأسعار السابقة أولاً." },
  shownWarning: {
    en: "The supplier sees each line's sign type, description, size, material, mounting, illumination, finish and quantity, and your note, exactly as written. Do not put a client name, project name or site in them. Files are renamed, but their contents go as they are: check drawings' title blocks.",
    ar: "يرى المورد نوع اللوحة والوصف والمقاس والخامة والتثبيت والإضاءة والتشطيب والكمية لكل بند، وملاحظتك، كما كُتبت تماماً. لا تضع فيها اسم عميل أو اسم مشروع أو موقعاً. تُعاد تسمية الملفات لكن محتواها يُرسل كما هو: راجع خانة العنوان في الرسومات.",
  },
} satisfies Record<string, Bi>;

/** dbMessage plus the server's DETAIL (e.g. the estimation ids that depend on a cleared selection). */
function sendError(e: unknown, lang: "en" | "ar"): string {
  const detail = e && typeof e === "object" && "details" in e ? (e as { details?: unknown }).details : null;
  const msg = dbMessage(e, lang);
  return typeof detail === "string" && detail.trim() && !msg.includes(detail.trim()) ? `${msg} (${detail.trim()})` : msg;
}

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** boq_frozen (or at_supplier with no open request): one supplier, a reply-by date, the files. */
export function SendToSupplierPanel({ file, onChanged }: Pick<PricingTabProps, "file" | "onChanged">) {
  const { lang } = useI18n();
  const revisionId = file.boq_revision_id as string;
  const vendors = useQuery({ queryKey: ["pricing-vendors"], queryFn: listVendors });
  const docs = useQuery({
    queryKey: ["pricing-deal-documents", file.opportunity_id],
    queryFn: () => listEntityDocuments({ type: "opportunity", id: file.opportunity_id }),
  });
  const earlier = useQuery({ queryKey: ["pricing-earlier-quotes", revisionId], queryFn: () => listEarlierQuotes(revisionId) });
  const [vendorId, setVendorId] = useState("");
  const [replyBy, setReplyBy] = useState(() => addDays(riyadhToday(), 7));
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);

  if (vendors.isLoading || docs.isLoading || earlier.isLoading) return <SkeletonTable rows={3} />;
  if (vendors.isError || docs.isError || earlier.isError) {
    return <QueryFailure retry={() => { void vendors.refetch(); void docs.refetch(); void earlier.refetch(); }} />;
  }

  // The latest version of each file; every one is ticked until the pricer changes it.
  const current = (docs.data ?? []).filter((d) => !d.superseded_by);
  const chosen = picked ?? new Set(current.map((d) => d.id));
  const live = (earlier.data ?? []).filter((q) => q.status !== "cancelled" && q.status !== "superseded");
  const others = [...new Set(live.filter((q) => q.vendor_id !== vendorId).map((q) => q.vendor_name))];
  const selected = live.some((q) => q.is_selected);
  const needsConfirm = vendorId !== "" && (others.length > 0 || selected);

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function send() {
    if (busy) return;
    if (!vendorId) { toast.error(pick(TEXT.chooseVendor, lang)); return; }
    if (chosen.size === 0) { toast.error(pick(TEXT.chooseFiles, lang)); return; }
    if (needsConfirm && !replace) { toast.error(pick(TEXT.confirmEarlier, lang)); return; }
    setBusy(true);
    try {
      const r = await sendToSupplier(file.file_id, vendorId, replyBy, [...chosen], note.trim() || null, replace);
      toast.success(`${pick(TEXT.sent, lang)} · ${r.lines} ${pick(TEXT.lines, lang)} · ${r.files} ${pick(TEXT.filesSent, lang)}`);
      onChanged();
    } catch (e) {
      toast.error(sendError(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.sub, lang)}>
      <div className="space-y-4 text-sm">
        <p role="note" className="rounded-md border border-amber/40 bg-amber/10 p-2 text-amber-light">
          {pick(TEXT.shownWarning, lang)}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span>{pick(TEXT.supplier, lang)}</span>
            <select className={FIELD} value={vendorId} disabled={busy} onChange={(e) => { setVendorId(e.target.value); setReplace(false); }}>
              <option value="">{pick(TEXT.pick, lang)}</option>
              {(vendors.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span>{pick(TEXT.replyBy, lang)}</span>
            <input type="date" className={FIELD} disabled={busy} min={riyadhToday()} value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
          </label>
        </div>

        <fieldset className="space-y-1">
          <legend className="mb-1">{pick(TEXT.files, lang)}</legend>
          {current.length === 0 ? <p className="text-amber-light">{pick(TEXT.noFiles, lang)}</p> : null}
          {current.map((d) => (
            <label key={d.id} className="flex items-center gap-2">
              <input type="checkbox" disabled={busy} checked={chosen.has(d.id)} onChange={() => toggle(d.id)} />
              <span>{d.title || d.original_filename}</span>
              <span className="text-xs text-muted-foreground">{formatBytes(d.size_bytes)}</span>
            </label>
          ))}
          {current.length > 0 ? <p className="text-xs text-muted-foreground">{pick(TEXT.renamed, lang)}</p> : null}
        </fieldset>

        <label className="block space-y-1">
          <span>{pick(TEXT.note, lang)}</span>
          <textarea className={FIELD} rows={2} maxLength={1000} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {needsConfirm ? (
          <div className="space-y-1 rounded-md border border-amber/40 bg-amber/10 p-2">
            {others.length > 0 ? <p>{pick(TEXT.earlier, lang)} {others.join(lang === "ar" ? "، " : ", ")}</p> : null}
            {selected ? <p>{pick(TEXT.selection, lang)}</p> : null}
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={busy} checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              <span>{pick(TEXT.replace, lang)}</span>
            </label>
          </div>
        ) : null}

        <Button disabled={busy || !vendorId || chosen.size === 0} onClick={() => void send()}>
          {pick(busy ? TEXT.sending : TEXT.send, lang)}
        </Button>

        {vendorId ? <SupplierAccountsPanel vendorId={vendorId} /> : null}
      </div>
    </Panel>
  );
}
