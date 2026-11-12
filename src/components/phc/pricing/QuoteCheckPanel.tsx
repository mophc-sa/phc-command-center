import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/phc/Callout";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import { checkQuote } from "@/lib/pricing-actions";
import { ISSUE_LABEL, linesToReturn, supplierMessage } from "@/lib/quote-check";
import { pick, type Bi } from "@/lib/pricing-text";

// PR 5: the supplier quote check on top of Cost review. Rules in SQL; this lists
// them and prepares the return. Nothing reaches the supplier until Zayed sends it.
const TEXT = {
  title: { en: "Quote check", ar: "فحص عرض المورد" },
  clean: { en: "Every line is priced as asked.", ar: "كل البنود مسعّرة كما طُلب." },
  some: { en: "lines need attention", ar: "بنود تحتاج مراجعة" },
  line: { en: "Line", ar: "البند" },
  qty: { en: "BOQ / quoted", ar: "المطلوب / المسعّر" },
  note: { en: "Supplier's note:", ar: "ملاحظة المورد:" },
  back: { en: "Return these lines to the supplier", ar: "أرجع هذه البنود للمورد" },
  hintBack: { en: "The lines and a message are filled in for you; check them before sending.", ar: "تُعبّأ البنود والرسالة تلقائياً؛ راجعها قبل الإرسال." },
  hintNoPortal: { en: "These prices were entered on the supplier's behalf: ask the supplier directly.", ar: "أُدخلت هذه الأسعار نيابةً عن المورد: تواصل معه مباشرة." },
  specHint: { en: "A written spec difference is your call: accept it, or return the line.", ar: "اختلاف المواصفة المكتوب قرارك: اقبله أو أرجع البند." },
} satisfies Record<string, Bi>;

export function QuoteCheckPanel({
  fileId, revisionId, onReturn, portalRequest,
}: {
  fileId: string;
  revisionId: string;
  /** Opens the return dialog with these lines ticked and this message; absent when the reader cannot return lines. */
  onReturn?: (preset: { lines: string[]; message: string }) => void;
  /** Whether the supplier answered through the portal (else the lines cannot reopen there). */
  portalRequest: boolean;
}) {
  const { lang } = useI18n();
  const check = useQuery({ queryKey: ["pricing-quote-check", fileId, revisionId], queryFn: () => checkQuote(fileId) });
  if (check.isLoading || check.isError || !check.data) return null;
  const rows = check.data;
  if (rows.length === 0) {
    return <Callout tone="success" compact title={pick(TEXT.title, lang)}>{pick(TEXT.clean, lang)}</Callout>;
  }
  const toReturn = linesToReturn(rows);
  const hasSpec = rows.some((r) => r.issues.includes("spec_differs"));
  const qty = (n: number | null) => (n == null ? "—" : formatNumber(n, lang, { maximumFractionDigits: 3 }));

  return (
    <Callout
      tone="attention"
      title={`${pick(TEXT.title, lang)}: ${rows.length} ${pick(TEXT.some, lang)}`}
      action={
        onReturn && portalRequest && toReturn.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => onReturn({ lines: toReturn, message: supplierMessage(rows) })}>
            {pick(TEXT.back, lang)}
          </Button>
        ) : undefined
      }
    >
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.boq_line_id} className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium">{pick(TEXT.line, lang)} {r.line_number ?? "—"} · {r.sign_type}</span>
            {r.issues.map((i) => (
              <StatusPill key={i} tone={i === "spec_differs" ? "neutral" : i === "no_price" ? "danger" : "attention"}>
                {pick(ISSUE_LABEL[i], lang)}
              </StatusPill>
            ))}
            {r.issues.includes("quantity_differs") ? (
              <span className="tabular-nums text-muted-foreground">{pick(TEXT.qty, lang)}: {qty(r.boq_quantity)} / {qty(r.quoted_quantity)}</span>
            ) : null}
            {r.spec_note ? <span className="text-muted-foreground">{pick(TEXT.note, lang)} {r.spec_note}</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {onReturn && toReturn.length > 0 ? pick(portalRequest ? TEXT.hintBack : TEXT.hintNoPortal, lang) : null}
        {hasSpec ? ` ${pick(TEXT.specHint, lang)}` : null}
      </p>
    </Callout>
  );
}
