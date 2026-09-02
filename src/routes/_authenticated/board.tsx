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

import { useEffect, useMemo, useRef, useState } from "react";
// Line icons, not emoji.
//
// Emoji were a placeholder and they read like one on a wall: they carry each
// platform's own colour, so an "amber" card had a red 🔻 in it and the tinted
// badge behind it fought whatever the font decided. A Lucide glyph takes
// `currentColor`, so every icon is the colour of the thing it labels -- which
// is the point of the tint behind it.
import {
  Activity, AlertTriangle, BarChart3, CalendarClock, CalendarDays, CheckCircle2,
  CircleX, Clock, FileText, Filter, Flame, Handshake, Megaphone, PauseCircle,
  PieChart, RefreshCw, Sparkles, Target, TrendingUp, Users,
  type LucideIcon,
} from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dueForRefresh, keepAlive } from "@/lib/session-keepalive";
import { useI18n, formatNumber, localeFor } from "@/lib/i18n";
import { requiresConversionReview } from "@/lib/dashboard-helpers";
import {
  attentionItems,
  pulseSentences,
  hotOpportunities,
  horizonForecast,
  pipelineBuckets,
  pipelineCoverage,
  weightedPipeline,
  upcoming,
  wireItems,
  sharedReason,
  oldestOverdueDays,
  movement,
  type Figure,
  type IntelOpp,
} from "@/lib/board-intel";
import {
  computePulse,
  computeStanding,
  computeTeam,
  displayLabel,
  freshnessOf,
  compactValue,
  splitCompact,
  yearOnYear,
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

/** Same asset the sign-in pages and the sidebar use, so the wall cannot
 *  drift from the identity the rest of the app already carries. */
const phcLogo = { url: "/phc-logo.png" };

/** Values move in minutes, not seconds. A tighter poll would only add load. */
const POLL_MS = 60_000;

/**
 * Ask for a fresh access token on our own clock.
 *
 * `autoRefreshToken` renews on a timer and on focus. A wall display gives it
 * neither: browsers throttle timers in a tab nobody has touched, and a screen
 * in the corner of an office is never focused, clicked or scrolled. Miss enough
 * renewals and the session is gone -- not because anyone signed out, but
 * because nothing woke up to say it was still there.
 *
 * Belt over braces: where autoRefreshToken has already done the work this is a
 * no-op against a cached session. It changes no lifetime and no policy.
 */
function useSessionKeepAlive() {
  const lastAt = useRef<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled || !dueForRefresh(lastAt.current, Date.now())) return;
      const ok = await keepAlive(() => supabase.auth.refreshSession());
      // Only on success: a failed attempt must not push the next one out by
      // twenty minutes, which is how a display sleeps through its own expiry.
      if (ok) lastAt.current = Date.now();
    };
    void tick();
    const id = setInterval(() => { void tick(); }, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
}

/**
 * The wall board renders in one language, whatever the app is set to.
 *
 * Asked for on 2026-09-02: "make the language English only, entirely." This is
 * a screen on a wall, not a page anyone navigates -- it has one audience and
 * one reading, and the bilingual pairs it used to print (an Arabic line and its
 * English twin, stacked) spent space saying one thing twice.
 *
 * Every bilingual branch in this file is deliberately left standing, so
 * switching back, or to Arabic, is this one value. Declared at module scope
 * with its union type so the compiler does not narrow the comparisons away and
 * delete the other half of the file.
 */
const BOARD_LANG: "ar" | "en" = "en";

const STAGE_LABEL: Record<string, [string, string]> = {
  rfq_received: ["استُلم الطلب", "RFQ received"],
  // "Job in hand" reads in English as "we have the job". It means the
  // CONTRACTOR holds the main project -- our odds are better, not our win.
  // The review flagged the wording and was right; the bucket is unchanged.
  jih: ["المقاول يملك المشروع", "Contractor holds it"],
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
      const [opps, approvals, followUps, quotations, tenders, inbox, targets, profiles, moves] =
        await Promise.all([
          supabase
            .from("opportunities")
            .select(
              "id, project_name, client, owner_id, stage, sales_stage, contract_value, quotation_value, estimated_value_max, human_win_probability, expected_contract_date, next_action, next_action_due, last_activity_at, won_at, created_at",
            ),
          supabase.from("approvals").select("created_at").eq("status", "pending"),
          supabase.from("follow_ups").select("opportunity_id, due_date, status").eq("status", "scheduled"),
          // `valid_until` is the quotation's own deadline. There is no
          // "due_date" column -- the typechecker caught that guess.
          // The view, not the table: it exposes the two columns the pulse
          // needs and no others, so a display account never reaches a
          // quotation's value. security_invoker, so RLS still decides rows.
          supabase.from("board_quotation_pulse").select("valid_until, status"),
          supabase.from("tenders").select("tender_stage, created_at"),
          supabase.from("leads").select("id").eq("lead_stage", "detected"),
          supabase.from("sales_targets").select("user_id, sales_target, period_type, period_start"),
          supabase.from("profiles").select("id, full_name"),
          supabase
            .from("stage_transition_history")
            // to_stage as well: "moved to BAFO since yesterday" is a
            // transition, not a stage anyone happens to be sitting in.
            .select("changed_at, to_stage")
            .gte("changed_at", new Date(Date.now() - 7 * 86_400_000).toISOString()),
        ]);
      return { opps, approvals, followUps, quotations, tenders, inbox, targets, profiles, moves };
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
// Deliberately un-annotated. It was `Record<string, ...>`, which makes
// `keyof typeof TONE` widen to `string` -- so `tone="destructive"` (the key is
// `danger`) type-checked cleanly, threw at runtime on `.wash`, and took the
// whole board down to an error boundary. Inferring the type keeps every tone
// prop honest at compile time.
const TONE = {
  ink: { wash: "transparent", edge: "var(--rule, var(--border))", text: "text-foreground" },
  money: { wash: "color-mix(in srgb, var(--amber) 8%, var(--card))", edge: "var(--amber)", text: "text-amber-on-tint" },
  won: { wash: "color-mix(in srgb, var(--won) 8%, var(--card))", edge: "var(--won)", text: "text-won-on-tint" },
  amber: { wash: "color-mix(in srgb, var(--amber) 8%, var(--card))", edge: "var(--amber)", text: "text-amber-on-tint" },
  danger: { wash: "color-mix(in srgb, var(--destructive) 8%, var(--card))", edge: "var(--destructive)", text: "text-destructive-on-tint" },
  info: { wash: "color-mix(in srgb, var(--info) 8%, var(--card))", edge: "var(--info)", text: "text-info" },
  violet: { wash: "color-mix(in srgb, var(--violet) 8%, var(--card))", edge: "var(--violet)", text: "text-violet-on-tint" },
  teal: { wash: "color-mix(in srgb, var(--teal) 8%, var(--card))", edge: "var(--teal)", text: "text-teal-on-tint" },
} satisfies Record<string, { wash: string; edge: string; text: string }>;

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
        </div>
        {/* Two figures of the same weight, side by side, read as one number:
            "32% 7.9M" at a glance is 327.9. They need a real gap and a rule
            between them, not a wider letter-space -- and the slash needs air
            on both sides or it welds the pair into a single run. */}
        <div className="flex items-baseline gap-[1.6vw]">
          <span
            className={`num font-bold leading-none tracking-[-0.02em] ${ahead ? "text-won-on-tint" : "text-amber-on-tint"}`}
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

/**
 * A figure that may not exist, rendered as what it actually is.
 *
 * The distinction the review asked for, kept literally on screen: a computed
 * number, a column nobody has filled, and a setting nobody has made are three
 * different states and must not all print as "SAR 0". Zero means "we measured
 * and it is nothing"; the other two mean "we cannot say", and a wall nobody can
 * interrogate is the worst place to blur them.
 */
function FigureValue({
  f,
  lang,
  format,
  size,
}: {
  f: Figure;
  lang: "ar" | "en";
  format: (n: number) => string | null;
  size: string;
}) {
  if (f.state === "ok" && f.value !== null) {
    return (
      <span className="num font-bold leading-none tracking-[-0.02em] text-foreground" style={{ fontSize: size }}>
        {format(f.value)}
      </span>
    );
  }
  const head =
    f.state === "not_configured"
      ? lang === "ar" ? "يحتاج إعدادًا" : "Setup required"
      : f.state === "not_applicable"
        ? lang === "ar" ? "لا ينطبق" : "Not applicable"
        : lang === "ar" ? "لا يمكن حسابه" : "Not calculated";
  return (
    <span className="flex flex-col gap-[0.3vh]">
      <span className="font-semibold leading-none text-muted-foreground" style={{ fontSize: `calc(${size} * 0.42)` }}>
        {head}
      </span>
      {(lang === "ar" ? f.reasonAr : f.reasonEn) ? (
        <span className="text-muted-foreground" style={{ fontSize: "0.72vw" }}>
          {lang === "ar" ? f.reasonAr : f.reasonEn}
        </span>
      ) : null}
    </span>
  );
}

/** A Hero whose value may be unavailable. Same box, honest content. */
function HeroFigure({
  f,
  ar,
  en,
  lang,
  money,
}: {
  f: Figure;
  ar: string;
  en: string;
  lang: "ar" | "en";
  money: (n: number | null | undefined) => string | null;
}) {
  return (
    <div
      className="relative flex flex-col justify-center overflow-hidden rounded-[0.7vw] border border-border px-[1.4vw] py-[1.4vh]"
      style={{ background: TONE[f.state === "ok" ? "money" : "ink"].wash }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 start-0"
        style={{ width: "0.22vw", background: TONE[f.state === "ok" ? "money" : "ink"].edge }}
      />
      <FigureValue f={f} lang={lang} format={(n) => money(n)} size="3.9vw" />
      <div className="mt-[0.9vh] font-semibold text-foreground" style={{ fontSize: "1.02vw" }}>
        {lang === "ar" ? ar : en}
      </div>
    </div>
  );
}

function BoardPage() {
  // The wall board renders in English, whatever the rest of the app is set to.
  //
  // Asked for on 2026-09-02: "make the language English only, entirely." This
  // is a screen on a wall, not a page someone navigates -- it has one audience
  // and one reading, and the bilingual pairs it used to print (an Arabic line
  // and its English twin, stacked) spent space saying one thing twice.
  //
  // Deliberately a constant rather than a removal: every bilingual ternary in
  // this file still stands, so making it follow the app's toggle again is this
  // one line. `useI18n` is still read for `dir`, which the shell sets.
  const lang = BOARD_LANG;
  void useI18n;
  useSessionKeepAlive();
  const { data, dataUpdatedAt, isError } = useBoardData();
  const now = useNow(1000);
  const nowDate = useMemo(() => new Date(now), [now]);
  const fresh = freshnessOf(isError ? null : dataUpdatedAt || null, now, POLL_MS);

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
    const intel = opps as unknown as IntelOpp[];
    const weighted = weightedPipeline(intel);
    return {
      pulse,
      standing,
      team: computeTeam(opps, targets, labels, nowDate),
      trend: wonTrend(opps, nowDate, 6),
      year: yearProgress(opps, annual, nowDate),
      buckets: pipelineBuckets(intel),
      weighted,
      coverage: pipelineCoverage(weighted, annual),
      horizon: horizonForecast(intel, nowDate),
      hot: hotOpportunities(intel, 5),
      yoy: yearOnYear(opps, nowDate),
      oldestOverdue: oldestOverdueDays(
        rows<{ due_date: string | null }>(data.followUps).map((f) => f.due_date),
        nowDate,
      ),
      upcoming: upcoming(
        rows<{ due_date: string | null }>(data.followUps).map((f) => f.due_date),
        nowDate,
      ),
      movement: movement(
        intel,
        rows<{ changed_at: string | null; to_stage: string | null }>(data.moves),
        nowDate,
        1,
        {
          importedSource: "PHC Quotation List 2022-2026",
          followUps: rows<{ status: string | null; updated_at: string | null }>(data.followUps),
        },
      ),
      attention: attentionItems(
        intel,
        rows<{ opportunity_id: string; due_date: string | null }>(data.followUps),
        nowDate,
      ),
      labels,
    };
  }, [data, nowDate]);

  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat(localeFor(lang), { hour: "2-digit", minute: "2-digit", hour12: true }).format(d);
  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat(localeFor(lang), {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    }).format(d);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden" style={{ background: "color-mix(in srgb, var(--info) 4%, var(--muted))" }}>
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-[1.5vw] py-[1.1vh]">
        <div className="flex items-center gap-[1.2vw]">
          {/* The real wordmark, not the letters. `brightness-0` renders the
              near-white source as ink for this light header -- the same
              treatment the sidebar and every sign-in page already apply, so
              the wall cannot drift from the identity the app already carries. */}
          <img
            src={phcLogo.url}
            alt="PHC Wayfinding Signs"
            className="w-auto object-contain brightness-0"
            style={{ height: "3.4vh" }}
          />
          <span className="h-[3.4vh] w-px bg-border" aria-hidden="true" />
          <div className="flex flex-col">
            <span className="font-semibold leading-none text-foreground" style={{ fontSize: "1.5vw" }}>
              {lang === "ar" ? "مركز قيادة المبيعات" : "Sales Command Centre"}
            </span>
            <span className="mt-[0.45vh] text-muted-foreground" style={{ fontSize: "0.75vw" }}>
              {lang === "ar" ? "وضوحٌ يُصنَع ويُركَّب." : "Clarity, built into place."}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-[1.3vw] text-muted-foreground" style={{ fontSize: "0.85vw" }}>
          <Dot f={fresh} lang={lang} />
          <span className="h-[2.4vh] w-px bg-border" aria-hidden="true" />
          <span className="num">{fmtDate(nowDate)}</span>
          <span className="h-[2.4vh] w-px bg-border" aria-hidden="true" />
          <span className="num font-semibold text-foreground" style={{ fontSize: "1.05vw" }}>{fmtTime(nowDate)}</span>
        </div>
      </header>

      {fresh !== "live" ? (
        <div
          className={`shrink-0 px-[1.5vw] py-[0.6vh] text-center font-semibold ${
            fresh === "stale" ? "bg-destructive/12 text-destructive-on-tint" : "bg-amber/12 text-amber-on-tint"
          }`}
          style={{ fontSize: "0.85vw" }}
        >
          {fresh === "stale"
            ? lang === "ar" ? "الاتصال منقطع — الأرقام أدناه قديمة ولا يُبنى عليها قرار" : "Disconnected — figures below are old"
            : lang === "ar" ? "التحديث متأخّر" : "Update is late"}
        </div>
      ) : null}

      {!model ? (
        <div className="grid flex-1 place-items-center text-muted-foreground" style={{ fontSize: "1.2vw" }}>
          {lang === "ar" ? "يُحمّل…" : "Loading…"}
        </div>
      ) : (
        <main
          className={`grid min-h-0 flex-1 gap-[0.8vh] px-[1.2vw] py-[1vh] ${fresh === "stale" ? "opacity-45" : ""}`}
          // Explicit fractions, not `auto`. With the top two rows content-sized
          // the table row swallowed everything left over and towered over the
          // cards above it.
          style={{
            gridTemplateRows:
              "minmax(0,1.15fr) minmax(0,1fr) minmax(0,1.25fr) minmax(0,1fr)",
          }}
        >
          <div className="grid grid-cols-5 gap-[0.7vw]">
            <Kpi
              icon={TrendingUp} tone="won" lang={lang}
              ar="الإنجاز منذ بداية السنة" en="Won year to date"
              value={splitCompact(model.yoy.thisYear, lang)?.n ?? null}
              unit={splitCompact(model.yoy.thisYear, lang)?.unit}
              foot={
                // Against the SAME window last year, never its full total --
                // that would flatter every January and damn every December.
                model.yoy.ratio === null
                  ? lang === "ar" ? "لا فوز في نفس الفترة الماضية — لا مقارنة" : "nothing won in this window last year"
                  : lang === "ar"
                    ? `${model.yoy.ratio >= 0 ? "▲" : "▼"} ${formatNumber(Math.abs(Math.round(model.yoy.ratio * 100)), lang)}% مقارنة بـ ${compactValue(model.yoy.priorYear, lang)} نفس الفترة الماضية`
                    : `${model.yoy.ratio >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(model.yoy.ratio * 100))}% vs ${compactValue(model.yoy.priorYear, lang)} same period last year`
              }
            />
            <Kpi
              icon={Target} tone="info" lang={lang}
              ar="الهدف السنوي" en="Annual target"
              value={splitCompact(model.year.target, lang)?.n ?? null}
              unit={splitCompact(model.year.target, lang)?.unit}
              foot={
                model.year.target === null
                  ? lang === "ar" ? "لم يُضبط هدف" : "no target set"
                  : lang === "ar"
                    ? `مضى ${formatNumber(Math.round(model.year.yearElapsed * 100), lang)}% من السنة`
                    : `${Math.round(model.year.yearElapsed * 100)}% of the year elapsed`
              }
            />
            <KpiFigure
              icon={Activity} f={model.weighted} lang={lang} money={money} tone="violet"
              ar="التوقع المرجّح" en="Weighted forecast"
              // Only when both halves are real. A percentage of a target that
              // was never set, or of a forecast that could not be computed, is
              // a number with nothing behind it.
              foot={
                model.weighted.state === "ok" && model.weighted.value !== null
                  && model.year.target && model.year.target > 0
                  ? lang === "ar"
                    ? `${formatNumber(Math.round((model.weighted.value / model.year.target) * 100), lang)}% من الهدف`
                    : `${Math.round((model.weighted.value / model.year.target) * 100)}% of target`
                  : null
              }
            />
            <Kpi
              icon={Filter} tone="teal" lang={lang}
              ar="الفرص المؤهلة (المسار)" en="Qualified pipeline"
              value={splitCompact(model.standing.openTotal, lang)?.n ?? null}
              unit={splitCompact(model.standing.openTotal, lang)?.unit}
              foot={
                // Unweighted coverage: real, and labelled as such. The weighted
                // ratio the mockup shows needs a probability nobody has entered,
                // and an unlabelled ratio would be read as the weighted one.
                model.year.target && model.year.target > 0
                  ? lang === "ar"
                    ? `تغطية ×${(model.standing.openTotal / model.year.target).toFixed(1)} غير مرجّحة · ${dealsLabel(model.standing.openCount, lang)}`
                    : `${(model.standing.openTotal / model.year.target).toFixed(1)}× coverage, unweighted · ${dealsLabel(model.standing.openCount, lang)}`
                  : dealsLabel(model.standing.openCount, lang)
              }
            />
            <Kpi
              icon={PieChart}
              tone={model.year.ratio !== null && model.year.ratio >= model.year.yearElapsed ? "won" : "amber"}
              lang={lang}
              ar="نسبة تحقيق الهدف" en="Target achievement"
              value={model.year.ratio === null ? null : `${formatNumber(Math.round(model.year.ratio * 100), lang)}%`}
              unit={model.year.target ? (lang === "ar" ? `من ${compactValue(model.year.target, lang)}` : `of ${compactValue(model.year.target, lang)}`) : null}
              gauge={model.year.ratio}
              foot={
                model.year.ratio === null
                  ? lang === "ar" ? "لم يُضبط هدف" : "no target set"
                  : model.year.ratio >= model.year.yearElapsed
                    ? lang === "ar" ? "أمام المعدّل المطلوب" : "ahead of required pace"
                    : lang === "ar" ? "أقل من المعدّل المطلوب" : "below required pace"
              }
            />
          </div>
          <div className="grid grid-cols-[1.55fr_1fr] gap-[0.7vw]">
            <Panel dark title={lang === "ar" ? "يتطلّب الانتباه" : "Needs attention"} icon={AlertTriangle} tone="danger" lang={lang}>
              <div className="grid flex-1 grid-cols-4 gap-[0.6vw]">
                <Need dark icon={CalendarClock} n={model.pulse.followUpsOverdue} ar="متابعات متأخّرة" en="Follow-ups overdue"
                      sub={lang === "ar" ? "مطلوب إجراء اليوم" : "action needed today"} tone="danger" lang={lang} />
                <Need dark icon={Clock} n={model.pulse.quotationsDueSoon} ar="عروض ≤ 7 أيام" en="Quotations ≤7d"
                      sub={model.pulse.quotationsDueSoon === null
                        ? (lang === "ar" ? "لا تاريخ صلاحية مسجّل" : "no expiry recorded")
                        : (lang === "ar" ? "ردّ خلال المدّة" : "reply within validity")}
                      tone="amber" lang={lang} />
                <Need dark icon={Flame} n={model.attention.filter((a) => a.priority === "critical").length}
                      ar="فرص حرجة" en="Critical deals"
                      sub={lang === "ar" ? "قيمة عالية ومتأخّرة" : "high value, overdue"} tone="danger" lang={lang} />
                <Need dark icon={CircleX} n={model.pulse.approvalsPending} ar="موافقات منتظرة" en="Approvals pending"
                      sub={model.pulse.oldestApprovalDays === null
                        ? (lang === "ar" ? "لا شيء ينتظر" : "nothing waiting")
                        : (lang === "ar" ? `أقدمها ${formatNumber(model.pulse.oldestApprovalDays, lang)} يومًا` : `oldest ${model.pulse.oldestApprovalDays}d`)}
                      tone="amber" lang={lang} />
              </div>
            </Panel>

            <Panel title={lang === "ar" ? "اليوم / الأيام السبعة القادمة" : "Today / next seven days"} icon={CalendarDays} tone="info" lang={lang}>
              {model.upcoming === null ? (
                <div className="flex flex-1 flex-col justify-center gap-[0.4vh]">
                  <span className="font-semibold text-amber-on-tint" style={{ fontSize: "0.95vw" }}>
                    {lang === "ar" ? "لا شيء مجدوَل بعد اليوم" : "Nothing scheduled ahead"}
                  </span>
                  <span className="text-muted-foreground" style={{ fontSize: "0.74vw" }}>
                    {lang === "ar"
                      ? "كل المتابعات متأخّرة — الأجندة فارغة لا خالية"
                      : "Every follow-up is overdue — the calendar is empty, not clear"}
                  </span>
                </div>
              ) : (
                <div className="flex flex-1 flex-col justify-center gap-[0.5vh]" style={{ fontSize: "0.82vw" }}>
                  {([
                    [lang === "ar" ? "اليوم" : "Today", model.upcoming.todayCount],
                    [lang === "ar" ? "غدًا" : "Tomorrow", model.upcoming.tomorrowCount],
                    [lang === "ar" ? "هذا الأسبوع" : "This week", model.upcoming.weekCount],
                  ] as const).map(([l, n]) => (
                    <div key={l} className="flex items-baseline justify-between border-b border-border/40 pb-[0.35vh]">
                      <span className="text-muted-foreground">{l}</span>
                      <span className="num font-semibold text-foreground" data-tabular="true">{formatNumber(n, lang)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="grid min-h-0 grid-cols-3 gap-[0.7vw]">
            <Panel title={lang === "ar" ? "أهمّ الفرص" : "Top opportunities"} icon={Flame} tone="amber" lang={lang}
                   note={lang === "ar" ? "أعلى 5 حسب القيمة" : "top 5 by value"}>
              {/* Same fix as the pipeline below: the table stacked to its natural
                  height and pushed the total 12px past the card edge. Flexed
                  rows share whatever the panel has. */}
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-[0.5vw] pb-[0.4vh] text-muted-foreground" style={{ fontSize: "0.62vw" }}>
                  <span className="min-w-0 flex-1">{lang === "ar" ? "المشروع" : "Project"}</span>
                  <span className="shrink-0 text-end" style={{ width: "6vw" }}>{lang === "ar" ? "القيمة" : "Value"}</span>
                  <span className="shrink-0 text-end" style={{ width: "4.4vw" }}>{lang === "ar" ? "الاحتمالية" : "Probability"}</span>
                </div>

                <AutoScroll className="flex min-h-0 flex-1 flex-col">
                  {model.hot.map((h, i) => (
                    <div key={h.id} className="flex min-h-0 flex-1 items-center gap-[0.5vw] border-t border-border/50" style={{ fontSize: "0.72vw" }}>
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {/* A numbered badge, not a grey digit: this list is
                            ranked, and rank is the reason the row is here. */}
                        <span
                          className="num me-[0.45vw] inline-grid place-items-center rounded-full font-bold text-white align-middle"
                          data-tabular="true"
                          style={{
                            width: "1.15vw", height: "1.15vw", fontSize: "0.6vw",
                            background: `var(--stage-${Math.min(i + 1, 7)})`,
                          }}
                        >
                          {formatNumber(i + 1, lang)}
                        </span>
                        {h.projectName}
                      </span>
                      <span className="num shrink-0 text-end font-semibold text-foreground" style={{ width: "6vw" }} data-tabular="true">
                        {money(h.value)}
                      </span>
                      {/* Empty on every row today. A dash is the honest cell, and
                          the column stays so the first entered figure lands in
                          its place without a code change. */}
                      <span className="num shrink-0 text-end text-muted-foreground" style={{ width: "4.4vw" }} data-tabular="true">
                        {h.probability === null ? "—" : `${formatNumber(h.probability, lang)}%`}
                      </span>
                    </div>
                  ))}
                </AutoScroll>

                <div className="flex shrink-0 items-baseline justify-between border-t border-border pt-[0.4vh]" style={{ fontSize: "0.72vw" }}>
                  <span className="font-semibold text-amber-on-tint">{lang === "ar" ? "إجمالي أهمّ الفرص" : "Top-5 total"}</span>
                  <span className="num font-bold text-amber-on-tint" data-tabular="true">
                    {money(model.hot.reduce((a, h) => a + (h.value ?? 0), 0))}
                  </span>
                </div>
              </div>
            </Panel>

            <Panel title={lang === "ar" ? "صحّة مسار المبيعات" : "Pipeline health"} icon={BarChart3} tone="violet" lang={lang}>
              {/* Rows share the height instead of stacking to their natural size.
                  As a table this overflowed the panel by 68px at 1920x1080 and
                  the last two stages were drawn outside the card -- a stage that
                  falls off the bottom is a stage nobody knows exists. Flexing
                  the rows makes the fit hold for any number of stages. */}
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-[0.5vw] pb-[0.4vh] text-muted-foreground" style={{ fontSize: "0.6vw" }}>
                  <span className="min-w-0 flex-1">{lang === "ar" ? "المرحلة" : "Stage"}</span>
                  <span className="shrink-0 text-end" style={{ width: "2.6vw" }}>{lang === "ar" ? "العدد" : "Deals"}</span>
                  <span className="shrink-0 text-end" style={{ width: "5vw" }}>{lang === "ar" ? "القيمة" : "Value"}</span>
                  <span className="shrink-0 text-end" style={{ width: "7.4vw" }}>{lang === "ar" ? "النسبة" : "Share"}</span>
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                  {model.standing.composition.map((c, i) => (
                    <div
                      key={c.stage}
                      className="flex min-h-0 flex-1 items-center gap-[0.5vw] border-t border-border/50"
                      // An empty stage is real information, so it stays -- but it
                      // must not compete with the stages holding the money.
                      style={{ opacity: c.count === 0 ? 0.5 : 1 }}
                    >
                      <span className="min-w-0 flex-1 truncate text-foreground" style={{ fontSize: "0.7vw" }}>
                        {STAGE_LABEL[c.stage]?.[lang === "ar" ? 0 : 1] ?? c.stage}
                      </span>
                      <span className="num shrink-0 text-end font-semibold text-foreground" style={{ fontSize: "0.72vw", width: "2.6vw" }} data-tabular="true">
                        {formatNumber(c.count, lang)}
                      </span>
                      <span className="num shrink-0 text-end text-muted-foreground" style={{ fontSize: "0.7vw", width: "5vw" }} data-tabular="true">
                        {c.value > 0 ? compactValue(c.value, lang) : "—"}
                      </span>
                      <span className="flex shrink-0 items-center gap-[0.35vw]" style={{ width: "7.4vw" }}>
                        <span className="relative h-[0.85vh] min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className="absolute inset-y-0 start-0 rounded-full"
                            style={{ width: `${c.share * 100}%`, background: `var(--stage-${i + 1})` }}
                          />
                          {/* Deals here, but nothing priced. A bare track reads as
                              an empty stage; this marks it unpriced instead. */}
                          {c.count > 0 && c.value === 0 ? (
                            <span className="absolute inset-y-0 start-0" style={{ width: "0.35vw", background: `var(--stage-${i + 1})`, opacity: 0.55 }} />
                          ) : null}
                        </span>
                        <span className="num shrink-0 text-end text-muted-foreground" style={{ fontSize: "0.62vw", width: "2vw" }} data-tabular="true">
                          {Math.round(c.share * 100)}%
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex shrink-0 items-baseline justify-between border-t border-border pt-[0.4vh]" style={{ fontSize: "0.72vw" }}>
                  <span className="font-semibold text-foreground">{lang === "ar" ? "الإجمالي" : "Total"}</span>
                  <span className="num font-bold text-foreground" data-tabular="true">
                    {formatNumber(model.standing.openCount, lang)} · {money(model.standing.openTotal)}
                  </span>
                </div>
              </div>
            </Panel>

            <Panel title={lang === "ar" ? "أداء فريق المبيعات" : "Team performance"} icon={Users} tone="teal" lang={lang}>
              <table className="w-full" style={{ fontSize: "0.7vw" }}>
                <thead>
                  <tr className="text-muted-foreground" style={{ fontSize: "0.6vw" }}>
                    <th className="pb-[0.4vh] text-start">{lang === "ar" ? "العضو" : "Member"}</th>
                    <th className="pb-[0.4vh] text-end">{lang === "ar" ? "المحقّق" : "Won"}</th>
                    <th className="pb-[0.4vh] text-end">{lang === "ar" ? "المسار" : "Pipeline"}</th>
                    <th className="pb-[0.4vh] text-end">{lang === "ar" ? "متأخّرة" : "Overdue"}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* One hue per member, assigned by position in the table.
                      Deterministic, so a person keeps their colour between
                      refreshes and the eye can track a row without reading it. */}
                  {model.team.slice(0, 5).map((p, idx) => {
                    const AVATAR = ["won", "info", "violet", "amber", "teal"] as const;
                    const av = AVATAR[idx % AVATAR.length];
                    const late = model.attention.filter(
                      (a) => a.ownerId === p.ownerId && a.reasons.includes("followups_overdue"),
                    ).length;
                    return (
                      <tr key={p.ownerId} className="border-t border-border/50">
                        <td className="py-[0.3vh]">
                          <span className="flex items-center gap-[0.4vw]">
                            <span className="grid shrink-0 place-items-center rounded-full font-bold text-white"
                                  style={{ width: "1.5vw", height: "1.5vw", fontSize: "0.6vw", background: TONE[av].edge }}>
                              {p.label}
                            </span>
                            <span className="truncate text-foreground">{p.label}</span>
                          </span>
                        </td>
                        <td className="num py-[0.3vh] text-end font-semibold text-foreground" data-tabular="true">{money(p.won)}</td>
                        <td className="num py-[0.3vh] text-end text-muted-foreground" data-tabular="true">{money(p.open)}</td>
                        <td className="num py-[0.3vh] text-end" data-tabular="true">
                          <span className={late > 0 ? "font-semibold text-destructive-on-tint" : "text-muted-foreground"}>
                            {formatNumber(late, lang)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-auto flex items-baseline justify-between border-t border-border pt-[0.4vh]" style={{ fontSize: "0.72vw" }}>
                <span className="font-semibold text-teal-on-tint">{lang === "ar" ? "الإجمالي" : "Total"}</span>
                <span className="num font-bold text-teal-on-tint" data-tabular="true">
                  {money(model.team.reduce((a, p) => a + p.won, 0))} · {money(model.team.reduce((a, p) => a + p.open, 0))}
                </span>
              </div>
            </Panel>
          </div>

          <div className="grid min-h-0 grid-cols-3 gap-[0.7vw]">
            <Panel title={lang === "ar" ? "ما الذي تغيّر منذ الأمس؟" : "Changed since yesterday"} icon={RefreshCw} tone="info" lang={lang}>
              <ChipRow
                // The exact window, where the title says it loosely.
                kicker={lang === "ar" ? "آخر 24 ساعة" : "Last 24 hours"}
                cols={5}
                footer={
                  <span className="text-muted-foreground" style={{ fontSize: "0.62vw" }}>
                    {lang === "ar" ? "الصفوف المستورَدة مستبعَدة من «جديدة»" : "Imported rows excluded from new"}
                  </span>
                }
              >
                <Mini icon={TrendingUp} n={model.movement.won} value={money(model.movement.wonValue)} ar="صفقات فُزنا بها" en="Won" tone="won" lang={lang} />
                <Mini icon={FileText} n={model.movement.newDeals} value={money(model.movement.newValue)} ar="فرص جديدة" en="New deals" tone="amber" lang={lang} />
                <Mini icon={Handshake} n={model.movement.toBafo} ar="انتقلت إلى BAFO" en="Moved to BAFO" tone="violet" lang={lang} />
                {/* The reference names this one "stalled deals", and its pause icon says
                    so too. `advanced` is the opposite fact -- deals that MOVED --
                    and putting it under a pause icon was reading the picture
                    carelessly. Stalled comes from the attention list, which
                    already defines it as no client contact in the window. */}
                <Mini icon={PauseCircle} n={model.attention.filter((a) => a.reasons.includes("stalled")).length}
                      ar="صفقات متوقفة" en="Stalled deals" tone="info" lang={lang} />
                <Mini icon={CheckCircle2} n={model.movement.followUpsClosed} ar="متابعات أُغلقت" en="Follow-ups closed" tone="teal" lang={lang} />
              </ChipRow>
            </Panel>

            <Panel title={lang === "ar" ? "نبض المبيعات بالذكاء الاصطناعي" : "AI sales pulse"} icon={Sparkles} tone="info" lang={lang}>
              <Pulse
                critical={model.attention.filter((a) => a.priority === "critical").length}
                criticalValue={model.attention
                  .filter((a) => a.priority === "critical")
                  .reduce<number | null>((a, x) => (x.value === null ? a : (a ?? 0) + x.value), null)}
                // "no client contact in over N days" is the stalled reason the
                // attention list already computes, not a second definition.
                stale={model.attention.filter((a) => a.reasons.includes("stalled")).length}
                staleAfterDays={7}
                weighted={model.weighted}
                target={model.year.target}
                wonYtd={model.yoy.thisYear}
                money={money}
                lang={lang}
              />
            </Panel>

            <Panel title={lang === "ar" ? "توقعات (30 / 60 / 90 يوم)" : "Forecast (30 / 60 / 90 days)"} icon={Clock} tone="amber" lang={lang}>
              <Horizons h={model.horizon} lang={lang} money={money} />
            </Panel>
          </div>
        </main>
      )}

      {/* Bigger, asked for on 2026-09-02. A ticker is read from across a room
          and at a glance, so it was the one strip on the board sized for a
          desk. Height and type both go up; the wire's speed is derived from
          the text length, so it stays readable rather than racing. */}
      <footer className="flex shrink-0 items-center gap-[1vw] px-[1.2vw] py-[1.1vh]" style={{ background: "var(--ink, #13161b)" }}>
        <span className="shrink-0 rounded-[0.3vw] px-[0.8vw] py-[0.35vh] font-bold text-white"
              style={{ fontSize: "0.95vw", background: "var(--destructive)" }}>
          {lang === "ar" ? "أخبار المبيعات" : "Sales wire"}
        </span>
        {/* Built from the same figures above -- a wire inventing its own items
            would be a second source of truth nobody could reconcile. */}
        <Wire lang={lang} items={model ? wireItems(model, lang, (n) => money(n) ?? "") : [lang === "ar" ? "جارٍ التحميل" : "Loading"]} />
        <span className="num shrink-0 text-white/70" style={{ fontSize: "0.95vw" }}>{fmtTime(nowDate)}</span>
      </footer>
    </div>
  );
}

/**
 * A news wire: one line of text that never stops moving.
 *
 * Three things make it read like a broadcast strip rather than a CSS trick:
 *
 * - The content is written TWICE and each pass travels exactly half the track.
 *   When the animation restarts, the second copy sits precisely where the first
 *   began, so the loop has no seam and no gap -- text simply keeps arriving.
 *
 * - The duration is derived from the length of the text, not fixed. A fixed
 *   duration makes three headlines crawl and twenty blur past; deriving it
 *   holds the speed constant at roughly eleven characters a second whatever
 *   the board happens to know today.
 *
 * - The direction follows the language. A ticker must move AGAINST the reading
 *   direction or the eye meets every headline ending-first. See the keyframes
 *   in styles.css.
 *
 * The track is keyed on its own text, so when the sixty-second poll changes what
 * the board knows, the strip restarts cleanly from the first headline instead of
 * jumping mid-stride to a track of a different width.
 */
function Wire({ items, lang }: { items: string[]; lang: "ar" | "en" }) {
  const text = items.join("\u00a0\u00a0\u00a0\u25cf\u00a0\u00a0\u00a0");
  // ~11 characters a second reads comfortably from across a room; the floor
  // keeps a two-word wire from whipping past.
  const seconds = Math.max(18, Math.round(text.length / 11));
  return (
    <div className="min-w-0 flex-1 overflow-hidden" style={{ maskImage: "linear-gradient(to left, transparent, #000 3%, #000 97%, transparent)", WebkitMaskImage: "linear-gradient(to left, transparent, #000 3%, #000 97%, transparent)" }}>
      <div
        key={text}
        className="wire-track flex w-max whitespace-nowrap text-white/85"
        style={{
          fontSize: "1.05vw",
          animation: `${lang === "ar" ? "wire-rtl" : "wire-ltr"} ${seconds}s linear infinite`,
        }}
      >
        <span className="px-[1.5vw]">{text}</span>
        {/* The second copy is decoration for the loop, not content. */}
        <span className="px-[1.5vw]" aria-hidden="true">{text}</span>
      </div>
    </div>
  );
}

/**
 * The pulse and the forecast draw the same chip, so they share one.
 *
 * They did not, and it showed: identical width, padding and radius, but 85px
 * against 117px and a 32.6px figure against 27.8px -- because each grid
 * stretched to whatever height its own panel had left over. Two boxes side by
 * side, built to the same intent, rendering a third apart.
 *
 * Giving the row a fixed height and both panels one component makes them equal
 * by construction rather than by two numbers that happen to agree today. A
 * contract test below holds them together.
 */
const CHIP_ROW_H = "7.9vh";
/** One type scale for both panels, for the same reason as the height. */
const CHIP_FIGURE = "1.6vw";
const CHIP_LABEL = "0.64vw";
const CHIP_NOTE = "0.58vw";
/** The kicker slot above the chips. Fixed, so the row below it cannot drift. */
const CHIP_KICKER_H = "1.5vh";
/* Both widths come from measuring the real strings at 1920x1080, not from
   guessing: the widest figure is "+88" at 60.0px and the widest text is
   "42.8 مليون معرَّضة" at 89.9px. The chip has 156.2px to give after its padding
   and gap, so 3.2vw (61.4px) for the number leaves 94.8px for the text -- about
   5px of slack, and nothing truncates. */
const CHIP_FIGURE_W = "3.2vw";

/**
 * The frame the three chip panels share: a kicker, the chip row, a footnote.
 *
 * Their chip rows used to start 26px apart -- 867, 883 and 893 -- because each
 * panel stacked whatever it happened to have above the chips: one had a kicker,
 * one centred itself, one did not. Three boxes on one line, and the eye reads
 * the misalignment before it reads a single number.
 *
 * Fixing it panel by panel would hold until the next edit. Fixing it here means
 * the kicker slot and the chip row are the same height in all three whatever
 * they contain, so the rows line up by construction.
 */
function ChipRow({
  kicker,
  footer,
  children,
  cols = 3,
}: {
  kicker: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** How many chips share the row. Five fit where three did; the height is
   *  fixed either way, so the row still lines up with the panels beside it. */
  cols?: 3 | 5;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <span
        className="flex shrink-0 items-center font-semibold text-muted-foreground"
        style={{ height: CHIP_KICKER_H, fontSize: "0.6vw" }}
      >
        {kicker}
      </span>
      <div
        className="grid shrink-0 gap-[0.4vw]"
        style={{ height: CHIP_ROW_H, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {children}
      </div>
      <div className="mt-[0.4vh] min-h-0 flex-1">{footer}</div>
    </div>
  );
}

/**
 * A list that shows the rest of itself, the way a stock board does.
 *
 * Asked for on 2026-09-02: the top-opportunities box "should move top to
 * bottom, automatically, the same idea as share displays on screens."
 *
 * A wall board has no reader to scroll it, so a list taller than its panel
 * hides its tail forever -- the fifth-largest deal is on screen or it is not,
 * and nobody standing there can tell which.
 *
 * Same mechanism as the news wire below, turned ninety degrees: the rows are
 * rendered TWICE and each pass travels exactly half the track, so the second
 * copy arrives where the first began and the loop has no seam and no jump
 * back. A ping-pong was the first draft and it is the wrong idiom -- a share
 * board never runs backwards, and a reader who looks up mid-row would find the
 * list moving the other way.
 *
 * Speed is derived from the content height, not fixed: six rows at a fixed
 * duration crawl and twenty blur. This holds a constant pixels-per-second
 * whatever the list happens to hold today.
 *
 * It does nothing at all when the content fits, which is the common case. An
 * idle animation on a static list is movement that means nothing, and on a
 * screen people glance at, movement is a claim that something changed.
 */
function AutoScroll({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Half the track is one copy of the list; the visible box is the frame.
      const copy = el.scrollHeight / 2;
      const overflow = copy - el.clientHeight;
      // ~14 px/s reads comfortably from across a room. Under a row of slack is
      // not worth animating -- it would twitch rather than scroll.
      setSeconds(overflow > 8 ? Math.max(12, Math.round(copy / 14)) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div ref={ref} className={className} style={{ overflow: "hidden" }}>
      <div
        className="board-marquee"
        style={seconds > 0 ? { animation: `marquee-up ${seconds}s linear infinite` } : undefined}
      >
        {children}
        {/* The second copy exists only to close the loop. */}
        {seconds > 0 ? <div aria-hidden="true">{children}</div> : null}
      </div>
    </div>
  );
}

function Chip({
  tone,
  lang,
  figure,
  label,
  note,
}: {
  tone: keyof typeof TONE;
  lang: "ar" | "en";
  /** The number. Sits on the left, alone, at one width for the whole row. */
  figure: React.ReactNode;
  label: React.ReactNode;
  note?: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div
      className="flex min-h-0 items-center gap-[0.5vw] overflow-hidden rounded-[0.5vw] px-[0.5vw] py-[0.4vh]"
      style={{
        background: t.wash,
        boxShadow: `inset 0 0 0 1px ${t.edge}`,
        // The number belongs on the physical left in BOTH languages, and a
        // plain `row` puts the first child on the reading edge -- which is the
        // right in Arabic. Reversing there, and only there, pins the number left
        // and lets the text start at its own reading edge either way.
        flexDirection: lang === "ar" ? "row-reverse" : "row",
      }}
    >
      {/* A fixed slot, not a shrink-to-fit one: "5" and "237" are different
          widths, and letting each chip size its own number would step the text
          column three times across a row of three. */}
      <span className="flex shrink-0 items-center justify-center" style={{ width: CHIP_FIGURE_W }}>
        {figure}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[0.15vh] text-start">
        {label}
        {note}
      </span>
    </div>
  );
}

/**
 * The pulse, as three checks rather than five sentences.
 *
 * It was a bulleted list, which is the wrong shape for a wall: a passer-by
 * reads a number across a room and a sentence only at the desk. Two changes
 * make it work standing up.
 *
 * First, the panel separates what you ACT on from what you FIX. A critical deal
 * and an unpriced record are both true and belong to different people on
 * different days; printing them as one list of bullets made the reader sort
 * them, every time.
 *
 * Second, an action count of zero is shown, in green, rather than hidden. The
 * old list dropped a line when its count was nil, so a clear day and a broken
 * query produced the same empty panel. Here zero says the check ran and you
 * are clear -- which is the single most useful thing this box can say.
 *
 * The data gaps below behave the opposite way and are omitted when absent: a
 * gap that does not exist is not news, and "0 deals missing a value" is a
 * sentence nobody needs to read twice a day.
 */
function Pulse({
  critical, criticalValue, stale, staleAfterDays, weighted, target, wonYtd, money, lang,
}: {
  critical: number;
  criticalValue: number | null;
  stale: number;
  staleAfterDays: number;
  weighted: Figure;
  target: number | null;
  wonYtd: number;
  money: (n: number | null | undefined) => string | null;
  lang: "ar" | "en";
}) {
  const lines = pulseSentences(
    { criticalCount: critical, criticalValue, staleCount: stale, staleAfterDays, weighted, target, wonYtd },
    lang,
    (n) => money(n) ?? "",
  );

  return (
    <div className="flex min-h-0 flex-1 items-start gap-[0.7vw] overflow-hidden">
      <span aria-hidden="true" className="shrink-0 leading-none text-violet" style={{ fontSize: "1.6vw" }}>
        &ldquo;
      </span>
      {/* A briefing, not an inventory: the chips beside this panel already carry
          the counts, and a paragraph can say what they mean together. Composed
          from measured figures -- see pulseSentences for the clauses it will
          not write. */}
      <p className="min-w-0 flex-1 self-center text-foreground" style={{ fontSize: "0.86vw", lineHeight: 1.75 }}>
        {lines.join(" ")}
      </p>
      <span aria-hidden="true" className="shrink-0 self-end leading-none text-violet" style={{ fontSize: "1.6vw" }}>
        &rdquo;
      </span>
    </div>
  );
}

/**
 * One check, sized to be read across a room.
 *
 * The colour is the count, not the category: a check at zero is green whatever
 * it measures, because the reader's question is "is anything wrong here", and
 * a red chip showing 0 answers it backwards.
 */
function Signal({
  n, tone, ar, en, note, lang,
}: {
  n: number;
  tone: keyof typeof TONE;
  ar: string;
  en: string;
  note?: string | null;
  lang: "ar" | "en";
}) {
  const clear = n === 0;
  const t = clear ? "won" : tone;
  return (
    <Chip
      tone={t}
      lang={lang}
      figure={
        <span className={`num font-bold leading-none ${TONE[t].text}`} style={{ fontSize: CHIP_FIGURE }} data-tabular="true">
          {formatNumber(n, lang)}
        </span>
      }
      label={
        <span className="w-full truncate font-semibold text-foreground" style={{ fontSize: CHIP_LABEL }}>
          {lang === "ar" ? ar : en}
        </span>
      }
      // Rendered only when there is something to say: a blank line still takes
      // its height and lifts the ink above it off centre.
      note={
        clear || note ? (
          <span className={`w-full truncate ${clear ? TONE[t].text : "text-muted-foreground"}`} style={{ fontSize: CHIP_NOTE }}>
            {clear ? (lang === "ar" ? "✓ لا شيء معلّق" : "✓ nothing pending") : note}
          </span>
        ) : undefined
      }
    />
  );
}

/**
 * The 30 / 60 / 90 outlook.
 *
 * Colour here is distance, not decoration, and it runs the same way as the
 * stage ramp: warm is near and actionable, cool is far and speculative. Thirty
 * days is amber because that is the money you can still affect this month;
 * ninety is teal because nothing you do today lands there.
 *
 * The reason line moved out of the chips. All three horizons fail for the same
 * cause -- no probability, no expected close date -- and printing it three
 * times spent the panel's whole height saying one thing. It collapses only
 * when it is genuinely one thing; see sharedReason.
 */
function Horizons({
  h,
  lang,
  money,
}: {
  h: { d30: Figure; d60: Figure; d90: Figure };
  lang: "ar" | "en";
  money: (n: number | null | undefined) => string | null;
}) {
  const cols = [
    // Each window means something different, and the caption says which. The
    // nearest is what you can still affect; the furthest is upside.
    { key: "d30", f: h.d30, tone: "amber" as const, ar: "30 يومًا", en: "30 days",
      caption: lang === "ar" ? "مرجّح" : "Weighted" },
    { key: "d60", f: h.d60, tone: "violet" as const, ar: "60 يومًا", en: "60 days",
      caption: lang === "ar" ? "الأكثر ترجيحًا" : "Most likely" },
    { key: "d90", f: h.d90, tone: "teal" as const, ar: "90 يومًا", en: "90 days",
      caption: lang === "ar" ? "فرصة إضافية محتملة" : "Potential upside" },
  ];
  const shared = sharedReason([h.d30, h.d60, h.d90], lang);

  return (
    <ChipRow
      // States the window the three labels measure from, and fills the slot
      // that keeps this row level with the two panels beside it.
      kicker={lang === "ar" ? "متوقّع الإغلاق خلال" : "Expected to close within"}
      footer={
        shared ? (
          <span className="flex items-start gap-[0.35vw]">
            <span aria-hidden="true" style={{ fontSize: "0.62vw" }}>ⓘ</span>
            <span className="min-w-0 text-muted-foreground" style={{ fontSize: "0.62vw" }}>{shared}</span>
          </span>
        ) : (
          // Only when the horizons fail for DIFFERENT reasons -- then one line
          // each, named by its horizon.
          <span className="flex flex-col gap-[0.2vh]">
            {cols
              .filter((c) => c.f.state !== "ok" && (lang === "ar" ? c.f.reasonAr : c.f.reasonEn))
              .map((c) => (
                <span key={c.key} className="truncate text-muted-foreground" style={{ fontSize: "0.6vw" }}>
                  <span className={TONE[c.tone].text}>{lang === "ar" ? c.ar : c.en}</span>
                  {" · "}
                  {lang === "ar" ? c.f.reasonAr : c.f.reasonEn}
                </span>
              ))}
          </span>
        )
      }
    >
      {cols.map((c) => {
        const ok = c.f.state === "ok" && c.f.value !== null;
        const state = c.f.state === "not_configured"
          ? lang === "ar" ? "يحتاج إعدادًا" : "Setup required"
          : c.f.state === "not_applicable"
            ? lang === "ar" ? "لا ينطبق" : "Not applicable"
            : lang === "ar" ? "لا يمكن حسابه" : "Not calculated";
        return (
          // No chip box here, unlike the two panels beside it. The reference
          // design shows three plain figures, and it is right: these are the
          // one row on the board that is read as a series -- 30 to 60 to 90 --
          // and three bordered boxes read as three separate facts.
          <div key={c.key} className="flex min-w-0 flex-col items-center justify-center overflow-hidden text-center">
            <span className={`font-semibold ${TONE[c.tone].text}`} style={{ fontSize: "0.7vw" }}>
              {lang === "ar" ? c.ar : c.en}
            </span>
            {ok ? (
              <span
                className={`num mt-[0.3vh] w-full truncate font-bold leading-none tracking-[-0.02em] ${TONE[c.tone].text}`}
                style={{ fontSize: "1.9vw" }}
                data-tabular="true"
              >
                {money(c.f.value)}
              </span>
            ) : (
              // An em dash, not a zero. Nothing was measured here.
              <span className="num mt-[0.3vh] font-bold leading-none text-muted-foreground" style={{ fontSize: "1.9vw" }}>
                —
              </span>
            )}
            <span className="mt-[0.2vh] w-full truncate text-muted-foreground" style={{ fontSize: "0.6vw" }}>
              {ok ? c.caption : state}
            </span>
          </div>
        );
      })}
    </ChipRow>
  );
}

/** A headline card: label and icon, a centred figure with its unit beneath, an
 *  optional gauge, and a footnote. */
function Kpi({
  icon: Icon, tone, lang, ar, en, value, unit, foot, gauge,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE;
  lang: "ar" | "en";
  ar: string;
  en: string;
  value: string | null;
  unit?: string | null;
  foot?: string;
  gauge?: number | null;
}) {
  return (
    <div className="relative flex min-w-0 flex-col overflow-hidden rounded-[0.7vw] border border-border/70 bg-card px-[1.1vw] py-[1.1vh] shadow-sm">
      <div className="flex items-start justify-between">
        <span className="min-w-0 truncate font-semibold text-foreground" style={{ fontSize: "0.88vw" }}>
          {lang === "ar" ? ar : en}
        </span>
        <span
          aria-hidden="true"
          className="grid shrink-0 place-items-center rounded-[0.45vw]"
          style={{
            width: "1.9vw",
            height: "1.9vw",
            fontSize: "0.95vw",
            background: TONE[tone].wash,
            color: TONE[tone].edge,
          }}
        >
          <Icon className="h-[1.05vw] w-[1.05vw]" strokeWidth={2.25} aria-hidden="true" />
        </span>
      </div>

      {/* Centred, with the unit UNDER the figure rather than beside it. The eye
          lands on the magnitude first, the unit stays available without
          competing for the same line, and five cards holding different digit
          counts still line up with one another. */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-[0.6vw]">
        <div className="flex min-w-0 flex-col items-center">
          <span
            className={`num font-bold leading-none tracking-[-0.02em] ${TONE[tone].text}`}
            style={{ fontSize: "3.2vw" }}
          >
            {value ?? "\u2014"}
          </span>
          {unit ? (
            <span className="mt-[0.45vh] w-full truncate text-center text-muted-foreground" style={{ fontSize: "0.74vw" }}>
              {unit}
            </span>
          ) : null}
        </div>

        {/* A half donut beside the figure, as the reference shows it -- not a
            bar under it. A ratio is an angle before it is a length: the arc
            says "about a third" at a glance, and the number beside it is there
            to be exact. */}
        {gauge !== undefined && gauge !== null ? <Gauge value={gauge} tone={tone} /> : null}
      </div>

      <span className="text-center text-muted-foreground" style={{ fontSize: "0.68vw" }}>
        {foot ?? en}
      </span>
    </div>
  );
}

/**
 * The target-achievement dial.
 *
 * One arc drawn twice: the track is the whole half circle, the value is the
 * same path dashed to its fraction. Two paths and no library.
 *
 * Clamped at 1 on purpose. Past target is good news, and an arc sweeping back
 * around past its own start would read as bad -- the figure beside it already
 * says 140% when 140% is true.
 */
function Gauge({ value, tone }: { value: number; tone: keyof typeof TONE }) {
  const pct = Math.max(0, Math.min(value, 1));
  const LEN = Math.PI * 40;   // a half circle of radius 40
  return (
    <svg viewBox="0 0 100 56" className="h-[3vw] w-[3vw] shrink-0" aria-hidden="true">
      <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="var(--muted)" strokeWidth="11" strokeLinecap="round" />
      <path
        d="M 10 50 A 40 40 0 0 1 90 50"
        fill="none"
        stroke={TONE[tone].edge}
        strokeWidth="11"
        strokeLinecap="round"
        strokeDasharray={`${LEN * pct} ${LEN}`}
      />
    </svg>
  );
}

/** The same card for a figure whose inputs may not exist. */
function KpiFigure({
  icon: Icon, f, lang, money, ar, en, tone, foot,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE;
  f: Figure;
  lang: "ar" | "en";
  money: (n: number | null | undefined) => string | null;
  ar: string;
  en: string;
  /** The line under the figure. Null when there is nothing true to put there. */
  foot?: string | null;
}) {
  return (
    <div className="relative flex min-w-0 flex-col overflow-hidden rounded-[0.7vw] border border-border/70 bg-card px-[1.1vw] py-[1.1vh] shadow-sm">
      <div className="flex items-start justify-between">
        <span className="font-semibold text-foreground" style={{ fontSize: "0.88vw" }}>
          {lang === "ar" ? ar : en}
        </span>
        <span
          aria-hidden="true"
          className="grid shrink-0 place-items-center rounded-[0.45vw]"
          style={{
            width: "1.9vw",
            height: "1.9vw",
            fontSize: "0.95vw",
            background: TONE[tone].wash,
            color: TONE[tone].edge,
          }}
        >
          <Icon className="h-[1.05vw] w-[1.05vw]" strokeWidth={2.25} aria-hidden="true" />
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <FigureValue f={f} lang={lang} format={(n) => money(n)} size="3.2vw" />
      </div>
      {/* The other four cards carry a line saying what the number means next
          to. This one used to carry its own English title instead, which is
          the bilingual pair the board no longer prints. */}
      {foot ? (
        <span className={`text-center ${TONE[tone].text}`} style={{ fontSize: "0.68vw" }}>{foot}</span>
      ) : null}
    </div>
  );
}

/** A panel with a titled header, matching the mockup's card chrome. */
function Panel({
  title, icon: Icon, tone, lang, note, children, dark,
}: {
  title: string;
  icon: LucideIcon;
  tone: keyof typeof TONE;
  /**
   * Darkens the whole panel, as the supplied reference does for this one.
   *
   * It inverts the panel's text colours with it. A dark ground under
   * `text-foreground` is how a card ends up black on near-black -- the
   * background and the ink are one decision, never two.
   */
  dark?: boolean;
  lang: "ar" | "en";
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[0.7vw] border px-[1vw] py-[0.8vh] shadow-sm ${
        dark ? "board-dark border-white/10" : "border-border/70 bg-card"
      }`}
    >
      <div className="mb-[0.5vh] flex items-baseline justify-between">
        <span className="flex items-baseline gap-[0.4vw]">
          <span
            aria-hidden="true"
            className="grid shrink-0 place-items-center rounded-[0.35vw]"
            style={{ width: "1.4vw", height: "1.4vw", fontSize: "0.78vw", background: TONE[tone].wash, color: TONE[tone].edge }}
          >
            <Icon className="h-[0.85vw] w-[0.85vw]" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <span className={`font-semibold ${TONE[tone].text}`} style={{ fontSize: "0.92vw" }}>{title}</span>
        </span>
        {note ? <span className="text-muted-foreground" style={{ fontSize: "0.66vw" }}>{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** One "needs attention" figure. `null` means the input does not exist. */
function Need({
  n, ar, en, sub, tone, lang, icon: Icon, dark,
}: {
  /**
   * Measured, not guessed: on the panel's #0f1a26 ground `text-foreground`
   * comes out at 1.04:1 and `text-muted-foreground` at 3.63 -- the first is
   * invisible and the second fails body text. White is 17.56 and white/70 is
   * 8.61, so the card inverts with the panel rather than keeping its own ink.
   */
  dark?: boolean;
  /** Every figure on this board carries one; these four were the exception. */
  icon: LucideIcon;
  n: number | null;
  ar: string;
  en: string;
  sub: string;
  tone: keyof typeof TONE;
  lang: "ar" | "en";
}) {
  return (
    <div className="flex flex-col justify-center border-e border-border/50 pe-[0.5vw] last:border-e-0">
      <div className="flex items-baseline gap-[0.4vw]">
        <span className={`num font-bold leading-none ${n === null ? "text-muted-foreground" : TONE[tone].text}`}
              style={{ fontSize: n === null ? "1.2vw" : "2.5vw" }}>
          {n === null ? (lang === "ar" ? "لا بيانات" : "No data") : formatNumber(n, lang)}
        </span>
          <span
            aria-hidden="true"
            className="grid shrink-0 place-items-center rounded-[0.35vw]"
            style={{
              width: "1.5vw", height: "1.5vw", fontSize: "0.8vw",
              background: TONE[tone].wash, color: TONE[tone].edge,
            }}
          >
            <Icon className="h-[0.85vw] w-[0.85vw]" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <span
            className={`min-w-0 truncate font-semibold ${dark ? "text-white" : "text-foreground"}`}
            style={{ fontSize: "0.8vw" }}
          >
            {lang === "ar" ? ar : en}
          </span>
      </div>
      <span
        className={`w-full truncate ${dark ? "text-white/70" : "text-muted-foreground"}`}
        style={{ fontSize: "0.65vw" }}
      >
        {sub}
      </span>
    </div>
  );
}

/**
 * One "changed since yesterday" tile.
 *
 * Same skeleton as the pulse and the forecast -- figure, one label, an optional
 * note beneath -- so the nine chips across that row read as one family. It used
 * to print BOTH labels stacked, which is the board's convention in a panel
 * header but not in a chip, and it was the visible odd one out.
 *
 * What is deliberately NOT copied is the pulse's rule that zero turns green.
 * There, zero means a check came back clear. Here it means nothing was won and
 * nothing moved, which is the opposite of good news; a green "0 deals won"
 * would be the board congratulating itself on a dead week.
 */
function Mini({
  n, value, ar, en, tone, lang, icon: Icon,
}: {
  n: number;
  /** Shown above the figure, as in the reference design. */
  icon: LucideIcon;
  value?: string | null;
  ar: string;
  en: string;
  tone: keyof typeof TONE;
  lang: "ar" | "en";
}) {
  const moved = n > 0;
  return (
    <Chip
      tone={tone}
      lang={lang}
      figure={
        <span className="flex flex-col items-center gap-[0.1vh]">
          {Icon ? (
            <Icon className={`h-[0.85vw] w-[0.85vw] ${TONE[tone].text}`} strokeWidth={2.25} aria-hidden="true" />
          ) : null}
          <span
            className={`num font-bold leading-none ${moved ? TONE[tone].text : "text-muted-foreground"}`}
            style={{ fontSize: CHIP_FIGURE }}
            data-tabular="true"
          >
            {moved ? "+" : ""}{formatNumber(n, lang)}
          </span>
        </span>
      }
      label={
        <span className="w-full truncate font-semibold text-foreground" style={{ fontSize: CHIP_LABEL }}>
          {lang === "ar" ? ar : en}
        </span>
      }
      // "No movement" belongs to a zero and nothing else. Keying it off the
      // value instead printed it under "+88 new deals" -- a true count above a
      // false caption.
      note={
        <span className={`num w-full truncate ${moved && value ? TONE[tone].text : "text-muted-foreground"}`} style={{ fontSize: CHIP_NOTE }}>
          {moved
            ? (value ?? (lang === "ar" ? "بلا قيمة مسجَّلة" : "no value recorded"))
            : lang === "ar" ? "بلا حركة" : "no movement"}
        </span>
      }
    />
  );
}
