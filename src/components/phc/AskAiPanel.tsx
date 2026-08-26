// =============================================================================
// Phase 5.1 §18 — Ask PHC AI.
//
// A drawer, not a page: the reader keeps their place, which is the whole point
// of being able to ask something mid-task.
//
// WHAT IT CAN AND CANNOT DO
//
// Every question is routed by classifyIntent() — regex, not a model — into
// either a bounded filter over rows the caller already holds, or a record
// search. The panel never fetches on the model's behalf and never receives a
// record the signed-in user could not already read, because it is handed rows
// rather than a client.
//
// Drafts are drafts. The panel can prepare a follow-up and it can propose a
// next action; committing either goes through the app's existing mechanism
// after the user presses a button. There is no second task system here, and
// nothing on this surface sends, approves, reprices, reassigns, or closes
// anything — AI_FORBIDDEN_ACTIONS is enforced upstream in filterRecommendations
// and the panel offers no control that would need it.
// =============================================================================

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, X, Send } from "lucide-react";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";
import { answerBounded, classifyIntent, type BoundedAnswer } from "@/lib/ask-ai";
import type { AttentionOpp } from "@/lib/attention";

export type AskContext = {
  /** Where the user is, so "this opportunity" has a referent. */
  route: string;
  opportunityId?: string | null;
  /** Rows the user can already see. Nothing else is ever consulted. */
  opportunities: AttentionOpp[];
  today: string;
};

const SUGGESTIONS: Array<{ en: string; ar: string }> = [
  { en: "What should I focus on today?", ar: "على ماذا أركّز اليوم؟" },
  { en: "Show opportunities at risk", ar: "أظهر الفرص المعرَّضة للخطر" },
  { en: "Which opportunities have no decision maker?", ar: "أي الفرص بلا صانع قرار؟" },
  { en: "Show opportunities above SAR 1M with no next action", ar: "أظهر الفرص فوق مليون ريال بلا إجراء تالٍ" },
];

const INTENT_LABEL: Record<string, { en: string; ar: string }> = {
  at_risk: { en: "At risk", ar: "معرَّضة للخطر" },
  stalled: { en: "Stalled", ar: "متوقفة" },
  closing_soon: { en: "Closing soon", ar: "إغلاق قريب" },
  no_next_action: { en: "No next action", ar: "بلا إجراء تالٍ" },
  no_decision_maker: { en: "No decision maker", ar: "بلا صانع قرار" },
  missing_probability: { en: "No probability", ar: "بلا احتمالية" },
  overdue_follow_ups: { en: "Overdue follow-ups", ar: "متابعات متأخرة" },
  above_value: { en: "Above value", ar: "فوق قيمة" },
  summarize_entity: { en: "Summary", ar: "ملخّص" },
};

export function AskAiPanel({
  open,
  onClose,
  context,
}: {
  open: boolean;
  onClose: () => void;
  context: AskContext;
}) {
  const { t, lang, dir } = useI18n();
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<string | null>(null);

  const result = useMemo((): { answer: BoundedAnswer | null; fellThrough: string | null } => {
    if (!asked) return { answer: null, fellThrough: null };
    const intent = classifyIntent(asked);
    if (intent.kind === "management" && intent.intent !== "summarize_entity") {
      return {
        answer: answerBounded(intent.intent, intent.params, context.opportunities, context.today),
        fellThrough: null,
      };
    }
    // Anything the closed set does not recognise becomes a record search rather
    // than a free-form model query. The safe default is the one that cannot
    // invent a filter.
    return { answer: null, fellThrough: asked };
  }, [asked, context.opportunities, context.today]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={t("ask_ai_title" as never)}>
      <button type="button" aria-label={t("cancel")} onClick={onClose} className="flex-1 bg-black/25 backdrop-blur-[1px]" />
      <aside
        className={`flex h-full w-full max-w-[min(30rem,100vw)] flex-col border-border bg-surface shadow-xl ${
          dir === "rtl" ? "border-e" : "border-s"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-amber-light" aria-hidden="true" />
            <h2 className="text-[14px] font-semibold text-foreground">{t("ask_ai_title" as never)}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!asked ? (
            <>
              <p className="mb-2 text-[11px] text-muted-foreground">{t("ask_ai_intro" as never)}</p>
              <ul className="space-y-1.5">
                {SUGGESTIONS.map((s) => (
                  <li key={s.en}>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery(s[lang]);
                        setAsked(s[lang]);
                      }}
                      className="w-full rounded-lg border border-border/70 bg-surface/60 px-3 py-2 text-start text-[12px] text-foreground transition-colors hover:border-border-strong"
                    >
                      {s[lang]}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : result.answer ? (
            <>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-foreground">
                  {INTENT_LABEL[result.answer.intent]?.[lang] ?? result.answer.intent}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatNumber(result.answer.matched, lang)}{" "}
                  {lang === "ar" ? "فرصة" : result.answer.matched === 1 ? "opportunity" : "opportunities"}
                </span>
              </div>

              {result.answer.rows.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-muted-foreground">
                  {lang === "ar" ? "لا نتائج مطابقة." : "Nothing matches."}
                </p>
              ) : (
                <ul className="divide-y divide-border/50">
                  {result.answer.rows.slice(0, 20).map((r) => (
                    <li key={r.opportunityId}>
                      <Link
                        to="/opportunities/$id"
                        params={{ id: r.opportunityId }}
                        onClick={onClose}
                        className="flex items-baseline justify-between gap-3 py-2 transition-colors hover:text-foreground"
                      >
                        <span className="truncate text-[12px] text-foreground">{r.label}</span>
                        <span className="num shrink-0 text-[11px] text-muted-foreground" data-tabular="true">
                          {r.value === null
                            ? lang === "ar" ? "بلا قيمة" : "No value"
                            : formatCurrency(r.value, lang)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {/* The retrieval is named, not narrated. A reader can see which of
                  the closed set of filters ran. */}
              <p className="mt-3 text-[10px] text-muted-foreground/70">{t("ask_ai_bounded_note" as never)}</p>
            </>
          ) : (
            <div className="py-6 text-center">
              <p className="text-[12px] text-muted-foreground">{t("ask_ai_not_understood" as never)}</p>
              <Link
                to="/opportunities"
                search={{ q: result.fellThrough ?? "" } as never}
                onClick={onClose}
                className="mt-2 inline-block text-[12px] text-amber-light hover:underline"
              >
                {t("ask_ai_search_instead" as never)}
              </Link>
            </div>
          )}
        </div>

        <form
          className="flex items-center gap-2 border-t border-border px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            setAsked(query.trim() || null);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("cmd_placeholder_ai" as never)}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            type="submit"
            aria-label={t("ask_ai_send" as never)}
            className="shrink-0 rounded-md border border-border p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Send className="h-3.5 w-3.5 rtl:-scale-x-100" />
          </button>
        </form>
      </aside>
    </div>
  );
}
