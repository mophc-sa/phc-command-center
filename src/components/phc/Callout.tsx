// =============================================================================
// One vocabulary for "this box means something".
//
// Counted across the app before this existed: 126 hand-rolled alert boxes in
// 42 files, each inventing its own opacity — border-amber/40 bg-amber/10 in
// 57 places, /30 with the same background in 10 more, four different
// destructive mixes, three won mixes. Nothing was wrong with any single one;
// together they meant a reader could not learn what a colour was FOR, because
// the same meaning arrived at four different strengths.
//
// Five tones, and each answers a different question:
//
//   info      — here is context you did not ask for. Nothing is wrong.
//   success   — something completed. Nothing is required.
//   attention — a fact worth acting on, at your pace. Most sales signals.
//   warning   — this will go wrong if left. A deadline, a missing input.
//   critical  — this IS wrong now, or the number on screen cannot be trusted.
//
// The line between attention and critical is the one that matters here: this
// system spent a week learning that a number which looks right and is not is
// worse than a number that admits it cannot be computed. `critical` is for
// the second kind — a truncated total, a broken read — not for a deal that
// needs a phone call.
// =============================================================================

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutTone = "info" | "success" | "attention" | "warning" | "critical";

/**
 * Border, background and text for each tone.
 *
 * One opacity per role, used everywhere, so the strength of a box is never
 * accidental: a reader can tell attention from critical without reading the
 * words.
 */
const TONES: Record<CalloutTone, { box: string; icon: string }> = {
  info: {
    box: "border-info/30 bg-info/[0.07] text-foreground",
    icon: "text-info",
  },
  success: {
    box: "border-won/30 bg-won/[0.07] text-foreground",
    icon: "text-won",
  },
  attention: {
    box: "border-amber/35 bg-amber/[0.08] text-foreground",
    icon: "text-amber-light",
  },
  warning: {
    box: "border-amber/60 bg-amber/[0.14] text-foreground",
    icon: "text-amber-light",
  },
  critical: {
    box: "border-destructive/45 bg-destructive/[0.10] text-foreground",
    icon: "text-destructive",
  },
};

const ICONS: Record<CalloutTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  attention: AlertTriangle,
  warning: TriangleAlert,
  critical: OctagonAlert,
};

/**
 * A box that means something.
 *
 * `title` is optional: most callouts in this app are a single sentence, and a
 * heading above one sentence is noise. Pass one only when the body needs more
 * than a line.
 */
export function Callout({
  tone = "info",
  title,
  children,
  action,
  className,
  compact = false,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children: ReactNode;
  /** A link or button, right-aligned on wide screens. */
  action?: ReactNode;
  className?: string;
  /** Tighter padding for a box that sits inside a card rather than above one. */
  compact?: boolean;
}) {
  const Icon = ICONS[tone];
  const t = TONES[tone];
  return (
    <div
      // role="status" and not "alert": an alert interrupts a screen reader
      // mid-sentence, which is right for a live failure and wrong for the
      // standing facts these boxes usually carry.
      role="status"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border",
        compact ? "px-3 py-2" : "px-4 py-3",
        t.box,
        className,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="mb-0.5 font-medium">{title}</p> : null}
        <div className="text-sm leading-snug">{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * A section wrapper whose edge carries the same vocabulary.
 *
 * The complaint this answers is "everything looks the same": a page of
 * identical cards gives a reader no way to tell the thing that needs them
 * from the thing that is merely true. A tone here tints only the border, so a
 * section can be marked without shouting.
 */
export function ToneCard({
  tone,
  children,
  className,
}: {
  /** Omit for an ordinary card — most cards should stay ordinary. */
  tone?: CalloutTone;
  children: ReactNode;
  className?: string;
}) {
  const edge = tone
    ? {
        info: "border-info/30",
        success: "border-won/30",
        attention: "border-amber/35",
        warning: "border-amber/60",
        critical: "border-destructive/45",
      }[tone]
    : "border-border/70";
  return (
    <div className={cn("rounded-xl border bg-surface/60", edge, className)}>{children}</div>
  );
}
