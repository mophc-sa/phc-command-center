// =============================================================================
// Phase 5.1 §13 — CRM health as a management surface.
//
// pipelineHealth() and the attention engine have computed all of this for
// months; nothing rendered it. These are counts of records, each one openable,
// and none of them is a judgement about a deal.
//
// NO SCORE. "CRM health: 61%" needs a weighting nobody has agreed — is a
// missing decision maker worth half a missing value? — and an invented
// weighting is the same defect as an invented SLA wearing a percentage sign.
// Counts against a denominator are enough to act on and cannot mislead.
// =============================================================================

import { Link } from "@tanstack/react-router";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";
import type { DataQualityReport, ReasonKind } from "@/lib/attention";

const ISSUE_LABEL: Partial<Record<ReasonKind, { en: string; ar: string }>> = {
  missing_value: { en: "No value recorded", ar: "بلا قيمة مسجَّلة" },
  unscored: { en: "No win probability", ar: "بلا احتمالية فوز" },
  no_decision_maker: { en: "No decision maker", ar: "بلا صانع قرار" },
  no_engagement_history: { en: "No engagement history", ar: "بلا سجل تواصل" },
  missing_owner: { en: "No owner assigned", ar: "بلا مالك مُسنَد" },
  missing_company: { en: "No client recorded", ar: "بلا عميل مسجَّل" },
};

export function DataQualityPanel({ report }: { report: DataQualityReport }) {
  const { t, lang } = useI18n();

  if (report.issues.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
        {lang === "ar" ? "لا ثغرات بيانات في الفرص النشطة." : "No data gaps on active opportunities."}
      </p>
    );
  }

  // A finding that affects essentially the whole book is not a to-do list, it
  // is one fact about the dataset. Rendered as six equal rows it reads as six
  // separate crises; rendered as a banner it reads as what it is — a migration
  // gap somebody should know about once.
  //
  // The fact is unchanged: the count is still exact, still reconciles to
  // records, still opens them. Only its shape on the page differs. Nothing is
  // hidden, nothing is recategorised, and it is still not At Risk.
  const WHOLE_BOOK = 0.9;
  const isWholeBook = (count: number) =>
    report.totalConsidered > 0 && count / report.totalConsidered >= WHOLE_BOOK;

  const banners = report.issues.filter((i) => isWholeBook(i.count));
  const rows = report.issues.filter((i) => !isWholeBook(i.count));

  return (
    <div>
      <div className="border-b border-border/50 px-4 py-2.5">
        <p className="text-[12px] text-foreground">
          {/* A count with no denominator cannot be judged: 18 is alarming out of
              20 and unremarkable out of 900. */}
          {lang === "ar"
            ? `${formatNumber(report.affectedOpportunities, lang)} من ${formatNumber(report.totalConsidered, lang)} فرصة نشطة بها ثغرة واحدة على الأقل`
            : `${formatNumber(report.affectedOpportunities, lang)} of ${formatNumber(report.totalConsidered, lang)} active opportunities have at least one gap`}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{t("dq_not_risk" as never)}</p>
      </div>

      {banners.map((issue) => (
        <div key={issue.kind} className="border-b border-border/50 bg-surface-2/30 px-4 py-2.5">
          <Link
            to="/opportunities"
            search={{ stage: "open", missing: issue.kind } as never}
            className="group flex items-baseline justify-between gap-3"
          >
            <span className="text-[12px] text-foreground group-hover:underline">
              {lang === "ar"
                ? `${ISSUE_LABEL[issue.kind]?.ar ?? issue.kind} — لكل الفرص النشطة تقريبًا (${formatNumber(issue.count, lang)})`
                : `${ISSUE_LABEL[issue.kind]?.en ?? issue.kind} — across essentially the whole book (${formatNumber(issue.count, lang)})`}
            </span>
          </Link>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {lang === "ar"
              ? "غياب على مستوى الدفتر كله، لا مهمة لكل صفقة."
              : "A gap across the dataset, not a task per deal."}
          </p>
        </div>
      ))}

      <ul className="divide-y divide-border/50">
        {rows.map((issue) => (
          <li key={issue.kind}>
            {/* Every count opens its records. A number nobody can take apart is
                a number nobody acts on. */}
            <Link
              to="/opportunities"
              search={{ stage: "open", missing: issue.kind } as never}
              className="flex items-baseline justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/40"
            >
              <span className="text-[12px] text-foreground">
                {ISSUE_LABEL[issue.kind]?.[lang] ?? issue.kind}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                {issue.value > 0 ? (
                  <span className="text-[10px] text-muted-foreground">{formatCurrency(issue.value, lang)}</span>
                ) : null}
                <span className="num text-[13px] font-semibold text-foreground" data-tabular="true">
                  {formatNumber(issue.count, lang)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
