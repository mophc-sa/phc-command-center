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

import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Sparkles } from "lucide-react";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";
import { formatMessage, msg, type MessageRef } from "@/lib/messages";
import {
  isAiGenerated,
  PROVENANCE_LABEL,
  type BriefLine,
  type CommentaryState,
  type ManagementBrief,
} from "@/lib/sales-ai";

/** How many lines a card shows before the rest go behind the chevron. */
const VISIBLE_LINES = 2;

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

/**
 * The figures in a brief line, set apart from the sentence carrying them.
 *
 * Every line here is a sentence with a number inside it — "46 opportunities
 * with no recorded activity", "SAR 14,402,511". At one weight the number is
 * the thing a reader is scanning for and the hardest thing to find, so they
 * read the whole sentence to extract it. Bolding it turns each card into
 * something answerable at a glance, with the sentence there to explain it.
 *
 * Grouped digits are matched whole (14,402,511 stays one run, not three), and
 * the numeral set is the Western one this app formats in — see AR_LOCALE.
 */
// Split on a capturing group so the figures come back interleaved with the
// prose. The classification below deliberately does NOT reuse this regex with
// `.test()`: a /g regex carries `lastIndex` between calls, so testing each part
// with it would match every other figure and skip the rest.
const FIGURE_SPLIT = /(\d[\d,.]*)/g;
const IS_FIGURE = /^\d/;

function withFigures(text: string): ReactNode {
  return text.split(FIGURE_SPLIT).map((part, i) =>
    IS_FIGURE.test(part) ? (
      <strong key={i} className="num font-semibold text-foreground" data-tabular="true">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

function Section({ heading, lines, id }: { heading: string; lines: BriefLine[]; id: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  if (lines.length === 0) return null;

  // Two lines, then a chevron. The four sections carry wildly different
  // amounts — one line under "what changed", four under "focus" — so a panel
  // that shows everything is as tall as its longest section and the reader
  // scrolls past three short cards to reach it. A fixed opening height makes
  // the four comparable at a glance, and nothing is removed: the count is on
  // the button, so a reader knows what they have not been shown.
  const hidden = Math.max(0, lines.length - VISIBLE_LINES);
  const shown = open ? lines : lines.slice(0, VISIBLE_LINES);

  return (
    // A card per section. In the panel they were four columns of a grid with
    // no boundary between them, so at two-across the second column's heading
    // sat directly beneath the first column's last line and read as belonging
    // to it. A border is the cheapest way to say "this ends here".
    <div className="flex flex-col rounded-lg border border-border/60 bg-surface/70 p-3.5">
      <h3 className="section-label mb-2">{heading}</h3>
      <ul className="space-y-1.5" id={`brief-${id}`}>
        {shown.map((line, i) => {
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
              {/* `bdi` isolates this run from the surrounding direction.
                  Without it a deal name like "Wayfinding & Signage Works —
                  BLVD District — SAR 14,402,511" inside an Arabic paragraph is
                  reordered by the bidi algorithm: the trailing dash migrates to
                  the head and the line reads "— BLVD District  Wayfinding…".
                  The text was never wrong; the browser was being asked to guess
                  which direction it belonged to, and guessing is what bdi
                  stops. */}
              <bdi className={`block ${ai ? "text-muted-foreground" : "text-foreground"}`}>
                {withFigures(text)}
                {/* The exact provenance is not lost, only taken out of the
                    layout: it stays on the line for assistive technology. */}
                <span className="sr-only"> — {PROVENANCE_LABEL[line.provenance][lang]}</span>
              </bdi>
            </li>
          );
        })}
      </ul>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`brief-${id}`}
          className="mt-2 inline-flex items-center gap-1 self-start rounded text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
        >
          {/* The count is on the button, not just an arrow. "Show 2 more" tells
              a reader whether it is worth the click; a bare chevron asks them
              to press it to find out. */}
          {open
            ? t("brf_show_less" as never)
            : formatMessage(msg("brf_show_more", { count: hidden }), (k) => t(k as never), (v) =>
                formatNumber(Number(v), lang),
              )}
          <ChevronDown
            className={`h-3 w-3 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      ) : null}
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
        <Section id="changed" heading={t("brf_what_changed" as never)} lines={brief.whatChanged} />
        <Section id="attention" heading={t("brf_needs_attention" as never)} lines={brief.needsAttention} />
        <Section id="forecast" heading={t("brf_forecast_heading" as never)} lines={brief.forecast} />
        <Section id="focus" heading={t("brf_focus" as never)} lines={brief.focus} />
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
