import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BackButton } from "@/components/phc/BackButton";
import { Callout } from "@/components/phc/Callout";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n, formatNumber } from "@/lib/i18n";
import {
  getQuotationHeader, getQuotationRevision, getQuoteDeal, listQuotationLines,
} from "@/lib/pricing-actions";
import { linesMatch, QUOTE_STATUS_LABEL, revisionLabel, unitPrice } from "@/lib/quotation-doc";
import { pick, type Bi } from "@/lib/pricing-text";

// The client's quotation, printed to PDF from the browser (Save as PDF). The
// browser shapes Arabic correctly, which PDF libraries do not. Selling figures
// only: the revision, its line snapshot, the deal's name and client.
export const Route = createFileRoute("/_authenticated/quotation-print/$revisionId")({
  head: () => ({ meta: [{ title: "Quotation — PHC" }, { name: "robots", content: "noindex" }] }),
  component: QuotationPrintPage,
});

const TEXT = {
  heading: { en: "Quotation", ar: "عرض سعر" },
  number: { en: "Quotation no.", ar: "رقم العرض" },
  date: { en: "Date", ar: "التاريخ" },
  valid: { en: "Valid until", ar: "صالح حتى" },
  to: { en: "To", ar: "إلى" },
  project: { en: "Project", ar: "المشروع" },
  no: { en: "No.", ar: "م" },
  item: { en: "Description", ar: "البيان" },
  qty: { en: "Qty", ar: "الكمية" },
  unit: { en: "Unit", ar: "الوحدة" },
  unitPrice: { en: "Unit price", ar: "سعر الوحدة" },
  total: { en: "Total", ar: "الإجمالي" },
  subtotal: { en: "Subtotal (excl. VAT)", ar: "الإجمالي قبل الضريبة" },
  vat: { en: "VAT", ar: "ضريبة القيمة المضافة" },
  grand: { en: "Total incl. VAT", ar: "الإجمالي شامل الضريبة" },
  currency: { en: "All amounts in Saudi riyals.", ar: "جميع المبالغ بالريال السعودي." },
  payment: { en: "Payment terms", ar: "شروط الدفع" },
  delivery: { en: "Delivery and installation", ar: "التوريد والتركيب" },
  scope: { en: "Scope", ar: "النطاق" },
  print: { en: "Print / Save as PDF", ar: "طباعة / حفظ PDF" },
  mismatch: { en: "The lines do not add up to the total. Do not send this; tell finance.", ar: "البنود لا تساوي الإجمالي. لا ترسل هذا العرض؛ أبلغ المالية." },
  notCurrent: { en: "This revision is not the client's current one.", ar: "هذه المراجعة ليست العرض الحالي للعميل." },
  missing: { en: "This quotation was not found, or you cannot open it.", ar: "لم يُعثر على هذا العرض، أو لا تملك صلاحية فتحه." },
  company: { en: "PHC", ar: "PHC" },
} satisfies Record<string, Bi>;

// Only the document prints; the app around it does not.
const PRINT_CSS = `
@page { size: A4; margin: 14mm; }
@media print {
  body * { visibility: hidden !important; }
  #quote-doc, #quote-doc * { visibility: visible !important; }
  #quote-doc { position: absolute; inset: 0 auto auto 0; width: 100%; box-shadow: none !important; border: 0 !important; }
}`;

function QuotationPrintPage() {
  const { revisionId } = Route.useParams();
  const { lang, dir } = useI18n();
  const rev = useQuery({ queryKey: ["pricing-quote-rev", revisionId], queryFn: () => getQuotationRevision(revisionId) });
  const lines = useQuery({ queryKey: ["pricing-quote-lines", revisionId], queryFn: () => listQuotationLines(revisionId) });
  const header = useQuery({
    queryKey: ["pricing-quote-header", rev.data?.quotation_id],
    queryFn: () => getQuotationHeader(rev.data!.quotation_id),
    enabled: !!rev.data,
  });
  const deal = useQuery({
    queryKey: ["pricing-quote-deal", header.data?.related_opportunity_id],
    queryFn: () => getQuoteDeal(header.data!.related_opportunity_id),
    enabled: !!header.data,
  });

  if (rev.isLoading || lines.isLoading || header.isLoading) return <SkeletonTable />;
  if (rev.error || lines.error) return <QueryFailure retry={() => { void rev.refetch(); void lines.refetch(); }} />;
  const r = rev.data;
  if (!r) return <Callout tone="warning">{pick(TEXT.missing, lang)}</Callout>;
  const ls = lines.data ?? [];
  const ok = linesMatch(ls, r.subtotal_excl_vat);
  const money = (n: number | null) =>
    n == null ? "—" : formatNumber(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qty = (n: number) => formatNumber(n, lang, { maximumFractionDigits: 3 });
  const issued = (r.issued_at ?? r.approved_at ?? "").slice(0, 10);
  const d = deal.data;

  return (
    <div className="mx-auto max-w-4xl space-y-4" dir={dir}>
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackButton />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{pick(QUOTE_STATUS_LABEL[r.status], lang)}</span>
          <Button onClick={() => window.print()} disabled={!ok}>
            <Printer className="me-2 h-4 w-4" />
            {pick(TEXT.print, lang)}
          </Button>
        </div>
      </div>
      {!ok ? <Callout tone="critical">{pick(TEXT.mismatch, lang)}</Callout> : null}
      {!r.is_current ? <Callout tone="warning">{pick(TEXT.notCurrent, lang)}</Callout> : null}

      <article id="quote-doc" className="rounded-lg border border-border bg-white p-8 text-[13px] text-black shadow-sm">
        <header className="flex items-start justify-between gap-6 border-b border-black/20 pb-4">
          <img src="/phc-logo.png" alt="PHC" className="h-14 w-auto" />
          <div className="text-end">
            <h1 className="text-2xl font-bold tracking-tight">{pick(TEXT.heading, lang)}</h1>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-0.5">
              <dt className="text-black/60">{pick(TEXT.number, lang)}</dt>
              <dd className="font-medium tabular-nums">{header.data?.quote_number ?? "—"} · {revisionLabel(r.revision_number)}</dd>
              <dt className="text-black/60">{pick(TEXT.date, lang)}</dt>
              <dd className="tabular-nums">{issued || "—"}</dd>
              <dt className="text-black/60">{pick(TEXT.valid, lang)}</dt>
              <dd className="tabular-nums">{r.valid_until ?? "—"}</dd>
            </dl>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-2 py-4 sm:grid-cols-2">
          <p><span className="text-black/60">{pick(TEXT.to, lang)}: </span><span className="font-medium">{d?.client ?? "—"}</span></p>
          <p><span className="text-black/60">{pick(TEXT.project, lang)}: </span><span className="font-medium">{d?.project_name ?? "—"}</span></p>
        </section>

        <Table className="text-[13px] text-black">
          <TableHeader>
            <TableRow className="border-y border-black/30 bg-black/[0.04] hover:bg-black/[0.04]">
              <TableHead className="text-black">{pick(TEXT.no, lang)}</TableHead>
              <TableHead className="text-black">{pick(TEXT.item, lang)}</TableHead>
              <TableHead className="text-end text-black">{pick(TEXT.qty, lang)}</TableHead>
              <TableHead className="text-black">{pick(TEXT.unit, lang)}</TableHead>
              <TableHead className="text-end text-black">{pick(TEXT.unitPrice, lang)}</TableHead>
              <TableHead className="text-end text-black">{pick(TEXT.total, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ls.map((l) => (
              <TableRow key={l.line_number} className="border-b border-black/10 align-top hover:bg-transparent">
                <TableCell className="tabular-nums">{l.line_number}</TableCell>
                <TableCell>{l.description}</TableCell>
                <TableCell className="text-end tabular-nums">{qty(l.quantity)}</TableCell>
                <TableCell>{l.unit ?? ""}</TableCell>
                <TableCell className="text-end tabular-nums">{money(unitPrice(l.line_total, l.quantity))}</TableCell>
                <TableCell className="text-end tabular-nums">{money(l.line_total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <dl className="ms-auto mt-4 grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>{pick(TEXT.subtotal, lang)}</dt>
          <dd className="text-end tabular-nums">{money(r.subtotal_excl_vat)}</dd>
          <dt>{pick(TEXT.vat, lang)} ({formatNumber(r.vat_rate * 100, lang, { maximumFractionDigits: 2 })}%)</dt>
          <dd className="text-end tabular-nums">{money(r.vat_amount)}</dd>
          <dt className="border-t border-black/30 pt-1 font-bold">{pick(TEXT.grand, lang)}</dt>
          <dd className="border-t border-black/30 pt-1 text-end font-bold tabular-nums">{money(r.total_incl_vat)}</dd>
        </dl>
        <p className="mt-1 text-end text-xs text-black/60">{pick(TEXT.currency, lang)}</p>

        <section className="mt-6 space-y-3">
          {r.payment_terms ? (
            <div><h2 className="font-semibold">{pick(TEXT.payment, lang)}</h2><p className="whitespace-pre-line">{r.payment_terms}</p></div>
          ) : null}
          {r.delivery_terms ? (
            <div><h2 className="font-semibold">{pick(TEXT.delivery, lang)}</h2><p className="whitespace-pre-line">{r.delivery_terms}</p></div>
          ) : null}
          {r.scope_summary ? (
            <div><h2 className="font-semibold">{pick(TEXT.scope, lang)}</h2><p className="whitespace-pre-line">{r.scope_summary}</p></div>
          ) : null}
        </section>

        <footer className="mt-10 border-t border-black/20 pt-3 text-center text-xs text-black/60">{pick(TEXT.company, lang)}</footer>
      </article>
    </div>
  );
}
