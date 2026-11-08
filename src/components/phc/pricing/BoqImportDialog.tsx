import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_UNITS, MAX_IMPORT_LINES, BOQ_FIELDS, BOQ_FIELD_LABEL, findHeaderRow, guessMapping, mapRows, readWorkbook, type BoqField, type ColumnMapping, type ImportUnits } from "@/lib/boq-import";
import { importBoqLines } from "@/lib/pricing-actions";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";

const TEXT = {
  title: { en: "Import BOQ lines from Excel", ar: "استيراد بنود الكميات من Excel" },
  desc: { en: "Choose the file, check which column is which, then import. Nothing is saved until you press Import.", ar: "اختر الملف، وتحقق من الأعمدة، ثم استورد. لا يُحفظ شيء قبل الضغط على استيراد." },
  file: { en: "Spreadsheet (.xlsx, .xls, .csv)", ar: "جدول البيانات (.xlsx أو .xls أو .csv)" },
  sheet: { en: "Sheet", ar: "الورقة" },
  header: { en: "Header row", ar: "صف العناوين" },
  column: { en: "Column", ar: "العمود" },
  none: { en: "Not in this file", ar: "غير موجود في الملف" },
  ready: { en: "lines ready", ar: "بنداً جاهزاً" },
  bad: { en: "rows with problems (not imported)", ar: "صفاً فيه مشكلة (لن يُستورد)" },
  skipped: { en: "blank or total rows skipped", ar: "صفاً فارغاً أو إجمالياً تُرك" },
  row: { en: "Row", ar: "الصف" },
  replaceNote: { en: "Importing replaces the lines already entered in this draft. Lines a supplier quote prices cannot be replaced.", ar: "الاستيراد يستبدل البنود المُدخلة في هذه المسودة. لا يمكن استبدال بنود يسعّرها عرض مورّد." },
  tooMany: { en: "At most 2000 lines can be imported at a time.", ar: "يمكن استيراد 2000 بند كحد أقصى في المرة." },
  importBtn: { en: "Import", ar: "استيراد" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  done: { en: "lines imported", ar: "بنداً استُورد" },
  tooBig: { en: "This file is larger than 5 MB. Split it or remove images and unused sheets.", ar: "حجم الملف أكبر من 5 ميغابايت. قسّمه أو احذف الصور والأوراق غير المستخدمة." },
  reading: { en: "Reading the file…", ar: "جارٍ قراءة الملف…" },
  importing: { en: "Importing…", ar: "جارٍ الاستيراد…" },
  units: { en: "Units in this file", ar: "الوحدات في هذا الملف" },
  mountUnit: { en: "Mount height column is in", ar: "عمود ارتفاع التركيب بوحدة" },
  sizeUnit: { en: "Width and height columns are in", ar: "عمودا العرض والارتفاع بوحدة" },
  metres: { en: "metres", ar: "متر" },
  mm: { en: "millimetres", ar: "مليمتر" },
  cm: { en: "centimetres", ar: "سنتيمتر" },
  warnings: { en: "rows to check (still imported)", ar: "صفوف تحتاج مراجعة (ستُستورد)" },
  andMore: { en: "and", ar: "و" },
  more: { en: "more", ar: "أخرى" },
  frozenWarn: {
    en: "This revision is frozen. Importing opens a NEW revision that contains ONLY the imported lines. The frozen lines are not carried over, and selling prices are not carried over.",
    ar: "هذا الإصدار مجمّد. الاستيراد يفتح إصداراً جديداً يحوي البنود المستوردة فقط. لا تُنقل البنود المجمّدة ولا أسعار البيع.",
  },
  readFail: { en: "This file could not be read as a spreadsheet.", ar: "تعذّرت قراءة الملف كجدول بيانات." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SHOWN = 20;

export function BoqImportDialog({
  open, onOpenChange, fileId, frozen = false, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; fileId: string; frozen?: boolean; onDone: () => void }) {
  const { lang } = useI18n();
  const [sheets, setSheets] = useState<{ name: string; rows: unknown[][] }[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<Bi | null>(null);
  const [units, setUnits] = useState<ImportUnits>(DEFAULT_UNITS);
  const [inputKey, setInputKey] = useState(0);
  const rows = sheets[sheetIdx]?.rows ?? [];
  const header = rows[headerRow] ?? [];
  const result = useMemo(() => mapRows(rows, headerRow, mapping, units), [rows, headerRow, mapping, units]);

  function chooseSheet(all: { name: string; rows: unknown[][] }[], idx: number) {
    const h = findHeaderRow(all[idx]?.rows ?? []);
    setSheetIdx(idx);
    setHeaderRow(h);
    setMapping(guessMapping(all[idx]?.rows[h] ?? []));
  }

  function reset() {
    setSheets([]);
    setSheetIdx(0);
    setHeaderRow(0);
    setMapping({});
    setUnits(DEFAULT_UNITS);
    setFileError(null);
    setReading(false);
    setInputKey((k) => k + 1);
  }

  function changeOpen(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileError(null);
    setSheets([]);
    if (f.size > MAX_FILE_BYTES) {
      setFileError(TEXT.tooBig);
      return;
    }
    setReading(true);
    try {
      const all = await readWorkbook(f);
      setSheets(all);
      chooseSheet(all, 0);
    } catch {
      setFileError(TEXT.readFail);
    } finally {
      setReading(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const r = await importBoqLines(fileId, result.lines, true);
      toast.success(`${r.inserted} ${pick(TEXT.done, lang)}`);
      onDone();
      changeOpen(false);
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{pick(TEXT.title, lang)}</DialogTitle>
          <DialogDescription>{pick(TEXT.desc, lang)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span>{pick(TEXT.file, lang)}</span>
            <input key={inputKey} type="file" accept=".xlsx,.xls,.csv" className={FIELD} disabled={reading || busy} onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {reading ? <p className="text-sm text-muted-foreground">{pick(TEXT.reading, lang)}</p> : null}
          {fileError ? <p className="text-sm text-destructive">{pick(fileError, lang)}</p> : null}
          {frozen ? <p className="rounded-md border border-border p-2 text-sm font-medium text-destructive">{pick(TEXT.frozenWarn, lang)}</p> : null}
          {sheets.length > 0 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span>{pick(TEXT.sheet, lang)}</span>
                  <select className={FIELD} value={sheetIdx} onChange={(e) => chooseSheet(sheets, Number(e.target.value))}>
                    {sheets.map((s, i) => (
                      <option key={s.name} value={i}>{s.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span>{pick(TEXT.header, lang)}</span>
                  <input
                    type="number" min={1} max={rows.length} className={FIELD} value={headerRow + 1}
                    onChange={(e) => {
                      const h = Math.max(0, Number(e.target.value) - 1);
                      setHeaderRow(h);
                      setMapping(guessMapping(rows[h] ?? []));
                    }}
                  />
                </label>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">{pick(TEXT.units, lang)}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span>{pick(TEXT.mountUnit, lang)}</span>
                    <select className={FIELD} value={units.mountHeight} onChange={(e) => setUnits((u) => ({ ...u, mountHeight: e.target.value as ImportUnits["mountHeight"] }))}>
                      <option value="m">{pick(TEXT.metres, lang)}</option>
                      <option value="mm">{pick(TEXT.mm, lang)}</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>{pick(TEXT.sizeUnit, lang)}</span>
                    <select className={FIELD} value={units.size} onChange={(e) => setUnits((u) => ({ ...u, size: e.target.value as ImportUnits["size"] }))}>
                      <option value="mm">{pick(TEXT.mm, lang)}</option>
                      <option value="cm">{pick(TEXT.cm, lang)}</option>
                      <option value="m">{pick(TEXT.metres, lang)}</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                {BOQ_FIELDS.map((field: BoqField) => (
                  <label key={field} className="flex items-center justify-between gap-2 text-sm">
                    <span>{pick(BOQ_FIELD_LABEL[field], lang)}</span>
                    <select
                      className={`${FIELD} max-w-[60%]`}
                      aria-label={`${pick(TEXT.column, lang)}: ${pick(BOQ_FIELD_LABEL[field], lang)}`}
                      value={mapping[field] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [field]: e.target.value === "" ? undefined : Number(e.target.value) }))
                      }
                    >
                      <option value="">{pick(TEXT.none, lang)}</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>{String(h ?? "").trim() || `${pick(TEXT.column, lang)} ${i + 1}`}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="space-y-1 text-sm">
                <p>{result.lines.length} {pick(TEXT.ready, lang)} · {result.errors.length} {pick(TEXT.bad, lang)} · {result.skipped} {pick(TEXT.skipped, lang)}</p>
                {result.lines.length > MAX_IMPORT_LINES ? <p className="text-destructive">{pick(TEXT.tooMany, lang)}</p> : null}
                <ul className="max-h-32 overflow-y-auto text-destructive">
                  {result.errors.slice(0, SHOWN).map((er) => (
                    <li key={er.row}>{pick(TEXT.row, lang)} {er.row}: {pick(er.message, lang)}</li>
                  ))}
                  {result.errors.length > SHOWN ? (
                    <li>{pick(TEXT.andMore, lang)} {result.errors.length - SHOWN} {pick(TEXT.more, lang)}</li>
                  ) : null}
                </ul>
                {result.warnings.length > 0 ? (
                  <div>
                    <p className="font-medium">{result.warnings.length} {pick(TEXT.warnings, lang)}</p>
                    <ul className="max-h-32 overflow-y-auto text-amber-700 dark:text-amber-400">
                      {result.warnings.slice(0, SHOWN).map((w, i) => (
                        <li key={`${w.row}-${i}`}>{pick(TEXT.row, lang)} {w.row}: {pick(w.message, lang)}</li>
                      ))}
                      {result.warnings.length > SHOWN ? (
                        <li>{pick(TEXT.andMore, lang)} {result.warnings.length - SHOWN} {pick(TEXT.more, lang)}</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">{pick(TEXT.replaceNote, lang)}</p>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>{pick(TEXT.cancel, lang)}</Button>
          <Button disabled={busy || reading || result.lines.length === 0 || result.lines.length > MAX_IMPORT_LINES} onClick={() => void submit()}>{busy ? pick(TEXT.importing, lang) : pick(TEXT.importBtn, lang)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
