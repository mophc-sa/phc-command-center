// =============================================================================
// The wall board. One screen, in an office, running unattended for weeks.
//
// WHY IT LIVES UNDER _authenticated
// A board outside the auth boundary would need a session-less read path, and
// RLS answers an unauthenticated reader with nothing. Putting it here reuses
// the existing gate unchanged -- including the mandatory-MFA step-up -- rather
// than carving a hole beside it. `AppShell` renders this route bare (no nav, no
// command palette, no notifications) because there is no one at the screen to
// click any of it.
//
// WHICH ACCOUNT SHOULD DRIVE IT
// Not a manager's. `sales_manager` is in MFA_REQUIRED_ROLES and in scope for
// `useIdleLogout` -- and a wall display is idle by definition, so it would sign
// itself out every thirty minutes and demand a TOTP code from whoever walks
// over. Worse, a live privileged session on an unattended screen lets any
// passer-by *act*, not merely look. Use a non-sensitive account; the idle timer
// then never arms and MFA never applies.
//
// WHAT IS STILL OWED
// This renders aggregates, but it reaches them through a full session, so the
// account's own read scope is the real boundary -- not this page. The hardened
// shape (a revocable per-device token and an endpoint that returns only the
// aggregate payload, no rows) is recorded in docs/AI_HANDOFF.md and is not
// built yet. Until it is, treat the screen as trusted-room-only.
//
// EVERYTHING ON ONE PAGE
// An earlier draft rotated three screens, on the reasoning that a reader takes
// in four to six figures at three to five metres. The brief is one page, so
// this is one page -- and the way to make that legible is hierarchy, not
// shrinking every figure until none of them reads.
//
// Three bands, deliberately unequal:
//   · The money, at 3.4vw. Read from across the room, in one glance.
//   · What is waiting on a decision, at 2.2vw. Read from a few steps away.
//   · Composition and the team, at ~1vw. Read when someone walks up.
//
// Nothing is hidden and nothing is hover-only, because a wall has no cursor.
// The header stays pinned: the clock, the last-update time and the connection
// state must be visible in every frame, since the moment they are not is the
// moment a stale number starts passing for a live one.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, formatNumber, localeFor } from "@/lib/i18n";
import { requiresConversionReview } from "@/lib/dashboard-helpers";
import {
  computePulse,
  computeStanding,
  computeTeam,
  displayLabel,
  freshnessOf,
  compactValue,
  OPEN_WINDOW_MONTHS,
  wonTrend,
  yearProgress,
  type BoardOpp,
  type Freshness,
} from "@/lib/board-metrics";

export const Route = createFileRoute("/_authenticated/board")({
  ssr: false,
  component: BoardPage,
});

/** Values move in minutes, not seconds. A tighter poll would only add load. */
const POLL_MS = 60_000;

const STAGE_LABEL: Record<string, [string, string]> = {
  rfq_received: ["استُلم الطلب", "RFQ received"],
  jih: ["فرصة قائمة", "Job in hand"],
  jih_bafo: ["BAFO", "BAFO"],
  under_negotiation: ["تفاوض", "Negotiation"],
  verbally_awarded: ["ترسية شفهية", "Verbal award"],
  contract_received: ["استُلم العقد", "Contract in"],
  contract_signed: ["عقد موقّع", "Signed"],
};

/**
 * A PostgREST result is `{ data, error }`, and on a select error `data` is
 * null. Every read here degrades to an empty list rather than throwing: one
 * failed table must not blank a board that six other tables could still fill.
 * The header's freshness indicator is what tells the reader something is off.
 */
function rows<T>(res: { data: unknown } | undefined): T[] {
  const d = res?.data;
  return Array.isArray(d) ? (d as T[]) : [];
}

/**
 * "1 deals" is the kind of thing a wall shows for weeks before anyone mentions
 * it. English needs the singular; Arabic does not pluralise after one, and
 * uses the dual for two -- so neither is a matter of appending an "s".
 */
function dealsLabel(n: number, lang: "ar" | "en"): string {
  if (lang === "en") return `${n} ${n === 1 ? "deal" : "deals"}`;
  if (n === 1) return "صفقة واحدة";
  if (n === 2) return "صفقتان";
  return `${formatNumber(n, lang)} صفقة`;
}

function useNow(tickMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}

function useBoardData() {
  return useQuery({
    queryKey: ["board"],
    refetchInterval: POLL_MS,
    // React Query pauses interval refetching when the tab loses focus. On a
    // desk that is a kindness; on a wall it is a defect -- a screensaver, a
    // second tab, or the OS backgrounding the kiosk would freeze the numbers
    // while the page still looked live. The freshness indicator would catch it
    // eventually, but the right answer is not to stop polling in the first
    // place. A wall display has no user to come back and wake it.
    refetchIntervalInBackground: true,
    // The screen has no focus events -- nobody alt-tabs a wall.
    refetchOnWindowFocus: false,
    staleTime: POLL_MS / 2,
    queryFn: async () => {
      const [opps, approvals, followUps, quotations, tenders, inbox, targets, profiles] =
        await Promise.all([
          supabase
            .from("opportunities")
            .select(
              "id, owner_id, stage, sales_stage, contract_value, quotation_value, estimated_value_max, won_at, created_at",
            ),
          supabase.from("approvals").select("created_at").eq("status", "pending"),
          supabase.from("follow_ups").select("due_date").eq("status", "scheduled"),
          // `valid_until` is the quotation's own deadline. There is no
          // "due_date" column -- the typechecker caught that guess.
          supabase.from("quotations").select("valid_until, status"),
          supabase.from("tenders").select("tender_stage, created_at"),
          supabase.from("leads").select("id").eq("lead_stage", "detected"),
          supabase.from("sales_targets").select("user_id, sales_target, period_type, period_start"),
          supabase.from("profiles").select("id, full_name"),
        ]);
      return { opps, approvals, followUps, quotations, tenders, inbox, targets, profiles };
    },
  });
}

function Dot({ f, lang }: { f: Freshness; lang: "ar" | "en" }) {
  const map: Record<Freshness, [string, string, string]> = {
    live: ["bg-won", "متصل", "Live"],
    slow: ["bg-amber", "بطيء", "Slow"],
    stale: ["bg-destructive", "منقطع", "Stale"],
  };
  const [dot, ar, en] = map[f];
  return (
    <span className="flex items-center gap-[0.5vw]">
      <span className={`h-[0.7vh] w-[0.7vh] rounded-full ${dot}`} aria-hidden="true" />
      <span>{lang === "ar" ? ar : en}</span>
    </span>
  );
}

/**
 * Card colour is a vocabulary, not decoration -- the same rule the dashboard
 * follows: money is amber, banked outcome is green, exposure is red, counts
 * stay neutral. A reader who learns it once reads the wall faster every day
 * after; a palette chosen for looks teaches nothing and has to be re-read.
 *
 * Three parts per tone, and each has a job:
 *   `wash`  an 8% tint -- enough to group at five metres, too little to fight
 *           the paper background the identity is built on.
 *   `edge`  a saturated 4px bar at the inline start. This is what actually
 *           carries the category at distance; the wash alone reads as noise.
 *   `text`  the on-tint token, NOT the fill. --won and --destructive measure
 *           3.40 and 3.91 against their own 8% tint and fail 4.5:1 as label
 *           text. That was measured, not assumed, earlier in this codebase.
 */
const TONE: Record<string, { wash: string; edge: string; text: string }> = {
  ink: { wash: "transparent", edge: "var(--rule, var(--border))", text: "text-foreground" },
  money: { wash: "color-mix(in srgb, var(--amber) 8%, var(--card))", edge: "var(--amber)", text: "text-amber-deep" },
  won: { wash: "color-mix(in srgb, var(--won) 8%, var(--card))", edge: "var(--won)", text: "text-won-on-tint" },
  amber: { wash: "color-mix(in srgb, var(--amber) 8%, var(--card))", edge: "var(--amber)", text: "text-amber-deep" },
  danger: { wash: "color-mix(in srgb, var(--destructive) 8%, var(--card))", edge: "var(--destructive)", text: "text-destructive-on-tint" },
  info: { wash: "color-mix(in srgb, var(--info) 8%, var(--card))", edge: "var(--info)", text: "text-info" },
};

/** A headline figure. Big enough to read from across the room. */
function Hero({
  value,
  ar,
  en,
  tone = "ink",
  sub,
}: {
  value: string | null;
  ar: string;
  en: string;
  tone?: keyof typeof TONE;
  sub?: string;
}) {
  return (
    <div
      className="relative flex flex-col justify-center overflow-hidden rounded-[0.7vw] border border-border px-[1.4vw] py-[1.4vh]"
      style={{ background: TONE[tone].wash }}
    >
      {/* The edge, at the reading start. Colour that survives five metres. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 start-0"
        style={{ width: "0.22vw", background: TONE[tone].edge }}
      />
      <div
        className={`num font-bold leading-none tracking-[-0.02em] ${TONE[tone].text}`}
        style={{ fontSize: "3.9vw" }}
        data-tabular="true"
      >
        {value ?? "—"}
      </div>
      <div className="mt-[0.9vh] font-semibold text-foreground" style={{ fontSize: "1.02vw" }}>
        {ar}
      </div>
      <div className="text-muted-foreground" style={{ fontSize: "0.78vw", direction: "ltr" }}>
        {en}
      </div>
      {sub ? (
        <div className="mt-[0.4vh] text-muted-foreground" style={{ fontSize: "0.72vw" }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/** A secondary figure: what is waiting on someone. */
function Tile({
  value,
  ar,
  en,
  tone = "ink",
  sub,
}: {
  value: string | null;
  ar: string;
  en: string;
  tone?: keyof typeof TONE;
  sub?: string;
}) {
  return (
    <div
      className="relative flex flex-col justify-center overflow-hidden rounded-[0.6vw] border border-border px-[1.1vw] py-[1vh]"
      style={{ background: TONE[tone].wash }}
    >
      {/* The edge, at the reading start. Colour that survives five metres. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 start-0"
        style={{ width: "0.22vw", background: TONE[tone].edge }}
      />
      <div
        className={`num font-bold leading-none tracking-[-0.02em] ${TONE[tone].text}`}
        style={{ fontSize: "2.6vw" }}
        data-tabular="true"
      >
        {value ?? "—"}
      </div>
      <div className="mt-[0.6vh] font-semibold text-foreground" style={{ fontSize: "0.86vw" }}>
        {ar}
      </div>
      <div className="text-muted-foreground" style={{ fontSize: "0.68vw", direction: "ltr" }}>
        {en}
      </div>
      {sub ? (
        <div className="text-muted-foreground" style={{ fontSize: "0.66vw" }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Six months of won value, oldest first.
 *
 * Bars, not a line: six points is too few for a line to describe a shape, and
 * a bar makes an empty month unmistakably empty rather than a dip in a curve.
 * Every bar is drawn even at zero height, so a blank month is visibly a month
 * with nothing in it -- not a month that was left out.
 *
 * Heights are a share of the tallest bar, so the chart is about SHAPE. The
 * figures under it carry the magnitude; a wall chart that tried to encode both
 * would do neither well.
 */
function Trend({
  points,
  lang,
}: {
  points: ReturnType<typeof wonTrend>;
  lang: "ar" | "en";
}) {
  const peak = Math.max(...points.map((p) => p.value), 0);
  const MONTH_AR = ["", "ينا", "فبر", "مار", "أبر", "ماي", "يون", "يول", "أغس", "سبت", "أكت", "نوف", "ديس"];
  const MONTH_EN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return (
    <div className="flex h-full flex-col">
      <div className="mb-[0.6vh] flex items-baseline gap-[0.7vw]">
        <span className="font-semibold text-foreground" style={{ fontSize: "0.92vw" }}>
          {lang === "ar" ? "المُرسّى — ستّة أشهر" : "Won — six months"}
        </span>
        <span className="text-muted-foreground" style={{ fontSize: "0.72vw", direction: "ltr" }}>
          {lang === "ar" ? "Won — six months" : "المُرسّى — ستّة أشهر"}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-end gap-[0.6vw]">
        {points.map((p, i) => {
          const h = peak > 0 ? (p.value / peak) * 100 : 0;
          const last = i === points.length - 1;
          return (
            <div key={p.key} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-[0.4vh]">
              <span className="num text-center text-muted-foreground" style={{ fontSize: "0.72vw" }}>
                {p.value > 0 ? compactValue(p.value, lang) : "—"}
              </span>
              <div
                className="w-full rounded-t-[0.2vw]"
                style={{
                  // A floor of 2% so a zero month still shows its baseline.
                  height: `${Math.max(h, p.value > 0 ? 4 : 2)}%`,
                  // The current month is the one being decided; the past is
                  // context, and drawing them alike invites misreading a
                  // part-month as a finished one.
                  background: last ? "var(--amber)" : "var(--won)",
                  opacity: last ? 1 : 0.55,
                }}
              />
              <span className="text-center text-muted-foreground" style={{ fontSize: "0.66vw" }}>
                {(lang === "ar" ? MONTH_AR : MONTH_EN)[p.month]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Year-to-date against the annual target, with a pace marker.
 *
 * The marker is the point of the whole thing. 40% of target reads as ahead in
 * January and behind in November, and a bare progress bar cannot tell them
 * apart -- so it invites the wrong conclusion on a screen nobody can question.
 */
function YearBar({
  p,
  lang,
}: {
  p: ReturnType<typeof yearProgress>;
  lang: "ar" | "en";
}) {
  const pct = p.ratio === null ? 0 : Math.min(p.ratio, 1) * 100;
  const pace = Math.min(Math.max(p.yearElapsed, 0), 1) * 100;
  const ahead = p.ratio !== null && p.ratio >= p.yearElapsed;
  return (
    <div className="flex flex-col gap-[1vh]">
      <div className="flex items-baseline justify-between gap-[1vw]">
        <div className="flex items-baseline gap-[0.8vw]">
          <span className="font-semibold text-foreground" style={{ fontSize: "1.05vw" }}>
            {lang === "ar" ? "الهدف السنوي" : "Annual target"}
          </span>
          <span className="text-muted-foreground" style={{ fontSize: "0.8vw", direction: "ltr" }}>
            {lang === "ar" ? "Annual target" : "الهدف السنوي"}
          </span>
        </div>
        {/* Two figures of the same weight, side by side, read as one number:
            "32% 7.9M" at a glance is 327.9. They need a real gap and a rule
            between them, not a wider letter-space -- and the slash needs air
            on both sides or it welds the pair into a single run. */}
        <div className="flex items-baseline gap-[1.6vw]">
          <span
            className={`num font-bold leading-none tracking-[-0.02em] ${ahead ? "text-won-on-tint" : "text-amber-deep"}`}
            style={{ fontSize: "2.4vw" }}
            data-tabular="true"
          >
            {p.ratio === null ? "—" : `${formatNumber(Math.round(p.ratio * 100), lang)}%`}
          </span>

          <span
            aria-hidden="true"
            className="self-stretch"
            style={{ width: "1px", background: "var(--border)" }}
          />

          {/* The achieved figure carries real weight -- a reader who wants
              riyals should not have to squint. The target stays a step
              lighter: it is the denominator, and matching them would make the
              pair read as two facts of equal standing rather than one measured
              against the other. */}
          <span className="flex items-baseline gap-[0.5vw]" data-tabular="true">
            <span
              className="num font-bold leading-none tracking-[-0.02em] text-foreground"
              style={{ fontSize: "2.1vw" }}
            >
              {compactValue(p.won, lang)}
            </span>
            {p.target ? (
              <>
                <span
                  className="num leading-none text-muted-foreground"
                  style={{ fontSize: "1.5vw", opacity: 0.6 }}
                >
                  /
                </span>
                <span
                  className="num font-semibold leading-none text-muted-foreground"
                  style={{ fontSize: "1.5vw" }}
                >
                  {compactValue(p.target, lang)}
                </span>
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div className="relative h-[2.6vh] w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 start-0 rounded-full"
          style={{ width: `${pct}%`, background: ahead ? "var(--won)" : "var(--amber)" }}
        />
        {/* Pace: where the year says you should be by today. Without it, the
            same 40% reads as ahead in January and behind in November, and a
            bare bar cannot tell them apart. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0"
          style={{
            insetInlineStart: `calc(${pace}% - 0.08vw)`,
            width: "0.16vw",
            background: "var(--foreground)",
            opacity: 0.6,
          }}
        />
      </div>

      <div className="flex justify-between text-muted-foreground" style={{ fontSize: "0.72vw" }}>
        <span>
          {p.ratio === null
            ? lang === "ar"
              ? "لم يُضبط هدف سنوي"
              : "no annual target set"
            : ahead
              ? lang === "ar"
                ? "أمام إيقاع السنة"
                : "ahead of pace"
              : lang === "ar"
                ? "خلف إيقاع السنة"
                : "behind pace"}
        </span>
        <span>
          {lang === "ar" ? "الخطّ = موضع الإيقاع اليوم" : "the line marks today's pace"}
        </span>
      </div>
    </div>
  );
}

/**
 * The pipeline as a ladder, one rung per stage, in pipeline order.
 *
 * REPLACES a stacked bar with a separate legend, which failed a wall twice
 * over. A stacked bar squeezes the late stages into slivers a metre-away
 * reader cannot see, let alone one across the room -- and with the legend set
 * apart, reading it means matching seven colours across empty space, which is
 * exactly the task distance makes hardest. The two also disagreed: the bar was
 * drawn by value while the legend counted deals.
 *
 * A ladder fixes all three. Every stage gets its own row at a readable size,
 * the name sits beside its own colour so nothing has to be matched, and both
 * numbers are printed on the row -- so no reader has to guess which one the
 * bar length means. Reading top to bottom is reading the pipeline in order,
 * the same model the handbook teaches.
 *
 * A stage holding deals with no recorded value still draws: an empty bar with
 * its count beside it. Dropping it would let "we have not priced these yet"
 * read as "there is nothing here", and those are different facts.
 */
function Ladder({
  composition,
  lang,
}: {
  composition: ReturnType<typeof computeStanding>["composition"];
  lang: "ar" | "en";
}) {
  const peak = Math.max(...composition.map((c) => c.value), 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between gap-[0.3vh]">
      {composition.map((c, i) => {
        const w = peak > 0 ? (c.value / peak) * 100 : 0;
        const empty = c.count === 0;
        return (
          <div
            key={c.stage}
            className="flex items-center gap-[0.7vw]"
            // An empty stage is real information, so it stays -- but it should
            // not compete with the stages that hold the money.
            style={{ opacity: empty ? 0.45 : 1 }}
          >
            <span
              className="shrink-0 truncate text-foreground"
              style={{ fontSize: "0.8vw", width: "8vw" }}
            >
              {STAGE_LABEL[c.stage]?.[lang === "ar" ? 0 : 1] ?? c.stage}
            </span>

            <span className="relative h-[1.35vh] min-w-0 flex-1 overflow-hidden rounded-[0.2vw] bg-muted">
              <span
                className="absolute inset-y-0 start-0 rounded-[0.2vw]"
                style={{ width: `${w}%`, background: `var(--stage-${i + 1})` }}
              />
              {/* Deals here, but nothing priced. A bare track would read as an
                  empty stage; this marks it as unpriced instead. */}
              {!empty && c.value === 0 ? (
                <span
                  className="absolute inset-y-0 start-0"
                  style={{ width: "0.5vw", background: `var(--stage-${i + 1})`, opacity: 0.5 }}
                />
              ) : null}
            </span>

            <span
              className="num shrink-0 text-end font-semibold text-foreground"
              style={{ fontSize: "0.85vw", width: "3.2vw" }}
              data-tabular="true"
            >
              {formatNumber(c.count, lang)}
            </span>
            <span
              className="num shrink-0 text-end text-muted-foreground"
              style={{ fontSize: "0.8vw", width: "6vw" }}
              data-tabular="true"
            >
              {c.value > 0 ? compactValue(c.value, lang) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BoardPage() {
  const { lang } = useI18n();
  const { data, dataUpdatedAt, isError } = useBoardData();
  const now = useNow(1000);
  const nowDate = useMemo(() => new Date(now), [now]);
  const fresh = freshnessOf(isError ? null : dataUpdatedAt || null, now, POLL_MS);

  // Counts stay exact -- "5 follow-ups" is a number you act on. Money is
  // compacted, because nine digits at wall size is a wall of digits.
  const nf = (n: number | null | undefined) =>
    n === null || n === undefined ? null : formatNumber(Math.round(n), lang);
  const money = (n: number | null | undefined) => compactValue(n, lang);

  const model = useMemo(() => {
    if (!data) return null;
    const opps = rows<BoardOpp>(data.opps);
    const pulse = computePulse({
      approvalsPendingAt: rows<{ created_at: string }>(data.approvals).map((r) => r.created_at),
      followUpDueDates: rows<{ due_date: string }>(data.followUps).map((r) => r.due_date),
      quotationDueDates: rows<{ valid_until: string | null }>(data.quotations).map((r) => r.valid_until),
      // The rule lives in dashboard-helpers; the board only counts its verdict.
      // `tenders` has no submission date column, so received (created_at) is
      // the reference the helper falls back to anyway.
      tendersNeedingReview: rows<{ tender_stage: string; created_at: string | null }>(data.tenders).filter((t) =>
        requiresConversionReview({
          tender_stage: t.tender_stage,
          submissionDate: null,
          receivedDate: t.created_at,
        }),
      ).length,
      inboxUnclassified: rows(data.inbox).length,
      now: nowDate,
    });
    const standing = computeStanding(opps, nowDate);

    const year = String(nowDate.getUTCFullYear());
    const targets = new Map<string, number>();
    for (const t of rows<{
      user_id: string;
      sales_target: number | string;
      period_type: string;
      period_start: string;
    }>(data.targets)) {
      if (t.period_type !== "annual" || !t.period_start.startsWith(year)) continue;
      targets.set(t.user_id, Number(t.sales_target) || 0);
    }
    const labels = new Map<string, string>();
    for (const p of rows<{ id: string; full_name: string | null }>(data.profiles)) {
      labels.set(p.id, displayLabel(p.full_name));
    }
    // The annual target for the whole company is the sum of the individual
    // rows: sales_targets is keyed per user, so a company figure has no row of
    // its own. Summing is the honest reading of the schema as it stands.
    const annual = [...targets.values()].reduce((a, v) => a + v, 0) || null;
    return {
      pulse,
      standing,
      team: computeTeam(opps, targets, labels, nowDate),
      trend: wonTrend(opps, nowDate, 6),
      year: yearProgress(opps, annual, nowDate),
    };
  }, [data, nowDate]);

  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat(localeFor(lang), { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-[1.6vw] py-[1.1vh]">
        <div className="flex items-baseline gap-[1.2vw]">
          <span className="brand-mark text-foreground" style={{ fontSize: "1.1vw" }}>
            PHC
          </span>
          <span className="num font-semibold text-foreground" style={{ fontSize: "1.6vw" }}>
            {fmtTime(nowDate)}
          </span>
        </div>
        <div className="flex items-center gap-[1.4vw] text-muted-foreground" style={{ fontSize: "0.85vw" }}>
          <span>
            {lang === "ar" ? "آخر تحديث" : "Updated"}{" "}
            <span className="num">{dataUpdatedAt ? fmtTime(new Date(dataUpdatedAt)) : "—"}</span>
          </span>
          <Dot f={fresh} lang={lang} />
        </div>
      </header>

      {fresh !== "live" ? (
        <div
          className={`shrink-0 px-[1.6vw] py-[0.8vh] text-center font-semibold ${
            fresh === "stale" ? "bg-destructive/12 text-destructive-on-tint" : "bg-amber/12 text-amber-deep"
          }`}
          style={{ fontSize: "0.95vw" }}
        >
          {fresh === "stale"
            ? lang === "ar"
              ? "الاتصال منقطع — الأرقام أدناه قديمة ولا يُبنى عليها قرار"
              : "Disconnected — the figures below are old; do not act on them"
            : lang === "ar"
              ? "التحديث متأخّر"
              : "Update is late"}
        </div>
      ) : null}

      {!model ? (
        <div className="grid flex-1 place-items-center text-muted-foreground" style={{ fontSize: "1.3vw" }}>
          {lang === "ar" ? "يُحمّل…" : "Loading…"}
        </div>
      ) : (
        <main
          className={`grid min-h-0 flex-1 gap-[1.1vh] px-[1.6vw] py-[1.2vh] ${fresh === "stale" ? "opacity-45" : ""}`}
          // Four bands. The money gets the most height because it is the band
          // meant to be read from the far side of the room.
          style={{ gridTemplateRows: "auto auto auto auto minmax(0, 1.45fr) minmax(0, 1fr)" }}
        >
          {/* ── المال ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-[0.9vw]">
            <Hero
              value={money(model.standing.openTotal)}
              ar="المفتوح — آخر 12 شهرًا"
              en="Open — last 12 months"
              tone="money"
              sub={
                model.standing.openUnvalued > 0
                  ? lang === "ar"
                    ? `${dealsLabel(model.standing.openCount, lang)} · ${formatNumber(model.standing.openUnvalued, lang)} بلا قيمة مسجَّلة`
                    : `${dealsLabel(model.standing.openCount, lang)} · ${model.standing.openUnvalued} carry no value`
                  : dealsLabel(model.standing.openCount, lang)
              }
            />
            <Hero
              value={money(model.standing.wonThisMonth)}
              ar="مُرسّى هذا الشهر"
              en="Won this month"
              tone="won"
              sub={dealsLabel(model.standing.wonThisMonthCount, lang)}
            />
            <Hero
              value={money(model.standing.lateStageExposure)}
              ar="ملتزَم به وقابل للخسارة"
              en="Committed, still losable"
              tone="amber"
            />
            <Hero
              value={
                model.standing.winRate === null
                  ? null
                  : `${formatNumber(Math.round(model.standing.winRate * 100), lang)}%`
              }
              ar="نسبة الفوز"
              en="Win rate"
              sub={
                model.standing.winRate === null
                  ? lang === "ar"
                    ? "لا صفقة محسومة بعد"
                    : "nothing decided yet"
                  : undefined
              }
            />
          </div>

          {/* What the window left out. Stated, because a filtered figure
              presented as a total is the quiet kind of misreporting this
              board is built to avoid. */}
          {model.standing.openExcludedCount > 0 ? (
            <div
              className="flex items-baseline justify-between rounded-[0.5vw] border border-border px-[1.1vw] py-[0.5vh] text-muted-foreground"
              style={{ background: "var(--card)", fontSize: "0.74vw" }}
            >
              <span>
                {lang === "ar"
                  ? `مستبعَد من "المفتوح": ${dealsLabel(model.standing.openExcludedCount, lang)} وصلت قبل ${OPEN_WINDOW_MONTHS} شهرًا وما زالت في مرحلة مفتوحة — بقيمة ${compactValue(model.standing.openExcludedValue, lang)}`
                  : `Excluded from open: ${dealsLabel(model.standing.openExcludedCount, lang)} that arrived over ${OPEN_WINDOW_MONTHS} months ago and are still in an open stage — worth ${compactValue(model.standing.openExcludedValue, lang)}`}
              </span>
              <span>{lang === "ar" ? "تستحق إغلاقًا أو إحياءً" : "worth closing or reviving"}</span>
            </div>
          ) : null}

          {/* ── الهدف السنوي ──────────────────────────────────────────── */}
          <div
            className="rounded-[0.6vw] border px-[1.4vw] py-[1.4vh]"
            style={{
              background: "color-mix(in srgb, var(--amber) 6%, var(--card))",
              borderColor: "color-mix(in srgb, var(--amber) 28%, var(--border))",
            }}
          >
            <YearBar p={model.year} lang={lang} />
          </div>

          {/* ── ما ينتظر قرارًا ───────────────────────────────────────── */}
          <div className="grid grid-cols-5 gap-[0.9vw]">
            <Tile
              value={nf(model.pulse.approvalsPending)}
              ar="موافقات منتظرة"
              en="Approvals pending"
              tone={model.pulse.approvalsPending > 0 ? "amber" : "ink"}
              sub={
                model.pulse.oldestApprovalDays === null
                  ? undefined
                  : lang === "ar"
                    ? `أقدمها منذ ${formatNumber(model.pulse.oldestApprovalDays, lang)} يومًا`
                    : `oldest ${model.pulse.oldestApprovalDays}d`
              }
            />
            <Tile
              value={nf(model.pulse.followUpsOverdue)}
              ar="متابعات متأخّرة"
              en="Follow-ups overdue"
              tone={model.pulse.followUpsOverdue > 0 ? "danger" : "ink"}
            />
            <Tile value={nf(model.pulse.quotationsDueSoon)} ar="عروض تستحق خلال 7 أيام" en="Quotations due ≤7d" tone="info" />
            <Tile
              value={nf(model.pulse.tendersNeedingReview)}
              ar="مناقصات تحتاج مراجعة"
              en="Tenders needing review"
              tone={model.pulse.tendersNeedingReview > 0 ? "amber" : "ink"}
            />
            <Tile value={nf(model.pulse.inboxUnclassified)} ar="وارد غير مصنَّف" en="Inbox unclassified" tone="info" />
          </div>

          {/* ── رسمان: الاتجاه، والتركيب ──────────────────────────────── */}
          <div className="grid min-h-0 grid-cols-[1fr_1.7fr] gap-[0.9vw]">
            <div className="min-h-0 rounded-[0.6vw] border border-border bg-card px-[1.1vw] py-[0.9vh]">
              <Trend points={model.trend} lang={lang} />
            </div>
            <div className="flex min-h-0 flex-col gap-[0.5vh] rounded-[0.6vw] border border-border bg-card px-[1.1vw] py-[0.9vh]">
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-[0.7vw]">
                  <span className="font-semibold text-foreground" style={{ fontSize: "0.92vw" }}>
                    {lang === "ar" ? "سلّم المراحل" : "The stage ladder"}
                  </span>
                  <span className="text-muted-foreground" style={{ fontSize: "0.72vw", direction: "ltr" }}>
                    {lang === "ar" ? "The stage ladder" : "سلّم المراحل"}
                  </span>
                </div>
                {/* Says what the bar length means, so nobody has to infer it
                    from the two numbers printed beside it. */}
                <span className="text-muted-foreground" style={{ fontSize: "0.68vw" }}>
                  {lang === "ar"
                    ? "الطول = القيمة · ثم العدد فالقيمة"
                    : "bar length = value · then count, value"}
                </span>
              </div>
              <Ladder composition={model.standing.composition} lang={lang} />
            </div>
          </div>

          {/* ── الفريق ────────────────────────────────────────────────── */}
          <div className="min-h-0 overflow-hidden rounded-[0.6vw] border border-border bg-card px-[1.1vw] py-[0.8vh]">
            <table className="w-full" style={{ fontSize: "0.95vw" }}>
              <thead>
                <tr className="text-muted-foreground" style={{ fontSize: "0.72vw" }}>
                  <th className="pb-[0.5vh] text-start">{lang === "ar" ? "من" : "Who"}</th>
                  <th className="pb-[0.5vh] text-end">{lang === "ar" ? "مُرسّى" : "Won"}</th>
                  <th className="pb-[0.5vh] text-end">{lang === "ar" ? "الهدف" : "Target"}</th>
                  <th className="pb-[0.5vh] text-end">{lang === "ar" ? "الإنجاز" : "Achieved"}</th>
                  <th className="pb-[0.5vh] text-end">{lang === "ar" ? "خط الأنابيب" : "Pipeline"}</th>
                  <th className="pb-[0.5vh] text-end">{lang === "ar" ? "فرص" : "Deals"}</th>
                </tr>
              </thead>
              <tbody>
                {model.team.slice(0, 6).map((p) => (
                  <tr key={p.ownerId} className="border-t border-border/60">
                    <td className="py-[0.55vh] font-semibold text-foreground">{p.label}</td>
                    <td className="num py-[0.55vh] text-end text-foreground" data-tabular="true">
                      {money(p.won)}
                    </td>
                    <td className="num py-[0.55vh] text-end text-muted-foreground" data-tabular="true">
                      {money(p.target)}
                    </td>
                    <td className="num py-[0.55vh] text-end font-semibold" data-tabular="true">
                      {p.achievement === null ? (
                        // A dash, not 0% -- nobody set them a target.
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={p.achievement >= 1 ? "text-won-on-tint" : "text-foreground"}>
                          {formatNumber(Math.round(p.achievement * 100), lang)}%
                        </span>
                      )}
                    </td>
                    <td className="num py-[0.55vh] text-end text-muted-foreground" data-tabular="true">
                      {money(p.open)}
                    </td>
                    <td className="num py-[0.55vh] text-end text-muted-foreground" data-tabular="true">
                      {formatNumber(p.openCount, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      )}
    </div>
  );
}
