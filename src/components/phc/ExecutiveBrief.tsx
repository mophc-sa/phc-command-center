// =============================================================================
// Phase 5.1 §11 — the AI Executive Brief.
//
// Deterministic facts FIRST, AI commentary on top, never instead. The brief is
// built from counted records before any model is consulted, so the panel is
// complete and true with AI switched off, unreachable, or failing — which is
// the state it renders in today.
//
//   opportunities ──▶ buildManagementBrief() ──▶ facts ──┐
//                            (no model)                  ├──▶ rendered
//   ai-orchestrator ──▶ commentary ──▶ filterRecommendations() ──┘
//                       (optional)      (forbidden actions dropped)
//
// Every line shows where it came from. A reader can tell a counted fact from a
// model's opinion without hovering anything, which is the difference between a
// brief a manager acts on and one they learn to distrust.
// =============================================================================

import { AlertTriangle, Sparkles } from "lucide-react";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";
import type { MessageRef } from "@/lib/messages";
import {
  isAiGenerated,
  PROVENANCE_LABEL,
  type BriefLine,
  type CommentaryState,
  type ManagementBrief,
} from "@/lib/sales-ai";

function renderRef(ref: MessageRef, t: (k: string) => string, lang: "en" | "ar"): string {
  const MONEY_SLOTS = new Set(["value", "weighted", "open"]);
  const template = t(ref.key);
  if (!ref.params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, slot: string) => {
    const v = ref.params?.[slot];
    if (v === undefined) return whole;
    if (typeof v === "number") {
      return MONEY_SLOTS.has(slot) ? formatCurrency(v, lang) : formatNumber(v, lang);
    }
    return String(v);
  });
}

function Section({ heading, lines }: { heading: string; lines: BriefLine[] }) {
  const { t, lang } = useI18n();
  if (lines.length === 0) return null;
  return (
    <div>
      <h3 className="section-label mb-1.5">{heading}</h3>
      <ul className="space-y-1.5">
        {lines.map((line, i) => {
          const ai = isAiGenerated(line);
          const text = typeof line.text === "string" ? line.text : renderRef(line.text, (k) => t(k as never), lang);
          return (
            // A fixed gutter, so every sentence in the panel starts on the same
            // vertical line. The marker used to sit inline and its width varied
            // by word — FACT, CALCULATED, AI INFERENCE — so the text edge
            // stepped in and out on every row. That ragged edge was most of what
            // made this panel feel disorderly: nobody reads a badge, but
            // everybody feels a column that will not hold still.
            <li key={`${line.provenance}-${i}`} className="flex items-start gap-2 text-sm">
              <span
                className="mt-[0.5em] flex h-1.5 w-1.5 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                {/* Marked when a model wrote the line, blank when it is a
                    counted fact. The requirement — a reader can tell the two
                    apart at a glance — is met by marking the exception. It was
                    being met by labelling the rule as well: facts are the
                    overwhelming majority here, so the panel repeated its
                    loudest element on almost every row in order to say
                    "ordinary". */}
                {ai ? <span className="h-1.5 w-1.5 rounded-full bg-amber" /> : null}
              </span>
              <span className={ai ? "text-muted-foreground" : "text-foreground"}>
                {text}
                {/* The exact provenance is not lost, only taken out of the
                    layout: it stays on the line for assistive technology. */}
                <span className="sr-only"> — {PROVENANCE_LABEL[line.provenance][lang]}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ExecutiveBrief({
  brief,
  commentaryState = "ok",
}: {
  brief: ManagementBrief;
  /** True when commentary was attempted and did not arrive. The facts stand. */
  /** Three states, because "failed" and "returned nothing usable" differ. */
  commentaryState?: CommentaryState;
}) {
  const { t } = useI18n();
  const hasAi = [brief.whatChanged, brief.needsAttention, brief.forecast, brief.focus]
    .flat()
    .some(isAiGenerated);
  return (
    <section className="mb-6 rounded-xl border border-border/70 bg-surface/60 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-amber-light" aria-hidden="true" />
        <h2 className="text-base font-semibold text-foreground">{t("brf_title" as never)}</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Section heading={t("brf_what_changed" as never)} lines={brief.whatChanged} />
        <Section heading={t("brf_needs_attention" as never)} lines={brief.needsAttention} />
        <Section heading={t("brf_forecast_heading" as never)} lines={brief.forecast} />
        <Section heading={t("brf_focus" as never)} lines={brief.focus} />
      </div>

      {/* One key for the whole panel, where a badge on every line used to be.
          It is shown only when there is a marked line to explain — a legend
          for a mark nobody can see is just another thing to read. */}
      {hasAi ? (
        <p className="mt-4 flex items-center gap-2 border-t border-border/60 pt-3 text-2xs text-muted-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" aria-hidden="true" />
          {t("brf_ai_key" as never)}
        </p>
      ) : null}

      {/* Stated, not hidden. A brief that silently drops its commentary looks
          the same as one that had nothing to add. */}
      {commentaryState !== "ok" ? (
        <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted-foreground">
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          {t((commentaryState === "empty" ? "brf_ai_empty" : "brf_ai_unavailable") as never)}
        </p>
      ) : null}
    </section>
  );
}
