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
// TYPE SIZE IS TIED TO THE SCREEN, WITH A FLOOR
// This is a wall display, so the type scales with the viewport rather than with
// the app's rem scale -- a 55" screen and a 24" one should both fill. What it
// must not do is keep shrinking: below about 1100px the bare vw sizes fell
// under 10px, which is unreadable at any distance. Every size is clamped
// between what it would be on a 1280px window and on a 2560px one.
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
  AlertTriangle, Award, BarChart3, CalendarClock, CalendarDays, CheckCircle2,
  CircleX, FileText, Filter, Flag, Flame, Handshake, Inbox, PauseCircle,
  PieChart, RefreshCw, TrendingUp, Users,
  type LucideIcon,
} from "lucide-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  attentionQueues,
  bucket,
  closingList,
  daysSince,
  pipelineByRoute,
  redFlags2025,
  repSummary,
  rfqIntake,
  targetYtd,
  toRec,
  verbalAwards,
  type Bucket,
  type ClosingOpp,
  type Rec,
} from "@/lib/board-closing";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canonicalStageOf, inPeriod, isWon, winRate, wonDate, yearToDate } from "@/lib/sales-kpis";
import { fetchRequiredRows } from "@/lib/fetch-all";
import { supabase } from "@/integrations/supabase/client";
import { dueForRefresh, keepAlive } from "@/lib/session-keepalive";
import { useI18n, formatNumber, localeFor } from "@/lib/i18n";
import { requiresConversionReview } from "@/lib/dashboard-helpers";
import { formatRate, rate, riyadhDay, teamDay } from "@/lib/daily-tasks";
import {
  attentionItems,
  hotOpportunities,
  horizonForecast,
  pipelineBuckets,
  pipelineCoverage,
  weightedPipeline,
  upcoming,
  wireItems,
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
const STALLED_AFTER_DAYS = 10;

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
  // Renamed 2026-11-17: "Contractor holds it" was read as a hold. sales_stage
  // jih is a submitted quotation awaiting the decision; holds are on_hold.
  jih: ["مقدَّم بانتظار القرار", "Quoted · awaiting decision"],
  jih_bafo: ["BAFO", "BAFO"],
  under_negotiation: ["تفاوض", "Negotiation"],
  verbally_awarded: ["ترسية شفهية", "Verbal award"],
  contract_received: ["استُلم العقد", "Contract in"],
  contract_signed: ["عقد موقّع", "Signed"],
  on_hold: ["معلّقة", "On hold"],
};

/** Only complete successful source reads reach this model. */
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

/** The sales team: salespeople with no management role (board_sales_reps). */
async function fetchSalesReps(): Promise<{ user_id: string; full_name: string | null }[]> {
  const { data, error } = await supabase.rpc("board_sales_reps" as never);
  if (error) throw error;
  return (data ?? []) as { user_id: string; full_name: string | null }[];
}

/** "abdelrahman jarrah" → "Abdelrahman". A wall reads a first name faster than initials. */
function firstName(full: string | null): string {
  const f = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return f ? f[0].toUpperCase() + f.slice(1) : "—";
}

function useBoardData() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["board", user?.id],
    enabled: !!user,
    refetchInterval: POLL_MS,
    // React Query pauses interval refetching when the tab loses focus. On a
    // desk that is a kindness; on a wall it is a defect -- a screensaver, a
    // second tab, or the OS backgrounding the kiosk would freeze the numbers
    // while the page still looked live. The freshness indicator would catch it
    // eventually, but the right answer is not to stop polling in the first
    // place. A wall display has no user to come back and wake it.
    refetchIntervalInBackground: true,
    // Catch up immediately when a laptop tab or network returns.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: POLL_MS / 2,
    queryFn: async () => {
      const [opps, approvals, followUps, quotations, tenders, inbox, targets, profiles, moves] =
        await Promise.all([
          fetchRequiredRows(() => supabase.from("opportunities").select(
            "id, project_name, client, owner_id, stage, sales_stage, contract_value, quotation_value, estimated_value_max, human_win_probability, expected_contract_date, next_action, next_action_due, last_activity_at, won_at, lost_at, created_at, extra_data, hold_reason, contract_signed_date, contract_received_date",
          ).neq("stage", "archived").order("id")),
          fetchRequiredRows(() => supabase.from("approvals").select("created_at").eq("status", "pending").order("id")),
          fetchRequiredRows(() => supabase.from("follow_ups").select("opportunity_id, due_date, status, updated_at").in("status", ["scheduled", "completed"]).order("id")),
          // The restricted view preserves the display account's quotation scope.
          fetchRequiredRows(() => supabase.from("board_quotation_pulse").select("valid_until, status").order("id")),
          fetchRequiredRows(() => supabase.from("tenders").select("tender_stage, created_at").is("archived_at", null).order("id")),
          fetchRequiredRows(() => supabase.from("leads").select("id").eq("lead_stage", "detected").is("archived_at", null).order("id")),
          fetchRequiredRows(() => supabase.from("sales_targets").select("user_id, sales_target, period_type, period_start").order("id")),
          fetchRequiredRows(() => supabase.from("profiles").select("id, full_name").order("id")),
          fetchRequiredRows(() => supabase.from("stage_transition_history").select("changed_at:created_at, to_stage")
            .eq("record_type", "opportunity").gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("id")),
        ]);
      // Daily completion: counts only, never titles (wall display).
      const day = riyadhDay();
      const [doneToday, salesReps] = await Promise.all([teamDay(day), fetchSalesReps()]);
      return { opps, approvals, followUps, quotations, tenders, inbox, targets, profiles, moves, doneToday, salesReps };
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

/**
 * The alternating row ground.
 *
 * Asked for on 2026-09-06: white, then a light grey, then white. Bands are
 * how a wall of twelve cards stops reading as one field of white -- the eye
 * gets a horizontal rule it does not have to look for.
 *
 * `--muted` measures 1.17:1 against the white card and 1.06:1 against the page
 * behind both, which is visible across a room and still leaves body text at
 * 5.10:1 and figures at 15.41:1. `--surface-2` was the first choice and is
 * 1.06:1 against white -- a difference that exists in the stylesheet and not
 * on the screen.
 */
function bandClass(band?: boolean) {
  return band ? "bg-muted" : "bg-card";
}


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
        style={{ fontSize: "clamp(40px, 3.9vw, 100px)" }}
        data-tabular="true"
      >
        {value ?? "—"}
      </div>
      <div className="mt-[0.9vh] font-semibold text-foreground" style={{ fontSize: "clamp(12px, 1.02vw, 26px)" }}>
        {en}
      </div>
      {sub ? (
        <div className="mt-[0.4vh] text-muted-foreground" style={{ fontSize: "clamp(12px, 0.72vw, 18px)" }}>
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
        style={{ fontSize: "clamp(27px, 2.6vw, 67px)" }}
        data-tabular="true"
      >
        {value ?? "—"}
      </div>
      <div className="mt-[0.6vh] font-semibold text-foreground" style={{ fontSize: "clamp(12px, 0.86vw, 22px)" }}>
        {en}
      </div>
      {sub ? (
        <div className="text-muted-foreground" style={{ fontSize: "clamp(12px, 0.66vw, 17px)" }}>
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
        <span className="font-semibold text-foreground" style={{ fontSize: "clamp(12px, 0.92vw, 24px)" }}>
          {lang === "ar" ? "المُرسّى — ستّة أشهر" : "Won — six months"}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-end gap-[0.6vw]">
        {points.map((p, i) => {
          const h = peak > 0 ? (p.value / peak) * 100 : 0;
          const last = i === points.length - 1;
          return (
            <div key={p.key} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-[0.4vh]">
              <span className="num text-center text-muted-foreground" style={{ fontSize: "clamp(12px, 0.72vw, 18px)" }}>
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
              <span className="text-center text-muted-foreground" style={{ fontSize: "clamp(12px, 0.66vw, 17px)" }}>
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
          <span className="font-semibold text-foreground" style={{ fontSize: "clamp(12px, 1.05vw, 27px)" }}>
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
            style={{ fontSize: "clamp(25px, 2.4vw, 61px)" }}
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
              style={{ fontSize: "clamp(22px, 2.1vw, 54px)" }}
            >
              {compactValue(p.won, lang)}
            </span>
            {p.target ? (
              <>
                <span
                  className="num leading-none text-muted-foreground"
                  style={{ fontSize: "clamp(15px, 1.5vw, 38px)", opacity: 0.6 }}
                >
                  /
                </span>
                <span
                  className="num font-semibold leading-none text-muted-foreground"
                  style={{ fontSize: "clamp(15px, 1.5vw, 38px)" }}
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

      <div className="flex justify-between text-muted-foreground" style={{ fontSize: "clamp(12px, 0.72vw, 18px)" }}>
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
              style={{ fontSize: "clamp(12px, 0.8vw, 20px)", width: "8vw" }}
            >
              {STAGE_LABEL[c.stage]?.[lang === "ar" ? 0 : 1] ?? c.stage}
            </span>

            <span className="relative h-[1.35vh] min-w-0 flex-1 overflow-hidden rounded-[0.2vw] bg-muted">
              <span
                className="absolute inset-y-0 start-0 rounded-[0.2vw]"
                style={{ width: `${w}%`, background: c.stage === "on_hold" ? "var(--muted-foreground)" : `var(--stage-${i + 1})` }}
              />
              {/* Deals here, but nothing priced. A bare track would read as an
                  empty stage; this marks it as unpriced instead. */}
              {!empty && c.value === 0 ? (
                <span
                  className="absolute inset-y-0 start-0"
                  style={{ width: "0.5vw", background: c.stage === "on_hold" ? "var(--muted-foreground)" : `var(--stage-${i + 1})`, opacity: 0.5 }}
                />
              ) : null}
            </span>

            <span
              className="num shrink-0 text-end font-semibold text-foreground"
              style={{ fontSize: "clamp(12px, 0.85vw, 22px)", width: "3.2vw" }}
              data-tabular="true"
            >
              {formatNumber(c.count, lang)}
            </span>
            <span
              className="num shrink-0 text-end text-muted-foreground"
              style={{ fontSize: "clamp(12px, 0.8vw, 20px)", width: "6vw" }}
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
        <span className="text-muted-foreground" style={{ fontSize: "clamp(12px, 0.72vw, 18px)" }}>
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
      <div className="mt-[0.9vh] font-semibold text-foreground" style={{ fontSize: "clamp(12px, 1.02vw, 26px)" }}>
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
    const openIds = new Set(opps.filter((o) => {
      const stage = canonicalStageOf(o);
      return stage && stage !== "won" && stage !== "lost";
    }).map((o) => o.id));
    const allFollowUps = rows<{ opportunity_id: string; due_date: string | null; status: string; updated_at: string | null }>(data.followUps);
    const scheduledFollowUps = allFollowUps.filter((f) => f.status === "scheduled" && openIds.has(f.opportunity_id));
    const pulse = computePulse({
      approvalsPendingAt: rows<{ created_at: string }>(data.approvals).map((r) => r.created_at),
      followUpDueDates: scheduledFollowUps.map((r) => r.due_date),
      quotationDueDates: rows<{ valid_until: string | null; status: string | null }>(data.quotations).filter((q) => q.status && ["submitted", "follow_up", "negotiation", "revised"].includes(q.status)).map((r) => r.valid_until),
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
    const standing = computeStanding(opps, nowDate, null);

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
    // Win rate this year: the engine's winRate over the Riyadh year to date —
    // won ÷ (won + lost) by close date, so a deal won in 2024 and synced today
    // is not counted as this year's decision.
    const ytd = yearToDate(riyadhDay(nowDate));
    const wr = winRate(intel as never, { today: ytd.from, period: ytd });
    const wonThisYear = intel.filter((o) => isWon(o as never) && inPeriod(wonDate(o as never), ytd)).length;
    // The closing view (Mo, 2026-11-17), from the November 2026 master list.
    const today = riyadhDay(nowDate);
    const recs = opps.map((o) => toRec(o as unknown as ClosingOpp));
    const closing = {
      recs,
      today,
      verbal: verbalAwards(recs),
      list: closingList(recs, Number(today.slice(0, 4))),
      route: pipelineByRoute(recs),
      rfq: rfqIntake(recs, today),
      target: targetYtd(recs, today, annual),
      queues: attentionQueues(recs, today),
      flags: redFlags2025(recs, today),
    };
    return {
      closing,
      winRate: { won: wonThisYear, lost: wr.recordCount - wonThisYear, ratio: wr.value === null ? null : wr.value / 100 },
      pulse,
      standing,
      team: computeTeam(opps, targets, labels, nowDate, null, true),
      trend: wonTrend(opps, nowDate, 6),
      year: yearProgress(opps, annual, nowDate),
      buckets: pipelineBuckets(intel),
      weighted,
      coverage: pipelineCoverage(weighted, annual),
      horizon: horizonForecast(intel, nowDate),
      // Twelve, not five. The panel auto-scrolls, and a list that fits its
      // box has nothing to scroll: five rows sat still while the request was
      // for movement. Twelve overflows a panel that shows about six, so the
      // marquee has somewhere to go -- and the footer totals the twelve it
      // draws rather than a five it no longer shows.
      // Twenty, and the count is not decoration: the panel scrolls only when
      // its content overflows its box, so every time the box grew the list
      // stopped moving. Fifteen rows came to 200px in a 197px box -- three
      // pixels of overflow against a threshold of eight, and the marquee sat
      // still. The row is taller again now, so the list is longer again.
      hot: hotOpportunities(intel, 20),
      yoy: yearOnYear(opps, nowDate),
      oldestOverdue: oldestOverdueDays(
        scheduledFollowUps.map((f) => f.due_date),
        nowDate,
      ),
      upcoming: upcoming(
        scheduledFollowUps.map((f) => f.due_date),
        nowDate,
      ),
      movement: movement(
        intel,
        rows<{ changed_at: string | null; to_stage: string | null }>(data.moves),
        nowDate,
        1,
        {
          importedSource: "PHC Quotation List 2022-2026",
          followUps: allFollowUps,
        },
      ),
      attention: attentionItems(
        intel,
        scheduledFollowUps,
        nowDate,
        { stalledAfterDays: STALLED_AFTER_DAYS },
      ),
      labels,
    };
  }, [data, nowDate]);

  // Team performance: the sales team only (AB → Abdelrahman, FA → Faisal by
  // ownership), each with today's completion and the closing figures.
  const salesTeam = useMemo<SalesCardRow[]>(() => {
    if (!model || !data) return [];
    return data.salesReps.map((r) => {
      const day = data.doneToday.find((d) => d.user_id === r.user_id);
      return {
        ownerId: r.user_id,
        name: firstName(r.full_name),
        initials: displayLabel(r.full_name),
        s: repSummary(model.closing.recs, r.user_id, model.closing.today),
        done: day?.done ?? 0,
        openDue: day?.open_due ?? 0,
      };
    });
  }, [model, data]);

  // Every total opens the records behind it.
  const [drill, setDrill] = useState<{ title: string; note?: string; rows: Rec[] } | null>(null);
  const openList = (title: string, rows: Rec[], note?: string) => setDrill({ title, rows, note });

  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat(localeFor(lang), { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(d);
  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat(localeFor(lang), {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    }).format(d);

  return (
    // The board's own language decides its direction, not the app's toggle:
    // English text laid out right-to-left mirrored every row and put the
    // clock's "AM" and the slogan's full stop on the wrong end.
    <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="flex h-screen w-screen flex-col overflow-hidden" style={{ background: "color-mix(in srgb, var(--info) 4%, var(--muted))" }}>
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
            <span className="font-semibold leading-none text-foreground" style={{ fontSize: "clamp(15px, 1.5vw, 38px)" }}>
              {lang === "ar" ? "مركز قيادة المبيعات" : "Sales Command Centre"}
            </span>
            <span className="mt-[0.45vh] text-muted-foreground" style={{ fontSize: "clamp(12px, 0.75vw, 19px)" }}>
              {lang === "ar" ? "وضوحٌ يُصنَع ويُركَّب." : "Clarity, built into place."}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-[1.3vw] text-muted-foreground" style={{ fontSize: "clamp(12px, 0.85vw, 22px)" }}>
          <Dot f={fresh} lang={lang} />
          <span data-testid="board-last-updated">{dataUpdatedAt ? `Updated ${fmtTime(new Date(dataUpdatedAt))} · every 60s` : "Waiting for data"}</span>
          <span className="h-[2.4vh] w-px bg-border" aria-hidden="true" />
          <span className="num">{fmtDate(nowDate)}</span>
          <span className="h-[2.4vh] w-px bg-border" aria-hidden="true" />
          <span className="num font-semibold text-foreground" style={{ fontSize: "clamp(12px, 1.05vw, 27px)" }}>{fmtTime(nowDate)}</span>
        </div>
      </header>

      {fresh !== "live" ? (
        <div
          className={`shrink-0 px-[1.5vw] py-[0.6vh] text-center font-semibold ${
            fresh === "stale" ? "bg-destructive/12 text-destructive-on-tint" : "bg-amber/12 text-amber-on-tint"
          }`}
          style={{ fontSize: "clamp(12px, 0.85vw, 22px)" }}
        >
          {fresh === "stale"
            ? lang === "ar" ? "الاتصال منقطع — الأرقام أدناه قديمة ولا يُبنى عليها قرار" : "Update unavailable — showing the last complete data"
            : lang === "ar" ? "التحديث متأخّر" : "Update is late"}
        </div>
      ) : null}

      {!model ? (
        <div className="grid flex-1 place-items-center text-muted-foreground" style={{ fontSize: "clamp(12px, 1.2vw, 31px)" }}>
          {isError ? (lang === "ar" ? "تعذّر تحميل البيانات — ستتم إعادة المحاولة تلقائيًا" : "Data unavailable — retrying automatically") : (lang === "ar" ? "يُحمّل…" : "Loading…")}
        </div>
      ) : (
        <main
          className={`grid min-h-0 flex-1 gap-[0.8vh] px-[1.2vw] py-[1vh] ${fresh === "stale" ? "opacity-45" : ""}`}
          // Explicit fractions, not `auto`. With the top two rows content-sized
          // the table row swallowed everything left over and towered over the
          // cards above it.
          style={{
            // The lists row grew and the headline cards gave it the room: five
            // big figures need less height than three tables do, and the
            // tables were the ones running out.
            gridTemplateRows:
              "minmax(0,0.9fr) minmax(0,0.85fr) minmax(0,1.78fr) minmax(0,1.02fr)",
          }}
        >
          <div className="grid grid-cols-5 gap-[0.7vw]">
            {/* Achieved = confirmed Won only, by award date, Riyadh calendar.
                No contract date is recorded yet, so the date basis is printed. */}
            <Kpi
              icon={TrendingUp} tone="won" lang={lang}
              ar="الإنجاز منذ بداية السنة" en="Won year to date"
              value={splitCompact(model.closing.target.won.value, lang)?.n ?? null}
              unit={splitCompact(model.closing.target.won.value, lang)?.unit}
              foot={`${model.closing.target.won.count} won · ${model.closing.target.listDated ? "award date from the master list (no contract date entered)" : "by contract date"}${model.closing.target.undated.count ? ` · ${model.closing.target.undated.count} won without a date` : ""}`}
              onOpen={() => openList("Won year to date", model.closing.target.won.rows, "Confirmed Won only. Verbal awards and open quotations are excluded. Date basis: the award date recorded from the master list; no contract or PO date has been entered.")}
            />
            <Kpi
              icon={Award} tone="danger" lang={lang}
              ar="ترسيات شفهية" en="Critical · verbal awards"
              value={splitCompact(model.closing.verbal.all.value, lang)?.n ?? null}
              unit={`${model.closing.verbal.confirmed.count} confirmed (E) · ${model.closing.verbal.reconcile.count} to reconcile (A)`}
              foot="Secure the written award, PO or contract — not counted as won"
              onOpen={() => openList("Critical deals · verbal awards", model.closing.verbal.all.rows, "Column E 'Verbally Awarded' (confirmed) plus column A 'PRIORITY - A (VERB-AWARDED)' whose current status is still open (status to reconcile). Neither is counted as won.")}
            />
            <Kpi
              icon={Filter} tone="teal" lang={lang}
              ar="مسار JIH المفتوح" en="Open pipeline · JIH"
              value={splitCompact(model.closing.route.jih.active.value, lang)?.n ?? null}
              unit={`${model.closing.route.jih.active.count} active JIH (contractor, direct, consultant)`}
              foot={`Held ${model.closing.route.jih.held.count} · ${money(model.closing.route.jih.held.value) ?? "—"} · Tender shown separately`}
              onOpen={() => openList("Open JIH opportunities (active)", model.closing.route.jih.active.rows, "JIH is the project classification (column G); it does not mean PHC has won the signage. Won, lost and dead records excluded; held JIH listed under Pipeline health.")}
            />
            <Kpi
              icon={Inbox} tone="info" lang={lang}
              ar="طلبات تسعير آخر 30 يومًا" en="RFQs received · 30 days"
              value={formatNumber(model.closing.rfq.last30.count, lang)}
              unit={`value ${money(model.closing.rfq.last30.value) ?? "not priced yet"}`}
              foot={`RFQ received date missing on ${model.closing.rfq.missing.count} of ${model.closing.recs.length} (${Math.round((model.closing.rfq.coverage ?? 0) * 100)}% covered)`}
              onOpen={() => openList("RFQs received in the past 30 days", model.closing.rfq.last30.rows, "By the actual RFQ received date from the linked master-list record. Next-action and last-update dates are never used instead.")}
            />
            <Kpi
              icon={PieChart}
              tone={model.closing.target.ratio !== null && model.closing.target.ratio >= model.year.yearElapsed ? "won" : "amber"}
              lang={lang}
              ar="تحقيق الهدف السنوي" en="Annual target 2026"
              value={model.closing.target.ratio === null ? null : `${formatNumber(Math.round(model.closing.target.ratio * 100), lang)}%`}
              unit={model.closing.target.target ? `of ${compactValue(model.closing.target.target, lang)} · remaining ${compactValue(model.closing.target.remaining, lang)}` : "No target set for this year"}
              gauge={model.closing.target.ratio}
              foot={model.closing.target.quarters.map((q, i) => `Q${i + 1} ${q.value ? compactValue(q.value, lang) : "0"}`).join(" · ")}
              onOpen={() => openList("Won toward the 2026 target", model.closing.target.won.rows, "Target SAR 40M (sum of the 2026 annual targets). Won only; quarter by award date.")}
            />
          </div>
          <div className="grid grid-cols-[1.55fr_1fr] gap-[0.7vw]">
            <Panel band title={lang === "ar" ? "يتطلّب الانتباه" : "Needs attention · column A"} icon={AlertTriangle} tone="danger" lang={lang}
                   note={`Dead ${model.closing.queues.excludedDead} and not-priority ${model.closing.queues.excludedNotPriority} excluded`}>
              <div className="grid flex-1 grid-cols-5 gap-[0.6vw]">
                <Need icon={Award} n={model.closing.queues.closing.count} ar="إغلاق" en="Closing queue"
                      sub={`Priority A · ${money(model.closing.queues.closing.value) ?? "—"}`} tone="danger" lang={lang}
                      onOpen={() => openList("Closing queue · PRIORITY - A (VERB-AWARDED)", model.closing.queues.closing.rows)} />
                <Need icon={CalendarClock} n={model.closing.queues.followUp.count} ar="متابعة" en="Follow-up queue"
                      sub={`Need follow-up · ${money(model.closing.queues.followUp.value) ?? "—"}`} tone="amber" lang={lang}
                      onOpen={() => openList("Follow-up queue · NEED FOLLOW-UP", model.closing.queues.followUp.rows)} />
                <Need icon={Flame} n={model.closing.queues.secondary.count} ar="أولوية B" en="Priority B"
                      sub={`Secondary · ${money(model.closing.queues.secondary.value) ?? "—"}`} tone="violet" lang={lang}
                      onOpen={() => openList("Secondary priority · PRIORITY B", model.closing.queues.secondary.rows)} />
                <Need icon={PauseCircle} n={model.closing.queues.holdReview.count} ar="مراجعة المعلّق" en="Hold review"
                      sub={`On hold · ${money(model.closing.queues.holdReview.value) ?? "—"}`} tone="info" lang={lang}
                      onOpen={() => openList("Hold review", model.closing.queues.holdReview.rows, "Held deals with the source wording (column A 'ON-HOLD' or stage On hold) and the hold reason where recorded.")} />
                <Need icon={CircleX} n={model.closing.queues.overdue.count} ar="إجراءات متأخّرة" en="Overdue actions"
                      sub={model.closing.queues.missingDate.count ? `${model.closing.queues.missingDate.count} without a date` : "by next action date (F)"} tone="danger" lang={lang}
                      onOpen={() => openList("Overdue actions in the queues", model.closing.queues.overdue.rows, "Next action date (column F) before today. Records with no date are not counted as overdue.")} />
              </div>
            </Panel>

            <Panel band title={lang === "ar" ? "اليوم / الأيام السبعة القادمة" : "Today / next seven days"} icon={CalendarDays} tone="info" lang={lang}>
              {model.upcoming === null ? (
                <div className="flex flex-1 flex-col justify-center gap-[0.4vh]">
                  <span className="font-semibold text-amber-on-tint" style={{ fontSize: "clamp(12px, 1.15vw, 29px)" }}>
                    {lang === "ar" ? "لا شيء مجدوَل بعد اليوم" : "Nothing scheduled ahead"}
                  </span>
                  <span className="text-muted-foreground" style={{ fontSize: "clamp(12px, 0.92vw, 24px)" }}>
                    {lang === "ar"
                      ? "كل المتابعات متأخّرة — الأجندة فارغة لا خالية"
                      : "Every follow-up is overdue — the calendar is empty, not clear"}
                  </span>
                </div>
              ) : (
                <div className="flex flex-1 flex-col justify-center gap-[0.25vh]" style={{ fontSize: "clamp(12px, 1.02vw, 26px)" }}>
                  {([
                    [lang === "ar" ? "اليوم" : "Today", model.upcoming.todayCount],
                    [lang === "ar" ? "غدًا" : "Tomorrow", model.upcoming.tomorrowCount],
                    [lang === "ar" ? "الأيام 2–7" : "Days 2–7", model.upcoming.weekCount],
                  ] as const).map(([l, n]) => (
                    <div key={l} className="flex items-baseline justify-between border-b border-border/40 pb-[0.2vh]">
                      <span className="text-muted-foreground">{l}</span>
                      <span className="num font-semibold text-foreground" data-tabular="true">{formatNumber(n, lang)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* Not three equal columns. Top opportunities is a list of names and
          money that has to stay readable from across a room; team
          performance is four short rows of initials and figures and was
          holding a third of the width to show them. */}
          <div className="grid min-h-0 grid-cols-[1.7fr_1.1fr_0.8fr] gap-[0.7vw]">
            <Panel title={lang === "ar" ? "فرص الإغلاق ذات الأولوية" : "Priority opportunities to close"} icon={Flame} tone="amber" lang={lang}
                   note="Verbal award → 2026 JIH-Direct → column A · value second">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-[0.5vw] pb-[0.4vh] text-muted-foreground" style={{ fontSize: "clamp(12px, 0.72vw, 18px)" }}>
                  <span className="min-w-0 flex-1">Project · next action</span>
                  <span className="shrink-0" style={{ width: "5vw" }}>Rep</span>
                  <span className="shrink-0 text-end" style={{ width: "4.6vw" }}>Value</span>
                  <span className="shrink-0" style={{ width: "7vw" }}>Status · priority</span>
                  <span className="shrink-0 text-end" style={{ width: "4.4vw" }}>Updated</span>
                  <span className="shrink-0 text-end" style={{ width: "4.4vw" }}>Next date</span>
                </div>
                <AutoScroll className="flex min-h-0 flex-1 flex-col">
                  {[
                    ...model.closing.list.groups.map((g) => ({ key: g.key, title: CLOSING_GROUP[g.key], rows: g.rows })),
                    { key: "holds", title: "Held · separate until there is an action to release the hold", rows: model.closing.list.holds.rows },
                  ].filter((g) => g.rows.length > 0).map((g) => (
                    <div key={g.key} className="flex flex-col">
                      <div className="sticky top-0 bg-card pt-[0.3vh] font-semibold text-amber-on-tint" style={{ fontSize: "clamp(12px, 0.74vw, 19px)" }}>
                        {g.title} · {g.rows.length}
                      </div>
                      {g.rows.map((r, i) => (
                        <ClosingRow key={r.id} r={r} zebra={i % 2 === 1} rep={r.ownerId ? model.labels.get(r.ownerId) ?? "—" : "No owner"} money={money} today={model.closing.today} />
                      ))}
                    </div>
                  ))}
                </AutoScroll>
                <button type="button" onClick={() => openList("Priority opportunities to close", model.closing.list.groups.flatMap((g) => g.rows))}
                        className="flex shrink-0 items-baseline justify-between border-t border-border pt-[0.4vh] text-start" style={{ fontSize: "clamp(12px, 1vw, 26px)" }}>
                  <span className="font-semibold text-amber-on-tint">To close</span>
                  <span className="num font-bold text-amber-on-tint" data-tabular="true">
                    {model.closing.list.groups.reduce((a, g) => a + g.rows.length, 0)} · {money(bucket(model.closing.list.groups.flatMap((g) => g.rows)).value)} · held {model.closing.list.holds.count} · {money(model.closing.list.holds.value)}
                  </span>
                </button>
              </div>
            </Panel>

            <Panel title={lang === "ar" ? "صحّة مسار المبيعات" : "Pipeline health"} icon={BarChart3} tone="violet" lang={lang}
                   note="active and held apart">
              <div className="flex min-h-0 flex-1 flex-col gap-[0.3vh]" style={{ fontSize: "clamp(12px, 0.9vw, 23px)" }}>
                {([
                  ["JIH · active", model.closing.route.jih.active, "Open JIH (contractor, direct, consultant), not held"],
                  ["JIH · held", model.closing.route.jih.held, "Held JIH with their hold wording and reason"],
                  ["Tender · active", model.closing.route.tender.active, "Open tenders, not held"],
                  ["Tender · held", model.closing.route.tender.held, "Held tenders"],
                  ["Not classified (G)", model.closing.route.unknown.active, "Open records with no JIH/Tender classification"],
                ] as [string, Bucket, string][]).map(([label, b, note]) => (
                  <BucketRow key={label} label={label} b={b} money={money} onOpen={() => openList(label, b.rows, note)} />
                ))}
                {model.closing.route.unmapped.count > 0 ? (
                  <BucketRow label="Unmapped status" b={model.closing.route.unmapped} money={money} onOpen={() => openList("Unmapped status", model.closing.route.unmapped.rows, "No recorded sales stage. Not placed in RFQ received by default.")} />
                ) : null}
                <div className="mt-[0.4vh] border-t border-border pt-[0.4vh] font-semibold text-violet-on-tint" style={{ fontSize: "clamp(12px, 0.74vw, 19px)" }}>
                  RFQs received {model.closing.today.slice(0, 4)} · by received date
                </div>
                <div className="flex min-h-0 flex-1 items-end gap-[0.25vw]">
                  {model.closing.rfq.months.map((m) => {
                    const max = Math.max(1, ...model.closing.rfq.months.map((x) => x.count));
                    return (
                      <button key={m.month} type="button" onClick={() => openList(`RFQs received ${m.month}`, m.rows)}
                              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-[0.2vh]" title={`${m.count} · ${money(m.value) ?? "no value"}`}>
                        <span className="num text-foreground" style={{ fontSize: "clamp(12px, 0.66vw, 17px)" }}>{m.count}</span>
                        <span className="w-full rounded-t bg-violet" style={{ height: `${(m.count / max) * 70}%`, minHeight: m.count ? 3 : 1, opacity: m.count ? 0.85 : 0.25 }} />
                        <span className="text-muted-foreground" style={{ fontSize: "clamp(12px, 0.6vw, 15px)" }}>{MONTHS[Number(m.month.slice(5)) - 1]}</span>
                      </button>
                    );
                  })}
                </div>
                <button type="button" onClick={() => openList("RFQ received date missing", model.closing.rfq.missing.rows, "No actual RFQ received date in the linked source record. The November 2026 sheet has no received-date column.")}
                        className="text-start text-muted-foreground underline-offset-2 hover:underline" style={{ fontSize: "clamp(12px, 0.66vw, 17px)" }}>
                  RFQ received date missing: {model.closing.rfq.missing.count} records ({Math.round((model.closing.rfq.coverage ?? 0) * 100)}% covered)
                </button>
              </div>
            </Panel>

            <Panel title={lang === "ar" ? "أداء فريق المبيعات" : "Team performance"} icon={Users} tone="teal" lang={lang}
                   note={`${salesTeam.length} reps · latest status`}>
              <div className="flex min-h-0 flex-1 flex-col gap-[0.7vh]">
                <AutoScroll className="flex min-h-0 flex-1 flex-col gap-[0.7vh]">
                  {salesTeam.map((p) => (
                    <RepCard key={p.ownerId} p={p} lang={lang} money={money} onOpen={openList} />
                  ))}
                </AutoScroll>
              </div>
            </Panel>
          </div>

          <div className="grid min-h-0 grid-cols-[1fr_2fr] gap-[0.7vw]">
            <Panel band title={lang === "ar" ? "ما الذي تغيّر منذ الأمس؟" : "Changed since yesterday"} icon={RefreshCw} tone="info" lang={lang}>
              <ChipRow
                // The exact window, where the title says it loosely.
                kicker={lang === "ar" ? "آخر 24 ساعة" : "Last 24 hours"}
                cols={5}
                footer={
                  <span className="text-muted-foreground" style={{ fontSize: "clamp(12px, 0.62vw, 16px)" }}>
                    {lang === "ar" ? "الصفوف المستورَدة مستبعَدة من «جديدة»" : "Imported rows excluded from new"}
                  </span>
                }
              >
                <Mini cols={5} icon={TrendingUp} n={model.movement.won} value={money(model.movement.wonValue)} ar="صفقات فُزنا بها" en="Won" tone="won" lang={lang} />
                <Mini cols={5} icon={FileText} n={model.movement.newDeals} value={money(model.movement.newValue)} ar="فرص جديدة" en="New deals" tone="amber" lang={lang} />
                <Mini cols={5} icon={Handshake} n={model.movement.toBafo} ar="انتقلت إلى BAFO" en="Moved to BAFO" tone="violet" lang={lang} />
                {/* The reference names this one "stalled deals", and its pause icon says
                    so too. `advanced` is the opposite fact -- deals that MOVED --
                    and putting it under a pause icon was reading the picture
                    carelessly. Stalled comes from the attention list, which
                    defines it as no recorded activity in the window. */}
                <Mini cols={5} icon={PauseCircle} snapshot n={model.attention.filter((a) => a.reasons.includes("stalled")).length}
                      ar="متوقفة حاليًا" en="Currently stalled" tone="info" lang={lang} />
                <Mini cols={5} icon={CheckCircle2} n={model.movement.followUpsClosed} ar="متابعات أُغلقت" en="Follow-ups closed" tone="teal" lang={lang} />
              </ChipRow>
            </Panel>

            <Panel band title="2025 JIH follow-up red flags" icon={Flag} tone="danger" lang={lang}
                   note={`Jul–Dec 2025 by RFQ received date · ${model.closing.flags.verified} confirmed · ${model.closing.flags.needsVerification} period requires verification`}>
              <div className="flex min-h-0 flex-1 flex-col">
                <AutoScroll className="flex min-h-0 flex-1 flex-col">
                  {model.closing.flags.rows.map((x, i) => (
                    <button key={x.rec.id} type="button" onClick={() => openList(x.rec.project, [x.rec])}
                            className={`flex min-h-0 shrink-0 items-center gap-[0.5vw] px-[0.3vw] py-[0.2vh] text-start ${i % 2 ? "bg-muted" : ""}`}
                            style={{ fontSize: "clamp(12px, 0.78vw, 20px)" }}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-foreground">{x.rec.project}</span>
                        <span className="block truncate text-muted-foreground">
                          {x.rec.held ? `Held: ${x.rec.holdReason ?? x.rec.holdLabel} · review the hold` : x.rec.nextAction ?? "No next action recorded"}
                        </span>
                      </span>
                      <span className="shrink-0 truncate" style={{ width: "5vw" }}>{x.rec.ownerId ? model.labels.get(x.rec.ownerId) ?? "—" : "No owner"}</span>
                      <span className="num shrink-0 text-end font-semibold" style={{ width: "4.4vw" }} data-tabular="true">{money(x.rec.value ?? x.rec.quoted) ?? "—"}</span>
                      <span className="shrink-0 truncate" style={{ width: "6vw" }}>{x.rec.status ?? STAGE_LABEL[x.rec.stage ?? ""]?.[1] ?? "—"}</span>
                      <span className="num shrink-0 text-end" style={{ width: "6vw" }}>
                        {x.daysInactive === null ? "no update date" : `${x.daysInactive}d since update`}
                      </span>
                      <span className={`shrink-0 text-end ${x.inPeriod === null ? "text-amber-on-tint" : "text-muted-foreground"}`} style={{ width: "6.5vw" }}>
                        {x.inPeriod === null ? "Period requires verification" : `RFQ ${x.rec.received}`}
                      </span>
                    </button>
                  ))}
                </AutoScroll>
              </div>
            </Panel>
          </div>
        </main>
      )}

      <DrillDialog drill={drill} onClose={() => setDrill(null)} labels={model?.labels} money={money} today={model?.closing.today ?? ""} />

      {/* Bigger, asked for on 2026-09-02. A ticker is read from across a room
          and at a glance, so it was the one strip on the board sized for a
          desk. Height and type both go up; the wire's speed is derived from
          the text length, so it stays readable rather than racing. */}
      <footer className="flex shrink-0 items-center gap-[1vw] px-[1.2vw] py-[1.1vh]" style={{ background: "var(--ink, #13161b)" }}>
        <span className="shrink-0 rounded-[0.3vw] px-[0.8vw] py-[0.35vh] font-bold text-white"
              style={{ fontSize: "clamp(12px, 1.15vw, 29px)", background: "var(--destructive)" }}>
          {lang === "ar" ? "أخبار المبيعات" : "Sales wire"}
        </span>
        {/* Built from the same figures above -- a wire inventing its own items
            would be a second source of truth nobody could reconcile. */}
        <Wire lang={lang} items={model ? wireItems(model, lang, (n) => money(n) ?? "") : [lang === "ar" ? "جارٍ التحميل" : "Loading"]} />
        <span className="num shrink-0 text-white/70" style={{ fontSize: "clamp(12px, 1.15vw, 29px)" }}>{fmtTime(nowDate)}</span>
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
          fontSize: "clamp(14px, 1.35vw, 35px)",
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
// Measured on the wall: a stacked chip needs 82px and 7.9vh gave it 71, so the
// last line of all five was cut. The three bottom panels share this height on
// purpose, so raising it raises them together and they still line up.
const CHIP_ROW_H = "9.9vh";
/** One type scale for both panels, for the same reason as the height. */
const CHIP_FIGURE = "1.6vw";
const CHIP_LABEL = "clamp(12px, 0.74vw, 19px)";
const CHIP_NOTE = "clamp(12px, 0.66vw, 17px)";
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
        style={{ height: CHIP_KICKER_H, fontSize: "clamp(12px, 0.6vw, 15px)" }}
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
  cols = 3,
}: {
  tone: keyof typeof TONE;
  lang: "ar" | "en";
  /** How many chips share the row. Past three there is no room to sit side by side. */
  cols?: number;
  /** The number. Sits on the left, alone, at one width for the whole row. */
  figure: React.ReactNode;
  label: React.ReactNode;
  note?: React.ReactNode;
}) {
  const t = TONE[tone];
  // Measured on the wall at 1600px: five chips share a third of the width, the
  // fixed number slot takes 2.4vw of each, and the text column is left with
  // SIXTEEN pixels -- for labels that need 22 to 86. Every one of the ten was
  // clipped to nothing. Side by side is right for three chips and impossible
  // for five, so past three the chip stacks: the figure over the words, and
  // the words get the tile's whole width.
  const stacked = cols >= 4;
  return (
    <div
      className={`flex min-h-0 overflow-hidden rounded-[0.5vw] px-[0.5vw] py-[0.4vh] ${
        stacked ? "flex-col items-center justify-center gap-[0.2vh] text-center" : "items-center gap-[0.5vw]"
      }`}
      style={{
        background: t.wash,
        boxShadow: `inset 0 0 0 1px ${t.edge}`,
        // The number belongs on the physical left in BOTH languages, and a
        // plain `row` puts the first child on the reading edge -- which is the
        // right in Arabic. Reversing there, and only there, pins the number left
        // and lets the text start at its own reading edge either way. A stacked
        // chip has no left and right to argue about.
        flexDirection: stacked ? undefined : lang === "ar" ? "row-reverse" : "row",
      }}
    >
      {/* A fixed slot, not a shrink-to-fit one: "5" and "237" are different
          widths, and letting each chip size its own number would step the text
          column three times across a row of three. Stacked, the slot is the
          full tile instead -- there is no column to keep straight. */}
      <span
        className={`flex items-center justify-center ${stacked ? "w-full" : "shrink-0"}`}
        style={stacked ? undefined : { width: CHIP_FIGURE_W }}
      >
        {figure}
      </span>
      <span className={`flex min-w-0 flex-col gap-[0.15vh] ${stacked ? "w-full text-center" : "flex-1 text-start"}`}>
        {label}
        {note}
      </span>
    </div>
  );
}



/** A headline card: label and icon, a centred figure with its unit beneath, an
 *  optional gauge, and a footnote. */
function Kpi({
  icon: Icon, tone, lang, ar, en, value, unit, foot, gauge, band, onOpen,
}: {
  /** Opens the records behind the figure. */
  onOpen?: () => void;
  icon: LucideIcon;
  tone: keyof typeof TONE;
  lang: "ar" | "en";
  ar: string;
  en: string;
  value: string | null;
  unit?: string | null;
  foot?: string;
  gauge?: number | null;
  band?: boolean;
}) {
  const Box = onOpen ? "button" : "div";
  return (
    <Box {...(onOpen ? { type: "button" as const, onClick: onOpen, title: "Open the records" } : {})}
         className={`relative flex min-w-0 flex-col overflow-hidden rounded-[0.7vw] border border-border/70 px-[1.1vw] py-[1vh] text-start shadow-sm ${onOpen ? "cursor-pointer hover:border-primary/50" : ""} ${bandClass(band)}`}>
      <div className="flex w-full items-start justify-between">
        <span className="min-w-0 font-semibold leading-tight text-foreground" style={{ fontSize: "clamp(13px, 0.95vw, 25px)" }}>
          {lang === "ar" ? ar : en}
        </span>
        <Icon
          className="h-[1.7vw] w-[1.7vw] shrink-0"
          strokeWidth={2}
          style={{ color: TONE[tone].edge }}
          aria-hidden="true"
        />
      </div>

      {/* Centred, with the unit UNDER the figure rather than beside it. The eye
          lands on the magnitude first, the unit stays available without
          competing for the same line, and five cards holding different digit
          counts still line up with one another. */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-[0.6vw]">
        <div className="flex min-w-0 flex-col items-center">
          <span
            className={`num font-bold leading-none tracking-[-0.02em] ${TONE[tone].text}`}
            style={{ fontSize: "clamp(28px, 2.75vw, 70px)" }}
          >
            {value ?? "\u2014"}
          </span>
          {unit ? (
            <span className="mt-[0.6vh] w-full text-center leading-snug text-muted-foreground" style={{ fontSize: "clamp(12px, 0.8vw, 21px)" }}>
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

      {/* Two lines allowed, never clipped: the footnote is what makes the
          figure mean something, and half a sentence means nothing. */}
      <span className="mt-[0.5vh] line-clamp-2 w-full text-center leading-snug text-muted-foreground" style={{ fontSize: "clamp(12px, 0.78vw, 20px)" }} title={foot ?? en}>
        {foot ?? en}
      </span>
    </Box>
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


type SalesCardRow = {
  ownerId: string;
  name: string;
  initials: string;
  s: ReturnType<typeof repSummary>;
  done: number;
  openDue: number;
};

/** One salesperson: today's completion as a ring, then the closing figures, each opening its records. */
function RepCard({ p, lang, money, onOpen }: {
  p: SalesCardRow;
  lang: "ar" | "en";
  money: (n: number | null | undefined) => string | null;
  onOpen: (title: string, rows: Rec[], note?: string) => void;
}) {
  const r = rate(p.done, p.openDue);
  const total = p.done + p.openDue;
  const R = 15.9;
  const C = 2 * Math.PI * R;
  const stat = (label: string, b: Bucket, withValue: boolean, warn = false, note?: string) => (
    <button type="button" onClick={() => onOpen(`${p.name} · ${label}`, b.rows, note)} className="flex min-w-0 flex-col items-center hover:bg-muted/60">
      <span className={`num font-semibold ${warn && b.count > 0 ? "text-destructive-on-tint" : "text-foreground"}`} style={{ fontSize: "clamp(12px, 0.9vw, 23px)" }} data-tabular="true">
        {withValue ? `${b.count} · ${money(b.value) ?? "—"}` : formatNumber(b.count, lang)}
      </span>
      <span className="truncate text-muted-foreground" style={{ fontSize: "clamp(12px, 0.62vw, 16px)" }}>{label}</span>
    </button>
  );
  return (
    <article
      className="flex shrink-0 flex-col justify-center gap-[0.5vh] rounded-[0.6vw] border border-border/70 px-[0.8vw] py-[0.6vh]"
      style={{ background: TONE.teal.wash }}
    >
      <div className="flex items-center gap-[0.7vw]">
        <span
          className="flex shrink-0 items-center justify-center rounded-full font-bold text-teal-on-tint"
          style={{ width: "2.6vw", height: "2.6vw", fontSize: "clamp(12px, 0.85vw, 22px)", border: "2px solid var(--teal)" }}
          aria-hidden="true"
        >
          {p.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground" style={{ fontSize: "clamp(13px, 1.05vw, 27px)" }}>{p.name}</div>
          <div className="text-muted-foreground" style={{ fontSize: "clamp(12px, 0.62vw, 16px)" }}>
            {lang === "ar" ? "إنجاز اليوم" : "Done today"}{" "}
            <span className="num" data-tabular="true">{total > 0 ? `${formatNumber(p.done, lang)}/${formatNumber(total, lang)}` : "—"}</span>
          </div>
        </div>
        <div className="relative shrink-0" style={{ width: "3vw", height: "3vw" }}>
          <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="18" cy="18" r={R} fill="none" stroke="var(--border)" strokeWidth="3.2" />
            {r != null ? (
              <circle cx="18" cy="18" r={R} fill="none" stroke="var(--teal)" strokeWidth="3.2" strokeLinecap="round"
                      strokeDasharray={`${(C * r) / 100} ${C}`} />
            ) : null}
          </svg>
          <span className="num absolute inset-0 flex items-center justify-center font-bold text-foreground"
                style={{ fontSize: "clamp(12px, 0.8vw, 20px)" }} data-tabular="true">
            {formatRate(r, lang)}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-[0.4vw] border-t border-border/70 pt-[0.4vh]">
        {stat("Verbal award", p.s.verbal, true)}
        {stat("A to reconcile", p.s.reconcile, true, false, "Column A says verbally awarded; column E does not yet.")}
        {stat("Open JIH", p.s.openJih, true)}
        {stat("Won YTD", p.s.wonYtd, true, false, "Award date from the master list.")}
        {stat("Follow-ups", p.s.followUps, false)}
        {stat("Overdue", p.s.overdue, false, true, "Next action date before today.")}
      </div>
    </article>
  );
}

const CLOSING_GROUP: Record<string, string> = {
  verbal: "1 · Verbal awards — secure the written award, PO or contract",
  direct_2026: "2 · Open 2026 JIH – Direct",
  priority: "3 · Column A priority / follow-up",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One closing row: project and next action, rep, value, status/priority, last update, next date. */
function ClosingRow({ r, zebra, rep, money, today }: {
  r: Rec; zebra: boolean; rep: string; today: string;
  money: (n: number | null | undefined) => string | null;
}) {
  const late = r.nextActionDate !== null && r.nextActionDate < today;
  return (
    <div className={`flex shrink-0 items-center gap-[0.5vw] px-[0.3vw] py-[0.25vh] ${zebra ? "bg-muted" : ""}`} style={{ fontSize: "clamp(12px, 0.82vw, 21px)" }}>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-foreground" title={r.project}>{r.project}</span>
        <span className="block truncate text-muted-foreground" title={r.nextAction ?? ""} style={{ fontSize: "clamp(12px, 0.66vw, 17px)" }}>
          {r.nextAction ?? "No next action recorded"}
        </span>
      </span>
      <span className="shrink-0 truncate" style={{ width: "5vw" }}>{rep}</span>
      <span className="num shrink-0 text-end font-semibold" style={{ width: "4.6vw" }} data-tabular="true">
        {r.secondary ? <span title="Counted once on the primary contractor quotation">{money(r.quoted) ?? "—"}*</span> : money(r.value) ?? "—"}
      </span>
      <span className="shrink-0" style={{ width: "7vw" }}>
        <span className="block truncate">{r.status ?? STAGE_LABEL[r.stage ?? ""]?.[1] ?? "—"}</span>
        <span className="block truncate text-muted-foreground" style={{ fontSize: "clamp(12px, 0.62vw, 16px)" }}>
          {r.held ? `${r.holdLabel}${r.holdReason ? ` · ${r.holdReason}` : ""}` : r.priority ?? "No priority"}
        </span>
      </span>
      <span className="num shrink-0 text-end text-muted-foreground" style={{ width: "4.4vw" }}>{r.lastUpdate ?? "missing"}</span>
      <span className={`num shrink-0 text-end ${late ? "font-semibold text-destructive-on-tint" : "text-muted-foreground"}`} style={{ width: "4.4vw" }}>
        {r.nextActionDate ?? "missing"}
      </span>
    </div>
  );
}

function BucketRow({ label, b, money, onOpen }: { label: string; b: Bucket; money: (n: number | null | undefined) => string | null; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex items-baseline justify-between border-b border-border/40 pb-[0.2vh] text-start hover:bg-muted/60">
      <span className="text-foreground">{label}</span>
      <span className="num font-semibold text-foreground" data-tabular="true">{b.count} · {money(b.value) ?? "—"}</span>
    </button>
  );
}

/** The records behind any total. Missing data is printed as missing. */
function DrillDialog({ drill, onClose, labels, money, today }: {
  drill: { title: string; note?: string; rows: Rec[] } | null;
  onClose: () => void;
  labels: Map<string, string> | undefined;
  money: (n: number | null | undefined) => string | null;
  today: string;
}) {
  const total = drill ? bucket(drill.rows) : null;
  return (
    <Dialog open={!!drill} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-6xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{drill?.title}</DialogTitle>
          <DialogDescription>
            {total ? `${total.count} records · ${money(total.value) ?? "no value"} counted` : ""}
            {drill?.note ? ` · ${drill.note}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {["Project", "Code", "Rep", "Value", "Status (E)", "Priority (A)", "JIH / Tender (G)", "RFQ received", "Last update (K)", "Next action (F)", "Next action"].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {drill?.rows.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell >
                    <Link to="/opportunities/$id" params={{ id: r.id }} className="text-primary underline-offset-2 hover:underline">{r.project}</Link>
                  </TableCell>
                  <TableCell >{r.code ?? "—"}</TableCell>
                  <TableCell >{r.ownerId ? labels?.get(r.ownerId) ?? "—" : "No owner"}</TableCell>
                  <TableCell className="num  text-end">{r.secondary ? `${money(r.quoted) ?? "—"} (counted on primary)` : money(r.value) ?? "missing"}</TableCell>
                  <TableCell >{r.status ?? STAGE_LABEL[r.stage ?? ""]?.[1] ?? "—"}{r.held ? ` · ${r.holdLabel}${r.holdReason ? ` (${r.holdReason})` : ""}` : ""}</TableCell>
                  <TableCell >{r.priority ?? "—"}</TableCell>
                  <TableCell >{r.routeLabel ?? "—"}</TableCell>
                  <TableCell >{r.received ?? "missing"}</TableCell>
                  <TableCell >{r.lastUpdate ? `${r.lastUpdate} (${daysSince(r.lastUpdate, today)}d)` : "missing"}</TableCell>
                  <TableCell className={`${r.nextActionDate && r.nextActionDate < today ? "text-destructive-on-tint" : ""}`}>{r.nextActionDate ?? "missing"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.nextAction ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A panel with a titled header, matching the mockup's card chrome. */
function Panel({
  title, icon: Icon, tone, lang, note, children, band,
}: {
  title: string;
  icon: LucideIcon;
  tone: keyof typeof TONE;
  /** White row or tinted row -- see bandClass. */
  band?: boolean;
  lang: "ar" | "en";
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[0.7vw] border border-border/70 px-[1vw] py-[0.8vh] shadow-sm ${bandClass(band)}`}
    >
      <div className="mb-[0.5vh] flex items-center justify-between">
        <span className="flex items-center gap-[0.45vw]">
          <Icon
            className="h-[1.35vw] w-[1.35vw] shrink-0"
            strokeWidth={2}
            style={{ color: TONE[tone].edge }}
            aria-hidden="true"
          />
          <span className={`font-semibold ${TONE[tone].text}`} style={{ fontSize: "clamp(12px, 0.92vw, 24px)" }}>
            {title}
          </span>
        </span>
        {note ? (
          <span className="text-muted-foreground" style={{ fontSize: "clamp(12px, 0.66vw, 17px)" }}>{note}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** One "needs attention" figure. `null` means the input does not exist. */
function Need({
  n, ar, en, sub, tone, lang, icon: Icon, onOpen,
}: {
  onOpen?: () => void;
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
    <button type="button" onClick={onOpen} disabled={!onOpen} title="Open the records"
            className="flex min-w-0 items-center justify-center gap-[0.5vw] border-e border-border/50 pe-[0.6vw] text-start last:border-e-0 last:pe-0 enabled:hover:bg-muted/60">
      {/*
        A missing input prints a dash at the FIGURE's size, not the words "No
        data" at half of it. Two sizes in one row is what made the strip look
        hand-placed: nothing lined up because one cell's number was a sentence.
        Nothing is lost -- the line underneath already names what is missing.
      */}
      {/* Icon, then figure, then the words -- the order the reference reads in.
          The icon leads because it is the thing the eye finds from across a
          room; the number is what it came for. */}
      <Icon
        className="h-[1.5vw] w-[1.5vw] shrink-0"
        strokeWidth={2}
        style={{ color: TONE[tone].edge }}
        aria-hidden="true"
      />
      <span
        className={`num shrink-0 text-end font-bold leading-none ${n === null ? "text-muted-foreground" : TONE[tone].text}`}
        style={{ fontSize: "clamp(26px, 2.5vw, 64px)", minWidth: "2.4vw" }}
      >
        {n === null ? "\u2014" : formatNumber(n, lang)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-foreground" style={{ fontSize: "clamp(12px, 0.8vw, 20px)" }}>
          {lang === "ar" ? ar : en}
        </span>
        <span className="truncate text-muted-foreground" style={{ fontSize: "clamp(12px, 0.65vw, 17px)" }}>
          {sub}
        </span>
      </span>
    </button>
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
  n, value, ar, en, tone, lang, icon: Icon, cols, snapshot = false,
}: {
  n: number;
  snapshot?: boolean;
  /** Forwarded to Chip: past three, the chip stacks instead of clipping. */
  cols?: number;
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
      cols={cols}
      figure={
        <span className="flex flex-col items-center gap-[0.1vh]">
          {/* 1.3vw needed 88px of an 83px tile once the label wrapped to two
              lines. Still half again the 0.85vw it replaced -- the ask was a
              bigger icon, not a clipped label. */}
          {Icon ? (
            <Icon className="h-[1.1vw] w-[1.1vw]" strokeWidth={2} style={{ color: TONE[tone].edge }} aria-hidden="true" />
          ) : null}
          <span
            className={`num font-bold leading-none ${moved ? TONE[tone].text : "text-muted-foreground"}`}
            style={{ fontSize: CHIP_FIGURE }}
            data-tabular="true"
          >
            {moved && !snapshot ? "+" : ""}{formatNumber(n, lang)}
          </span>
        </span>
      }
      // Stacked, the label may wrap: "Follow-ups closed" needs 86px and the
      // tile gives it 75, and clipping the last word is how a wall ends up
      // showing "Follow-ups clos". Side by side it still truncates -- there is
      // no second line to wrap onto.
      label={
        <span
          className={`w-full font-semibold text-foreground ${cols && cols >= 4 ? "leading-tight" : "truncate"}`}
          style={{ fontSize: CHIP_LABEL }}
        >
          {lang === "ar" ? ar : en}
        </span>
      }
      // "No movement" belongs to a zero and nothing else. Keying it off the
      // value instead printed it under "+88 new deals" -- a true count above a
      // false caption.
      note={
        <span
          className={`num w-full ${cols && cols >= 4 ? "leading-tight" : "truncate"} ${moved && value ? TONE[tone].text : "text-muted-foreground"}`}
          style={{ fontSize: CHIP_NOTE }}
        >
          {snapshot ? (lang === "ar" ? "بلا نشاط > 10 أيام" : "inactive > 10 days") : moved
            ? (value === undefined ? "—" : value ?? (lang === "ar" ? "بلا قيمة مسجَّلة" : "no value recorded"))
            : lang === "ar" ? "بلا حركة" : "no movement"}
        </span>
      }
    />
  );
}
