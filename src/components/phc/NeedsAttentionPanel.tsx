// =============================================================================
// Phase 5.1 §6/§7/§9 — Needs Attention, one row per opportunity.
//
// The panel this replaces rendered one row per ISSUE, so a deal with two
// overdue follow-ups appeared twice and four real problems read as eight. It
// also ranked on due date alone, which put an SAR 100K follow-up ten days late
// above an SAR 8M one two days late.
//
// Every band here is deterministic and every row opens to show the rules that
// produced it — a priority nobody can take apart is a black box wearing a
// number.
// =============================================================================

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { StatusPill } from "@/components/phc/StatusPill";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";
import { formatMessage } from "@/lib/messages";
import { canonicalStageLabelKey } from "@/lib/stage-canonical";
import type { AttentionItem, AttentionPriority, ReasonKind } from "@/lib/attention";

const TONE: Record<AttentionPriority, "danger" | "attention" | "neutral" | "muted"> = {
  critical: "danger",
  high: "attention",
  normal: "neutral",
  low: "muted",
};

const PRIORITY_LABEL: Record<AttentionPriority, { en: string; ar: string }> = {
  critical: { en: "Critical", ar: "حرِج" },
  high: { en: "High", ar: "عالٍ" },
  normal: { en: "Normal", ar: "عادي" },
  low: { en: "Low", ar: "منخفض" },
};

const REASON_LABEL: Record<ReasonKind, { en: string; ar: string }> = {
  follow_up_overdue: { en: "Follow-up overdue", ar: "متابعة متأخرة" },
  no_engagement_history: { en: "No engagement history", ar: "لا سجل تواصل" },
  no_next_action: { en: "No next action", ar: "لا إجراء تالٍ" },
  no_next_action_date: { en: "Next action has no date", ar: "الإجراء التالي بلا تاريخ" },
  next_action_overdue: { en: "Next action overdue", ar: "الإجراء التالي متأخر" },
  stalled: { en: "Stalled in stage", ar: "متوقف في المرحلة" },
  inactive: { en: "No client contact", ar: "لا تواصل مع العميل" },
  expected_close_overdue: { en: "Expected close passed", ar: "تجاوز تاريخ الإغلاق" },
  closing_soon: { en: "Closing soon", ar: "إغلاق قريب" },
  high_value_low_probability: { en: "High value, low probability", ar: "قيمة عالية واحتمالية منخفضة" },
  unscored: { en: "No probability", ar: "بلا احتمالية" },
  no_decision_maker: { en: "No decision maker", ar: "بلا صانع قرار" },
};

export function NeedsAttentionPanel({ items }: { items: AttentionItem[] }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="divide-y divide-border/50">
      {items.map((item) => {
        const expanded = open === item.opportunityId;
        return (
          <div key={item.opportunityId}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : item.opportunityId)}
                aria-expanded={expanded}
                aria-controls={`why-${item.opportunityId}`}
                className="flex min-w-0 flex-1 items-start gap-1.5 text-start"
              >
                <ChevronRight
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform rtl:-scale-x-100 ${expanded ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-foreground">{item.label}</span>
                  {/* The primary issue, plus how many others are hiding behind
                      it. The count is the whole point of aggregating. */}
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {REASON_LABEL[item.primaryReason.kind][lang]}
                    {item.issueCount > 1
                      ? lang === "ar"
                        ? ` · و${item.issueCount - 1} أخرى`
                        : ` · +${item.issueCount - 1} more`
                      : ""}
                  </span>
                </span>
              </button>

              <StatusPill tone={TONE[item.priority]}>{PRIORITY_LABEL[item.priority][lang]}</StatusPill>

              {item.stage ? (
                <span className="text-[11px] text-muted-foreground">{t(canonicalStageLabelKey(item.stage))}</span>
              ) : null}

              <span className="num text-[12px] font-medium text-foreground" data-tabular="true">
                {item.value === null
                  ? lang === "ar"
                    ? "بلا قيمة"
                    : "No value"
                  : formatCurrency(item.value, lang)}
              </span>

              <Link
                to="/opportunities/$id"
                params={{ id: item.opportunityId }}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                {t("action_review")}
              </Link>
            </div>

            {expanded ? (
              <div id={`why-${item.opportunityId}`} className="bg-surface-2/40 px-3 py-3">
                {/* §9 — which rules fired, what each was worth, and the dates
                    and records behind them. The band is reproducible on paper. */}
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>
                    {lang === "ar" ? "الدرجة" : "Score"}: <span className="text-foreground">{item.score}</span>
                  </span>
                  {item.aging.daysInStage !== null ? (
                    <span>
                      {lang === "ar" ? "في المرحلة" : "In stage"}:{" "}
                      <span className="text-foreground">{item.aging.daysInStage}d</span>
                      {item.aging.baseline?.days != null ? (
                        <> · {lang === "ar" ? "المرجع" : "baseline"} {item.aging.baseline.days}d</>
                      ) : (
                        <> · {lang === "ar" ? "لا مرجع متاح" : "baseline not available"}</>
                      )}
                    </span>
                  ) : null}
                  {item.lastClientActivity ? (
                    <span>
                      {lang === "ar" ? "آخر تواصل" : "Last contact"}:{" "}
                      <span className="text-foreground">{item.lastClientActivity.slice(0, 10)}</span>
                    </span>
                  ) : null}
                </div>

                <ul className="space-y-1">
                  {item.reasons.map((r) => (
                    <li key={r.kind} className="flex items-start gap-1.5 text-[11px]">
                      <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0 text-amber-light" aria-hidden="true" />
                      <span className="text-foreground">{REASON_LABEL[r.kind][lang]}</span>
                      <span className="text-muted-foreground">
                        —{" "}
                        {formatMessage(r.detail, (k) => t(k as never), (v) =>
                          typeof v === "number" ? formatNumber(v, lang) : t(`src_${v}` as never) || String(v),
                        )}
                      </span>
                      <span className="ms-auto shrink-0 text-muted-foreground/70">+{r.points}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
