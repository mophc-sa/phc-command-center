// =============================================================================
// Historical Sales Archive — a tab inside Sales Management, not a module.
//
// The 679 records are history, not pipeline. Giving them their own destination
// in the sidebar would put an archive next to the live CRM and invite people to
// treat the two as the same thing; the badges below exist for the same reason.
// Sales Management is already where someone goes to look across deals rather
// than work one, so this belongs there.
//
// Strictly read-only. The staging tables carry no INSERT/UPDATE/DELETE policy,
// so there is no action to offer and none is rendered — no convert button, no
// edit, no link-to-opportunity. When promotion into canonical entities is
// approved it will be a separate, deliberate flow.
// =============================================================================

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, AlertTriangle, Download, Search, X } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";
import {
  EMPTY_FILTERS, exportFilename, filterHistorical, getHistoricalQuality, listHistoricalSales,
  ownerOptions, qualityFlags, statusOptions, summarise, toCsv,
  yearOptions, yearRange, selectedYear, statusBreakdown,
  type HistoricalFilters, type HistoricalSaleRow, type QualityFlag,
} from "@/lib/historical-sales";

// Neutral by design. These describe the state of a 2022-2026 spreadsheet, not
// a fault in the import — "92 records have no amount" is a fact about the
// source; "92 errors" would blame the archive for the paperwork.
const FLAG_LABEL: Record<QualityFlag, { en: string; ar: string }> = {
  missing_owner:     { en: "Missing Owner",      ar: "بلا مالك مرتبط" },
  missing_amount:    { en: "Missing Amount",     ar: "بلا قيمة" },
  unmatched_company: { en: "Unmatched Company",  ar: "شركة غير مطابقة" },
  unparsed_code:     { en: "Unparsed Code",      ar: "رمز غير مقروء" },
};

const FLAG_SENTENCE: Record<QualityFlag, (n: string, ar: boolean) => string> = {
  missing_owner:     (n, ar) => (ar ? `${n} سجل بلا مالك مرتبط بحساب`   : `${n} records have no mapped owner`),
  missing_amount:    (n, ar) => (ar ? `${n} سجل بلا قيمة`               : `${n} records have no amount`),
  unmatched_company: (n, ar) => (ar ? `${n} سجل غير مرتبط بشركة`        : `${n} records are not matched to a company`),
  unparsed_code:     (n, ar) => (ar ? `${n} سجل برمز غير مقروء`         : `${n} records have an unparsed code`),
};

export function HistoricalSalesView() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [f, setF] = useState<HistoricalFilters>(EMPTY_FILTERS);

  // One fetch for the archive; 679 rows filter faster in memory than a round
  // trip per keystroke. See listHistoricalSales.
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["historical-sales"],
    queryFn: listHistoricalSales,
    staleTime: 10 * 60_000,
  });
  const { data: quality } = useQuery({
    queryKey: ["historical-sales-quality"],
    queryFn: getHistoricalQuality,
    staleTime: 10 * 60_000,
  });

  const filtered = useMemo(() => filterHistorical(rows, f), [rows, f]);
  const sum = useMemo(() => summarise(filtered), [filtered]);
  const owners = useMemo(() => ownerOptions(rows), [rows]);
  const statuses = useMemo(() => statusOptions(rows), [rows]);
  const years = useMemo(() => yearOptions(rows), [rows]);
  const activeYear = selectedYear(f);
  const byStatus = useMemo(() => statusBreakdown(filtered), [filtered]);
  const set = <K extends keyof HistoricalFilters>(k: K, v: HistoricalFilters[K]) => setF((p) => ({ ...p, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);

  const fmtDate = (s: string | null) =>
    s ? new Date(s).toLocaleDateString(ar ? "ar-SA" : "en-GB", { year: "numeric", month: "short", day: "numeric" }) : "—";

  if (isLoading) return <SkeletonTable rows={10} />;

  // An empty archive for a permitted role means the load has not run; for a
  // role the view refuses it means exactly nothing, and saying "no records"
  // would be misleading. The database decides which of the two this is, so the
  // copy stays neutral.
  if (rows.length === 0) {
    return (
      <EmptyState
        title={ar ? "أرشيف المبيعات التاريخية غير متاح" : "Historical Sales Archive not available"}
        description={ar
          ? "الأرشيف التاريخي غير متاح لدورك، أو لم يُحمَّل بعد."
          : "The historical archive is either not loaded yet, or not available to your role."}
      />
    );
  }

  return (
    <div className="grid gap-4">
      {/* The standing disclaimer. This is history, and every row says so. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2">
        <Archive className="h-4 w-4 shrink-0 text-amber-light" aria-hidden="true" />
        <span className="text-xs text-amber-light">
          {ar
            ? "أرشيف المبيعات التاريخية 2022–2026. سجلات للقراءة فقط. لم تُحوَّل إلى فرص أو عروض أسعار."
            : "Historical Sales Archive 2022–2026. Read-only records. Not converted to opportunities or quotations."}
        </span>
      </div>

      {/* Totals for what is on screen, not the whole archive. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label={ar ? "سجلات" : "Records"} value={formatNumber(sum.count, lang)} />
        <Stat label={ar ? "بقيمة" : "With value"} value={formatNumber(sum.valued, lang)} />
        <Stat label={ar ? "الإجمالي (بدون ضريبة)" : "Total (excl. VAT)"} value={formatCurrency(sum.total, lang, "SAR")} />
        <Stat label={ar ? "مرحّلة" : "Submitted"} value={formatNumber(sum.submitted, lang)} />
        <Stat label={ar ? "مكسوبة" : "Won"} value={formatNumber(sum.won, lang)} tone="won" />
        <Stat label={ar ? "مفقودة" : "Lost"} value={formatNumber(sum.lost, lang)} tone="lost" />
      </div>

      {/* Status breakdown for what is on screen. Ordered by value, not count:
          a year with forty small losses and two large wins is a good year, and
          ordering by count would put the losses first and say the opposite.
          Clickable, so the breakdown is also the way in. */}
      {byStatus.length > 1 ? (
        <Panel
          title={activeYear
            ? (ar ? `حسب الحالة · ${activeYear}` : `By status · ${activeYear}`)
            : (ar ? "حسب الحالة" : "By status")}
          subtitle={ar ? "اضغط للتصفية" : "Click to filter"}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {byStatus.map((b) => {
              const undecided = b.status === "undecided";
              const on = !undecided && f.status === b.status;
              return (
                <button
                  key={b.status}
                  type="button"
                  onClick={() => { if (!undecided) set("status", on ? "" : b.status); }}
                  disabled={undecided}
                  className={`rounded-lg border p-2.5 text-start transition-colors ${
                    on ? "border-primary/40 bg-primary/10" : "border-border hover:bg-surface-2/50"
                  } ${undecided ? "cursor-default opacity-80" : ""}`}
                >
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{b.status}</div>
                  <div className="mt-0.5 text-sm font-medium">{formatNumber(b.count, lang)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatCurrency(b.total, lang, "SAR")}
                    {b.valued < b.count ? <span> · {b.valued}/{b.count}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {/* Quality indicators. Clickable, because a count nobody can act on is
          decoration — each one filters the table to the rows it counts. */}
      {quality ? (
        <Panel title={ar ? "جودة البيانات" : "Data Quality"}
               subtitle={ar ? "حالة السجل المصدر — اضغط للتصفية" : "The state of the source record — click to filter"}>
          <div className="flex flex-wrap gap-2">
            <QualityChip flag="missing_owner"     n={quality.owners_legacy_only}     active={f.flag === "missing_owner"}     onClick={() => set("flag", f.flag === "missing_owner" ? "" : "missing_owner")} lang={lang} />
            <QualityChip flag="missing_amount"    n={quality.amounts_absent}         active={f.flag === "missing_amount"}    onClick={() => set("flag", f.flag === "missing_amount" ? "" : "missing_amount")} lang={lang} />
            <QualityChip flag="unmatched_company" n={quality.companies_unmatched}    active={f.flag === "unmatched_company"} onClick={() => set("flag", f.flag === "unmatched_company" ? "" : "unmatched_company")} lang={lang} />
            <QualityChip flag="unparsed_code"     n={quality.codes_unparsed + quality.codes_placeholder} active={f.flag === "unparsed_code"} onClick={() => set("flag", f.flag === "unparsed_code" ? "" : "unparsed_code")} lang={lang} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {ar
              ? `${formatNumber(quality.statuses_needing_decision, lang)} سجل بحالة تحتاج قرارًا · ${formatNumber(quality.revisions, lang)} مراجعة مرقّمة`
              : `${formatNumber(quality.statuses_needing_decision, lang)} records with a status needing a decision · ${formatNumber(quality.revisions, lang)} numbered revisions`}
          </p>
        </Panel>
      ) : null}

      {/* Filters — the eight the business asked for. */}
      <Panel title={ar ? "تصفية" : "Filter"}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute inset-inline-start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              className="h-8 ps-7 text-xs"
              value={f.q}
              onChange={(e) => set("q", e.target.value)}
              placeholder={ar ? "رمز المبيعات، العميل، المشروع، الموقع…" : "Sales code, client, project, location…"}
              aria-label={ar ? "بحث" : "Search"}
            />
          </label>

          <Select label={ar ? "الحالة" : "Status"} value={f.status} onChange={(v) => set("status", v)}
            options={[{ value: "", label: ar ? "كل الحالات" : "All statuses" },
              ...statuses.map((s) => ({ value: s.value, label: `${s.value} (${s.count})` }))]} />

          <Select label={ar ? "المسار" : "JIH / Tender"} value={f.route} onChange={(v) => set("route", v)}
            options={[{ value: "", label: ar ? "الكل" : "All" }, { value: "jih", label: "JIH" }, { value: "tender", label: "Tender" }]} />

          <Select label={ar ? "المالك" : "Legacy owner"} value={f.owner} onChange={(v) => set("owner", v)}
            options={[{ value: "", label: ar ? "كل الملّاك" : "All owners" },
              ...owners.map((o) => ({ value: o.prefix, label: `${o.prefix} (${o.count})` }))]} />

          <NumField label={ar ? "أقل قيمة" : "Min amount"} value={f.minAmount} onChange={(v) => set("minAmount", v)} />
          <NumField label={ar ? "أعلى قيمة" : "Max amount"} value={f.maxAmount} onChange={(v) => set("maxAmount", v)} />

          <DateField label={ar ? "من تاريخ التقديم" : "Submitted from"} value={f.fromDate} onChange={(v) => set("fromDate", v)} />
          <DateField label={ar ? "إلى تاريخ التقديم" : "Submitted to"} value={f.toDate} onChange={(v) => set("toDate", v)} />
        </div>

        {/* Year — the question people actually arrive with is "how did 2026
            go", and answering it through two date pickers made it a chore
            nobody did. Derived from the data, so next year appears on its own. */}
        {years.length > 1 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {ar ? "السنة" : "Year"}
            </span>
            <button
              type="button"
              onClick={() => setF((p) => ({ ...p, fromDate: null, toDate: null }))}
              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                activeYear === "" ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {ar ? "الكل" : "All"}
            </button>
            {years.map((y) => (
              <button
                key={y.year}
                type="button"
                onClick={() => setF((p) => ({ ...p, ...yearRange(y.year) }))}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                  activeYear === y.year ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {y.year} <span className="text-muted-foreground">({y.count})</span>
              </button>
            ))}
          </div>
        ) : null}
        {dirty ? (
          <button
            type="button"
            onClick={() => setF(EMPTY_FILTERS)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            {ar ? "مسح التصفية" : "Clear filters"}
          </button>
        ) : null}
      </Panel>

      {/* Results */}
      <Panel
        title={ar ? "سجلات الأرشيف" : "Archive records"}
        subtitle={`${formatNumber(filtered.length, lang)} / ${formatNumber(rows.length, lang)}`}
        action={
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={() => downloadCsv(filtered)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {ar
              ? `تصدير CSV (${formatNumber(filtered.length, lang)})`
              : `Export CSV (${formatNumber(filtered.length, lang)})`}
          </button>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState
            title={ar ? "لا نتائج" : "No matches"}
            description={ar ? "جرّب توسيع التصفية." : "Try widening the filters."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 text-start font-medium">{ar ? "الرمز" : "Sales code"}</th>
                  <th className="py-2 text-start font-medium">{ar ? "العميل" : "Client"}</th>
                  <th className="py-2 text-start font-medium">{ar ? "المشروع" : "Project"}</th>
                  <th className="py-2 text-start font-medium">{ar ? "المالك" : "Owner"}</th>
                  <th className="py-2 text-start font-medium">{ar ? "الحالة" : "Status"}</th>
                  <th className="py-2 text-end font-medium">{ar ? "القيمة" : "Amount"}</th>
                  <th className="py-2 text-start font-medium">{ar ? "تاريخ التقديم" : "Submitted"}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((r) => (
                  <Row key={r.row_id} r={r} lang={lang} ar={ar} fmtDate={fmtDate} />
                ))}
              </tbody>
            </table>
            {filtered.length > 300 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {ar
                  ? `تُعرض أول 300 من ${formatNumber(filtered.length, lang)} — ضيّق التصفية لرؤية الباقي.`
                  : `Showing the first 300 of ${formatNumber(filtered.length, lang)} — narrow the filters to see the rest.`}
              </p>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Row({ r, lang, ar, fmtDate }: {
  r: HistoricalSaleRow; lang: "en" | "ar"; ar: boolean; fmtDate: (s: string | null) => string;
}) {
  const flags = qualityFlags(r);
  return (
    <tr className="border-b border-border/40 align-top text-foreground">
      <td className="py-2">
        <span className="font-medium">{r.sales_code ?? "—"}</span>
        {r.revision_no ? (
          <span className="ms-1 rounded bg-surface-2 px-1 text-[10px] text-muted-foreground">rev {r.revision_no}</span>
        ) : null}
        {r.route ? (
          <span className="ms-1 text-[10px] uppercase text-muted-foreground">{r.route}</span>
        ) : null}
        {/* Every row carries the badge, not just the header banner — a screenshot
            of one row has to say what it is too. */}
        <span className="ms-1 rounded bg-amber/15 px-1 text-[10px] text-amber-light">
          {ar ? "تاريخي" : "Historical"}
        </span>
      </td>
      <td className="py-2">
        <span className="block max-w-[170px] truncate">{r.client ?? "—"}</span>
        {!r.company_matched && r.client ? (
          <span className="text-[10px] text-muted-foreground">{ar ? "غير مرتبط بشركة" : "not linked to a company"}</span>
        ) : null}
      </td>
      <td className="py-2"><span className="block max-w-[210px] truncate">{r.project ?? "—"}</span>
        {r.location ? <span className="text-[10px] text-muted-foreground">{r.location}</span> : null}
      </td>
      <td className="py-2"><span className="block max-w-[130px] truncate text-muted-foreground">{r.owner ?? "—"}</span></td>
      <td className="py-2">
        <span>{r.status_canonical ?? r.status ?? "—"}</span>
        {!r.status_canonical && r.status ? (
          <span className="ms-1 text-[10px] text-amber-light">{ar ? "يحتاج قرارًا" : "needs decision"}</span>
        ) : null}
      </td>
      <td className="num py-2 text-end" data-tabular="true">
        {r.amount !== null ? formatCurrency(r.amount, lang, r.currency || "SAR") : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2 text-muted-foreground">
        {fmtDate(r.date_submitted)}
        {flags.length ? (
          <span className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-light" title={flags.map((x) => FLAG_LABEL[x][ar ? "ar" : "en"]).join(" · ")}>
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {flags.length}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "won" | "lost" }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`num mt-0.5 text-sm ${tone === "won" ? "text-won" : tone === "lost" ? "text-lost" : "text-foreground"}`} data-tabular="true">{value}</div>
    </div>
  );
}

function QualityChip({ flag, n, active, onClick, lang }: {
  flag: QualityFlag; n: number; active: boolean; onClick: () => void; lang: "en" | "ar";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
        active ? "border-amber/60 bg-amber/20 text-amber-light" : "border-border bg-surface-2 text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className="font-medium">{FLAG_LABEL[flag][lang === "ar" ? "ar" : "en"]}</span>
      <span className="ms-1 opacity-80">· {FLAG_SENTENCE[flag](n.toLocaleString(lang === "ar" ? "ar-SA" : "en-GB"), lang === "ar")}</span>
    </button>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <select
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <Input
        className="h-8 text-xs" inputMode="numeric" value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          onChange(v === "" ? null : Number(v));
        }}
      />
    </label>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <Input className="h-8 text-xs" type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
    </label>
  );
}

/**
 * Hand the filtered rows to the browser as a file.
 *
 * Takes the already-filtered array, so the export cannot disagree with the
 * table — there is one filtering path and both the screen and the file are
 * downstream of it. A second filter here is how an export quietly ships more
 * than the person was looking at.
 *
 * A BOM is prepended because Excel reads a UTF-8 CSV as Latin-1 without one,
 * and Arabic client names would arrive as mojibake — which is most of this file.
 */
function downloadCsv(rows: HistoricalSaleRow[]) {
  const today = new Date().toISOString().slice(0, 10);
  const blob = new Blob(["\uFEFF" + toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilename(today, rows.length);
  a.click();
  URL.revokeObjectURL(url);
}
