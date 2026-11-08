import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { DocumentsPanel } from "@/components/phc/DocumentsPanel";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import { answerNeedsInfo, askNeedsInfo, attachRevision, deleteBoqLine, freezeBoq, listBoqLines, listDealRevisions } from "@/lib/pricing-actions";
import { canEditPackage } from "@/lib/pricing-access";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { BoqImportDialog } from "@/components/phc/pricing/BoqImportDialog";
import { BoqLineForm } from "@/components/phc/pricing/BoqLineForm";
import { INSTALL_TYPE_LABEL } from "@/lib/boq-import";
import type { PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  received: { en: "Start the package review from the header to work on this file.", ar: "ابدأ دراسة الباكيج من أعلى الصفحة للعمل على هذا الملف." },
  needsTitle: { en: "Missing items with sales", ar: "النواقص لدى المبيعات" },
  due: { en: "Due", ar: "الموعد" },
  answer: { en: "Record the rep's answer", ar: "سجّل رد المندوب" },
  answerTitle: { en: "The rep's answer", ar: "رد المندوب" },
  answerDesc: { en: "Until reps answer from their own screen, record what they sent you. The file goes back to package review.", ar: "إلى أن يرد المندوبون من شاشتهم، سجّل ما أرسلوه لك. يعود الملف إلى دراسة الباكيج." },
  answerField: { en: "Answer", ar: "الرد" },
  checklist: { en: "Checklist", ar: "قائمة التحقق" },
  checkDrawings: { en: "BOQ checked against the drawings", ar: "الكميات مطابقة للرسومات" },
  checkLocation: { en: "BOQ checked against the location plan", ar: "الكميات مطابقة لمخطط المواقع" },
  checkFiles: { en: "Files are complete for the supplier", ar: "الملفات مكتملة للمورد" },
  files: { en: "Drawings and files", ar: "الرسومات والملفات" },
  boq: { en: "BOQ", ar: "جدول الكميات" },
  revision: { en: "Revision", ar: "الإصدار" },
  noRevision: { en: "No BOQ on this file yet. Import it, add lines by hand, or use an existing revision.", ar: "لا كميات في هذا الملف بعد. استوردها أو أضف البنود يدوياً أو استخدم إصداراً موجوداً." },
  useRevision: { en: "Use an existing revision", ar: "استخدم إصداراً موجوداً" },
  frozen: { en: "Frozen", ar: "مجمّد" },
  draft: { en: "Draft", ar: "مسودة" },
  importBtn: { en: "Import from Excel", ar: "استيراد من Excel" },
  sign: { en: "Sign", ar: "اللوحة" },
  qty: { en: "Qty", ar: "الكمية" },
  install: { en: "Install", ar: "التركيب" },
  size: { en: "Size (mm)", ar: "المقاس (مم)" },
  screen: { en: "Screen", ar: "شاشة" },
  yes: { en: "Yes", ar: "نعم" },
  remove: { en: "Remove", ar: "حذف" },
  ask: { en: "Ask sales for missing items", ar: "اطلب النواقص من المبيعات" },
  askTitle: { en: "Missing items", ar: "النواقص" },
  askDesc: { en: "The sales rep sees this list and the due date.", ar: "يرى مندوب المبيعات هذه القائمة والموعد." },
  items: { en: "One missing item per line", ar: "بند ناقص في كل سطر" },
  freeze: { en: "Freeze the BOQ", ar: "جمّد الكميات" },
  freezeTitle: { en: "Freeze this BOQ revision", ar: "تجميد إصدار الكميات" },
  freezeDesc: { en: "Freezing is one-way: a later quantity change opens a new revision. The note below is visible to the sales rep.", ar: "التجميد نهائي: أي تغيير لاحق في الكميات يفتح إصداراً جديداً. الملاحظة أدناه ظاهرة لمندوب المبيعات." },
  status: { en: "Verification", ar: "التحقق" },
  verified: { en: "Verified", ar: "متحقق" },
  partial: { en: "Partially verified", ar: "متحقق جزئياً" },
  note: { en: "Note", ar: "ملاحظة" },
  noteDefault: { en: "Checked against the drawings and the location plan; files complete.", ar: "طوبقت مع الرسومات ومخطط المواقع؛ الملفات مكتملة." },
  frozenNote: { en: "This revision is frozen. Importing or adding a line opens a new revision (selling prices are not carried over).", ar: "هذا الإصدار مجمّد. الاستيراد أو إضافة بند يفتح إصداراً جديداً (لا تُنقل أسعار البيع)." },
  freezeNeedsChecks: { en: "Tick the three checks to freeze.", ar: "علّم البنود الثلاثة للتجميد." },
  done: { en: "Saved", ar: "تم الحفظ" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

export function PackageTab({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const editable = canEditPackage(file.state, rights);
  const revisions = useQuery({ queryKey: ["pricing-revisions", file.opportunity_id], queryFn: () => listDealRevisions(file.opportunity_id) });
  const revisionId = file.boq_revision_id;
  const lines = useQuery({
    queryKey: ["pricing-lines", revisionId],
    queryFn: () => listBoqLines(revisionId as string),
    enabled: revisionId != null,
  });
  const current = (revisions.data ?? []).find((rv) => rv.id === revisionId) ?? null;
  const frozen = current?.frozen_at != null;
  const others = (revisions.data ?? []).filter((rv) => rv.id !== revisionId && rv.superseded_by == null);
  const [checks, setChecks] = useState({ drawings: false, location: false, files: false });
  const [importOpen, setImportOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const allChecked = checks.drawings && checks.location && checks.files;
  const lineCount = lines.data?.length ?? 0;

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      toast.success(pick(TEXT.done, lang));
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  const check = (k: keyof typeof checks, label: Bi) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" disabled={!editable} checked={checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} />
      {pick(label, lang)}
    </label>
  );

  return (
    <div className="space-y-6">
      {file.state === "received" ? <p className="text-sm text-muted-foreground">{pick(TEXT.received, lang)}</p> : null}

      {file.state === "needs_info" ? (
        <Panel title={pick(TEXT.needsTitle, lang)} tone="attention"
          action={rights.is_pricer ? <Button size="sm" onClick={() => setAnswerOpen(true)}>{pick(TEXT.answer, lang)}</Button> : undefined}>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {file.needs_info_items.map((it) => <li key={it}>{it}</li>)}
          </ul>
          {file.needs_info_due ? <p className="mt-2 text-sm text-muted-foreground">{pick(TEXT.due, lang)}: {file.needs_info_due}</p> : null}
        </Panel>
      ) : null}

      <Panel title={pick(TEXT.checklist, lang)}>
        <div className="space-y-2">
          {check("drawings", TEXT.checkDrawings)}
          {check("location", TEXT.checkLocation)}
          {check("files", TEXT.checkFiles)}
        </div>
      </Panel>

      <DocumentsPanel entity={{ type: "opportunity", id: file.opportunity_id }} title={pick(TEXT.files, lang)} />

      <Panel
        title={pick(TEXT.boq, lang)}
        subtitle={current ? `${pick(TEXT.revision, lang)} ${current.revision_number} · ${pick(frozen ? TEXT.frozen : TEXT.draft, lang)}` : undefined}
        action={editable ? <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>{pick(TEXT.importBtn, lang)}</Button> : undefined}
      >
        <div className="space-y-4">
          {editable && others.length > 0 ? (
            <label className="block max-w-sm space-y-1 text-sm">
              <span>{pick(TEXT.useRevision, lang)}</span>
              <select className={FIELD} value="" onChange={(e) => e.target.value && void run(() => attachRevision(file.file_id, e.target.value))}>
                <option value="">—</option>
                {others.map((rv) => (
                  <option key={rv.id} value={rv.id}>
                    {pick(TEXT.revision, lang)} {rv.revision_number} · {pick(rv.frozen_at ? TEXT.frozen : TEXT.draft, lang)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {editable && frozen ? <p className="text-sm text-muted-foreground">{pick(TEXT.frozenNote, lang)}</p> : null}

          {!revisionId ? (
            <p className="text-sm text-muted-foreground">{pick(TEXT.noRevision, lang)}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>{pick(TEXT.sign, lang)}</TableHead>
                  <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
                  <TableHead>{pick(TEXT.install, lang)}</TableHead>
                  <TableHead>{pick(TEXT.size, lang)}</TableHead>
                  <TableHead>{pick(TEXT.screen, lang)}</TableHead>
                  {editable && !frozen ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lines.data ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums">{l.line_number ?? ""}</TableCell>
                    <TableCell>
                      <div className="font-medium">{l.sign_type}</div>
                      {l.description ? <div className="text-xs text-muted-foreground">{l.description}</div> : null}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{formatNumber(l.quantity, lang)} {l.unit ?? ""}</TableCell>
                    <TableCell>{l.install_type ? pick(INSTALL_TYPE_LABEL[l.install_type], lang) : "—"}</TableCell>
                    <TableCell className="tabular-nums">{l.width_mm && l.height_mm ? `${l.width_mm} × ${l.height_mm}` : (l.dimensions ?? "—")}</TableCell>
                    <TableCell>{l.has_screen ? <StatusPill>{pick(TEXT.yes, lang)}</StatusPill> : null}</TableCell>
                    {editable && !frozen ? (
                      <TableCell className="text-end">
                        <Button size="sm" variant="ghost" onClick={() => void run(() => deleteBoqLine(file.file_id, l.id))}>{pick(TEXT.remove, lang)}</Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {editable ? <BoqLineForm fileId={file.file_id} onDone={onChanged} /> : null}
        </div>
      </Panel>

      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setAskOpen(true)}>{pick(TEXT.ask, lang)}</Button>
          <Button disabled={!allChecked || lineCount === 0} onClick={() => setFreezeOpen(true)}>{pick(TEXT.freeze, lang)}</Button>
          {!allChecked ? <span className="text-sm text-muted-foreground">{pick(TEXT.freezeNeedsChecks, lang)}</span> : null}
        </div>
      ) : null}

      <BoqImportDialog open={importOpen} onOpenChange={setImportOpen} fileId={file.file_id} onDone={onChanged} />

      <ActionDialog
        open={askOpen}
        onOpenChange={setAskOpen}
        title={pick(TEXT.askTitle, lang)}
        description={pick(TEXT.askDesc, lang)}
        fields={[
          { key: "items", type: "textarea", label: pick(TEXT.items, lang), required: true },
          { key: "due", type: "date", label: pick(TEXT.due, lang), required: true },
        ]}
        submitLabel={pick(TEXT.ask, lang)}
        recordId={file.file_id}
        onSubmit={async (v) => {
          try {
            await askNeedsInfo(file.file_id, v.items.split("\n").map((s) => s.trim()).filter(Boolean), v.due);
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={answerOpen}
        onOpenChange={setAnswerOpen}
        title={pick(TEXT.answerTitle, lang)}
        description={pick(TEXT.answerDesc, lang)}
        fields={[{ key: "answer", type: "textarea", label: pick(TEXT.answerField, lang), required: true }]}
        submitLabel={pick(TEXT.answer, lang)}
        recordId={file.file_id}
        onSubmit={async (v) => {
          try {
            await answerNeedsInfo(file.file_id, v.answer);
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={freezeOpen}
        onOpenChange={setFreezeOpen}
        title={pick(TEXT.freezeTitle, lang)}
        description={pick(TEXT.freezeDesc, lang)}
        fields={[
          {
            key: "status", type: "select", label: pick(TEXT.status, lang), required: true, defaultValue: "verified",
            options: [
              { value: "verified", label: pick(TEXT.verified, lang) },
              { value: "partially_verified", label: pick(TEXT.partial, lang) },
            ],
          },
          { key: "note", type: "textarea", label: pick(TEXT.note, lang), required: true, defaultValue: pick(TEXT.noteDefault, lang) },
        ]}
        submitLabel={pick(TEXT.freeze, lang)}
        recordId={file.file_id}
        onSubmit={async (v) => {
          try {
            await freezeBoq(file.file_id, v.status as "verified" | "partially_verified", v.note);
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </div>
  );
}
