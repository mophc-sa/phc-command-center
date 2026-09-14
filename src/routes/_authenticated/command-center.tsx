import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Activity, AlertTriangle, ArrowRight, Clock, Sparkles, Target, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KpiTile } from "@/components/phc/KpiTile";
import {
  MANAGEMENT_BUCKETS,
  bucketKpi,
  executiveKpis,
  forecastVsTarget,
  thisMonth,
  yearToDate,
  opportunityValue,
  sumOpportunityValue,
  type ManagementBucketKey,
  type OppRow,
} from "@/lib/sales-kpis";
import { useI18n, formatCurrency, formatNumber, localeFor } from "@/lib/i18n";
import { PageHeader } from "@/components/phc/PageHeader";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { ExecutiveDisclosure } from "@/components/phc/ExecutiveDisclosure";
import "@/styles/command-center.css";
import { KpiGroup } from "@/components/phc/KpiGroup";
import { Donut } from "@/components/phc/Donut";
import { forecastReadiness, type ReadinessKey } from "@/lib/forecast-readiness";
import { PipelineComposition } from "@/components/phc/PipelineComposition";
import { ChartFrame } from "@/components/phc/ChartFrame";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { NeedsAttentionPanel } from "@/components/phc/NeedsAttentionPanel";
import { buildAttention, dataQuality, summarize, type AttentionOpp } from "@/lib/attention";
import {
  buildManagementBrief,
  commentaryFromReportInsights,
  withAiCommentary,
  type CommentaryState,
} from "@/lib/sales-ai";
import { AGGREGATE_ENTITY_ID, runAiAgent } from "@/lib/ai-orchestrator-actions";
import { Callout } from "@/components/phc/Callout";
import { ExecutiveBrief } from "@/components/phc/ExecutiveBrief";
import { DataQualityPanel } from "@/components/phc/DataQualityPanel";
import { AskAiPanel } from "@/components/phc/AskAiPanel";
import { buildRfqWorkflow, summarizeByAge, summarizeByState } from "@/lib/rfq-workflow";
import { allComplete, fetchAllRows } from "@/lib/fetch-all";
import type { StakeholderRow } from "@/lib/stakeholder-roles";
import { salesExecution } from "@/lib/sales-execution";
import { PipelineBreakdownDrawer } from "@/components/phc/PipelineBreakdownDrawer";
import type { OpportunityRow } from "@/components/phc/OpportunityCard";
import {
  resolveCanonicalStage,
  groupByCanonicalStage,
  canonicalStageLabelKey,
  CANONICAL_ACTIVE_STAGES,
  CANONICAL_FUNNEL_ORDER,
} from "@/lib/stage-canonical";
import {
  isSalesperson,
  canManageSalesPipeline,
  isSystemAdmin,
  isFinanceManager,
  type AppRole,
} from "@/lib/roles";

// ── Route guard ───────────────────────────────────────────────────────────────
// This is an aggregate, all-reps management view. Client spec (2026-07-27):
// a salesperson must only ever see their own personal dashboard — this
// guard catches direct URL navigation, since the RLS-level isolation
// (opportunities/RFQs/etc. filtered to owner_id) alone wouldn't stop them
// from *landing* on the management page, just from seeing much data on it.
// Scoped to salesperson specifically (not a broader "not a manager" check)
// so it doesn't disturb the existing "viewer" landing contract in
// src/routes/index.tsx, which deliberately sends viewer here too.
// `role_code` does not exist until migration 20260915100000 is applied, and
// PostgREST answers a select naming an unknown column with 400 — which
// fetchAllRows raises, which would reject the whole dashboard query and leave
// the Command Center blank against today's production schema. A comment about
// deployment order is not a safeguard; this is. Ask for the column, and if the
// database does not have it yet, ask again without it.
//
// The fallback is not a degraded reading, it is the pre-migration reading:
// effectiveRole() already falls back to the historical `role` text, so
// decisionMakerState answers exactly as it did before the column existed. The
// rows are all there either way, so completeness is unaffected.
const STAKEHOLDER_COLS = "id, opportunity_id, name, role, organization, last_interaction_at";

async function fetchStakeholders() {
  try {
    return await fetchAllRows(() =>
      supabase.from("stakeholders").select(`${STAKEHOLDER_COLS}, role_code`),
    );
  } catch {
    return await fetchAllRows(() => supabase.from("stakeholders").select(STAKEHOLDER_COLS));
  }
}

export const Route = createFileRoute("/_authenticated/command-center")({
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return; // parent _authenticated guard handles the redirect

    const { data: rolesRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (rolesRows ?? []).map((r) => r.role as AppRole);
    // Roles are additive (a user may hold several) — only redirect a
    // salesperson who holds no elevated role at all, not e.g. a manager
    // who also happens to carry the salesperson role.
    const hasElevatedRole =
      canManageSalesPipeline(roles) || isSystemAdmin(roles) || isFinanceManager(roles);
    if (isSalesperson(roles) && !hasElevatedRole) {
      throw redirect({ to: "/my-workspace" });
    }
  },
  head: () => ({
    meta: [
      { title: "Command Center — PHC Sales Agent" },
      {
        name: "description",
        content: "Executive operating view: pipeline, follow-ups, RFQ activity, and priority work.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CommandCenter,
});

/** Read chart colours from CSS variables so they stay in sync with the design token system. */
function getCssVar(name: string) {
  if (typeof getComputedStyle === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
const CHART_COLORS = {
  get primary() {
    return getCssVar("--chart-primary") || "oklch(0.20 0.010 253)";
  },
  get primaryDim() {
    return getCssVar("--chart-primary-dim") || "oklch(0.55 0.010 253)";
  },
  get amber() {
    return getCssVar("--chart-amber") || "oklch(0.62 0.135 65)";
  },
  get amberDim() {
    return getCssVar("--chart-amber-dim") || "oklch(0.75 0.09 65)";
  },
  get muted() {
    return getCssVar("--chart-muted") || "oklch(0.90 0.006 90)";
  },
  get grid() {
    return getCssVar("--chart-grid") || "oklch(0.60 0.010 253 / 0.14)";
  },
  get surface() {
    return getCssVar("--color-surface") || "oklch(1 0 0)";
  },
  get border() {
    return getCssVar("--color-border") || "oklch(0.20 0.010 253 / 0.09)";
  },
};

const CHART_H = "h-[240px]";
const CHART_H_SM = "h-[160px]";

function CommandCenter() {
  const { user, roles } = useAuth();
  const { t, lang } = useI18n();
  const nav = useNavigate();

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["cc-core"],
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 29);
      const sinceIso = since.toISOString();

      const [opps, followUps, approvals, activities, rfqs, quotations, transitions, stakeholders] =
        await Promise.all([
          // Paged to completion, not capped. The old cap here silently
          // computed every KPI over the first 200 rows: at 201 opportunities the
          // pipeline total was confidently, precisely wrong with nothing on
          // screen saying so.
          fetchAllRows(() =>
            supabase
              .from("opportunities")
              .select(
                "id, project_name, stage, sales_stage, tier, pipeline_step, estimated_value_min, estimated_value_max, quotation_value, contract_value, currency, owner_id, last_activity_at, next_action, next_action_due, client, main_contractor, human_win_probability, score, loss_reason, lost_at_stage, lost_to_competitor, won_at, lost_at, expected_contract_date, contractor_decision_maker, updated_at, created_at",
              )
              .order("last_activity_at", { ascending: false, nullsFirst: false }),
          ),
          fetchAllRows(() =>
            supabase
              .from("follow_ups")
              .select("id, opportunity_id, due_date, status, channel, cadence_tier, owner_id")
              .neq("status", "completed")
              .order("due_date", { ascending: true }),
          ),
          supabase.from("approvals").select("*").eq("status", "pending"),
          // activity_type + status decide whether a row counts as client contact:
          // a note is internal and an unsent draft never reached anyone.
          supabase
            .from("activities")
            .select("id, related_opportunity_id, activity_type, status, occurred_at")
            .gte("occurred_at", sinceIso),
          fetchAllRows(() =>
            supabase
              .from("rfqs")
              .select(
                "id, rfq_number, status, estimated_value, received_date, response_due_date, opportunity_id, classification",
              ),
          ),
          fetchAllRows(() =>
            supabase
              .from("quotations")
              .select("id, related_opportunity_id, status, value, issued_date"),
          ),
          // Stage aging's only honest source, and the worst of the old caps:
          // `.limit(2000)` combined with ascending order took the OLDEST 2,000
          // transitions, so as history grew the stalled baselines would freeze on
          // ancient rows and quietly stop describing the current book. Paged.
          fetchAllRows(() =>
            supabase
              .from("stage_transition_history")
              .select("record_type, record_id, from_stage, to_stage, created_at")
              .eq("record_type", "opportunity")
              .order("created_at", { ascending: true }),
          ),
          // §19 — so "who decides" is answered by the one shared helper rather
          // than by a single denormalised column.
          fetchStakeholders(),
        ]);
      for (const result of [approvals, activities]) {
        if (result.error) throw result.error;
      }
      return {
        opportunities: opps.rows as unknown as OpportunityRow[],
        followUps: followUps.rows,
        stakeholders: stakeholders.rows,
        // One truncated source makes every derived metric unreliable, so
        // completeness is an AND across the set that feeds the KPIs.
        complete: allComplete(opps, followUps, rfqs, quotations, stakeholders, transitions),
        approvals: approvals.data ?? [],
        transitions: transitions.rows,
        activities: activities.data ?? [],
        rfqs: rfqs.rows,
        quotations: quotations.rows,
      };
    },
  });

  // Phase 3 (system-redesign request): managers land here and should see the
  // team's aggregated target, not just their own — mirrors my-workspace.tsx's
  // per-user annual-then-monthly-fallback pattern, summed across every rep
  // instead of scoped to one user_id.
  const { data: teamTarget, isError: targetError, refetch: refetchTarget } = useQuery({
    queryKey: ["cc-team-target"],
    staleTime: 60_000,
    queryFn: async () => {
      const annYear = `${new Date().getFullYear()}-01-01`;
      const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
      const [annual, monthly] = await Promise.all([
        supabase
          .from("sales_targets")
          .select("sales_target")
          .eq("period_type", "annual").eq("period_start", annYear),
        supabase
          .from("sales_targets")
          .select("sales_target")
          .eq("period_type", "monthly").eq("period_start", monthStart),
      ]);
      if (annual.error) throw annual.error;
      if (monthly.error) throw monthly.error;
      const annualSum = (annual.data ?? []).reduce((s, r) => s + Number(r.sales_target ?? 0), 0);
      const monthlySum = (monthly.data ?? []).reduce((s, r) => s + Number(r.sales_target ?? 0), 0);
      return {
        total: annualSum > 0 ? annualSum : monthlySum,
        periodType: annualSum > 0 ? ("annual" as const) : ("monthly" as const),
      };
    },
  });

  const opps = data?.opportunities ?? [];
  const followUps = data?.followUps ?? [];
  const approvals = data?.approvals ?? [];
  const rfqs = data?.rfqs ?? [];

  // Canonical stage, not the legacy CRM one. `stage` and `sales_stage` are only
  // synchronised at won/lost, so reading `stage` mid-pipeline filed a
  // verbally-awarded deal under "Quotation" on this page while My Workspace
  // showed it correctly. Live cross-tab, 2026-08-05, made that concrete.
  const canonicalOf = (o: OpportunityRow) => resolveCanonicalStage(o).stage;
  const openOpps = opps.filter((o) => {
    const s = canonicalOf(o);
    return s !== null && (CANONICAL_ACTIVE_STAGES as readonly string[]).includes(s);
  });
  // Mine, from the composition work — and a fifth formula the moment I wrote
  // it. The engine's rule, like everywhere else.
  const openPipelineValue = sumOpportunityValue(openOpps as never).total;

  const today = new Date().toISOString().slice(0, 10);
  const targetPeriod = teamTarget?.periodType === "annual" ? yearToDate(today) : thisMonth(today);
  const targetPeriodLabel =
    teamTarget?.periodType === "annual"
      ? lang === "ar"
        ? `العام ${today.slice(0, 4)}`
        : `Year ${today.slice(0, 4)}`
      : new Date(`${today.slice(0, 7)}-01T12:00:00`).toLocaleDateString(localeFor(lang), {
          month: "long",
          year: "numeric",
        });
  // Pipeline by stage — the real PHC flow (rfq_received → … → contract_signed),
  // not the generic CRM buckets this used to show.
  const pipelineByStage = useMemo(() => {
    const grouped = groupByCanonicalStage(
      opps as unknown as Parameters<typeof groupByCanonicalStage>[0],
    );
    return grouped.buckets.map((b) => ({
      stage: t(canonicalStageLabelKey(b.stage)),
      count: b.count,
      value: b.value,
      // Pipeline position, 1-7, so the stacked bar and the stage chart colour
      // the same stage the same way. Derived from the canonical order rather
      // than from array index: buckets with no records drop out, and an index
      // would then shift every later stage's colour.
      tone: CANONICAL_FUNNEL_ORDER.indexOf(b.stage) + 1,
      key: b.stage as string,
    }));
  }, [opps, t]);

  /** Only stages that actually carry money — an empty segment is not a segment. */
  const compositionSlices = useMemo(
    () =>
      pipelineByStage
        .filter((b) => b.value > 0)
        .map((b) => ({ key: b.key, label: b.stage, value: b.value, count: b.count, tone: b.tone })),
    [pipelineByStage],
  );

  /**
   * Why the forecast is blank, as a picture.
   *
   * Three mutually exclusive buckets over the open book — which is what a donut
   * needs and what nothing on this page was showing. The Executive Brief states
   * "48 open opportunities have no probability" in a sentence; this is the same
   * fact in the shape a reader can take in without reading, and next to the
   * composition bar it answers the question that bar provokes: the money is
   * there, so why is there no forecast?
   *
   * Order is worst-first, so the largest problem is the first arc drawn.
   */
  const readiness = useMemo(() => {
    // The rows, not just the tallies. The donut used to count into three
    // integers and throw the deals away, which is why it could name a problem
    // and not open it -- 581 open deals carrying no probability, and no way
    // from the sentence to the list. The KPI cards beside it have opened their
    // records since they shipped; this was the one figure on the page that
    // ended the reader's journey instead of continuing it.
    const bucket = forecastReadiness(openOpps);
    const slices = [
      {
        key: "no_probability",
        label: lang === "ar" ? "بلا احتمالية" : "No probability",
        value: bucket.no_probability.length,
        color: "var(--color-amber)",
      },
      {
        key: "no_value",
        label: lang === "ar" ? "بلا قيمة مسجَّلة" : "No recorded value",
        value: bucket.no_value.length,
        color: "var(--color-destructive)",
      },
      {
        key: "ready",
        label: lang === "ar" ? "قابلة للتنبؤ" : "Ready to forecast",
        value: bucket.ready.length,
        color: "var(--color-won)",
      },
    ].filter((b) => b.value > 0);
    return { slices, bucket };
  }, [openOpps, lang]);

  /** Open deals carrying no value at all — excluded from the total, and said so. */
  const unvaluedOpenCount = useMemo(
    () => openOpps.filter((o) => opportunityValue(o as never) === null).length,
    [openOpps],
  );

  const inferredCount = groupByCanonicalStage(
    opps as unknown as Parameters<typeof groupByCanonicalStage>[0],
  ).inferredCount;

  // Follow-ups status distribution
  const followUpsStatus = useMemo(() => {
    let overdueC = 0,
      dueToday = 0,
      upcoming = 0,
      scheduled = 0;
    for (const f of followUps as any[]) {
      const dd = f.due_date as string | null;
      if (f.status === "overdue" || (dd && dd < today)) overdueC++;
      else if (dd === today) dueToday++;
      else if (f.status === "due") upcoming++;
      else scheduled++;
    }
    return [
      {
        key: "overdue",
        label: lang === "ar" ? "متأخر" : "Overdue",
        value: overdueC,
        color: CHART_COLORS.amber,
      },
      {
        key: "today",
        label: lang === "ar" ? "اليوم" : "Today",
        value: dueToday,
        color: CHART_COLORS.primary,
      },
      {
        key: "due",
        label: lang === "ar" ? "مستحق" : "Due",
        value: upcoming,
        color: CHART_COLORS.primaryDim,
      },
      {
        key: "scheduled",
        label: lang === "ar" ? "مجدول" : "Scheduled",
        value: scheduled,
        color: CHART_COLORS.muted,
      },
    ];
  }, [followUps, today, lang]);

  // Phase 5.1 §16 — RFQ age and derived workflow state.
  //
  // The donut this replaces plotted `rfq_status`, which has four values and
  // three of them are terminal, so a live desk read "Open: 8 — 100%": a chart
  // of one fact. The useful distinctions come from the quotation chain one join
  // away, without adding a second lifecycle to keep in sync.
  const rfqWork = useMemo(
    () => buildRfqWorkflow(rfqs as never, (data?.quotations ?? []) as never, today),
    [rfqs, data, today],
  );
  const rfqAges = useMemo(() => summarizeByAge(rfqWork), [rfqWork]);
  const rfqStates = useMemo(() => summarizeByState(rfqWork), [rfqWork]);
  const rfqOverdue = useMemo(() => rfqWork.filter((r) => r.overdue), [rfqWork]);
  const rfqTotal = rfqs.length;

  // Grouped once, so the decision-maker read is a Map lookup per opportunity
  // rather than a scan of every stakeholder for every deal.
  const stakeholdersByOpp = useMemo(() => {
    const m = new Map<string, StakeholderRow[]>();
    // `role_code` is optional on this type, and not because the schema is
    // vague: fetchStakeholders() drops the column when the database predates
    // 20260915100000. effectiveRole() already reads the historical `role` text
    // in that case, so a row without it is a complete row, not a broken one.
    for (const s of (data?.stakeholders ?? []) as Array<
      StakeholderRow & { opportunity_id?: string | null }
    >) {
      const oid = s.opportunity_id;
      if (!oid) continue;
      m.set(oid, [...(m.get(oid) ?? []), s]);
    }
    return m;
  }, [data]);

  // Phase 5.1 §6/§7/§8. This used to be one row per ISSUE, hard-capped at three
  // follow-ups plus two approvals, ordered by whatever the query returned. A
  // deal with two overdue follow-ups appeared twice, and deal value entered the
  // ranking nowhere at all.
  const attention = useMemo(
    () =>
      buildAttention({
        opportunities: (data?.opportunities ?? []) as unknown as AttentionOpp[],
        followUps: (data?.followUps ?? []) as never,
        activities: ((data?.activities ?? []) as Array<Record<string, unknown>>).map((a) => ({
          id: String(a.id),
          // The column is related_opportunity_id — `opportunity_id` exists on
          // follow_ups but not here, and the generated types caught the slip.
          opportunity_id: (a.related_opportunity_id as string | null) ?? null,
          activity_type: (a.activity_type as string | null) ?? null,
          status: (a.status as string | null) ?? null,
          // `activities` dates its rows with occurred_at, not created_at.
          created_at: String(a.occurred_at ?? ""),
        })),
        transitions: (data?.transitions ?? []) as never,
        stakeholdersByOpp: stakeholdersByOpp,
        today: new Date().toISOString().slice(0, 10),
      }),
    [data, stakeholdersByOpp],
  );

  const attentionSummary = useMemo(() => summarize(attention), [attention]);

  // §C1 — the rows behind the headline. Held as the KPI key so the drawer is
  // handed exactly the records that KPI summed, never its own query.
  const [breakdown, setBreakdown] = useState<null | { title: string; rows: OppRow[] }>(null);
  const [askOpen, setAskOpen] = useState(false);

  // §11 — the brief. Built from counted records BEFORE any model is consulted,
  // so it is complete and true whether or not AI is reachable. Commentary, when
  // it arrives, is appended and labelled; it never replaces a fact.
  const deterministicBrief = useMemo(
    () =>
      buildManagementBrief({
        opportunities: (data?.opportunities ?? []) as unknown as OppRow[],
        ctx: { today, period: targetPeriod },
        targetAmount: teamTarget?.total && teamTarget.total > 0 ? teamTarget.total : null,
      }),
    [data, today, teamTarget],
  );

  // A separate query on purpose: a slow or failing model must not hold up the
  // facts. `retry: false` because a brief nobody is waiting for is not worth
  // three attempts, and `ok === false` is a normal outcome here, not an error.
  const commentary = useQuery({
    queryKey: ["cc-brief-commentary", user?.id, roles],
    staleTime: 900_000,
    retry: false,
    enabled: canManageSalesPipeline(roles) && (data?.opportunities ?? []).length > 0,
    queryFn: async () => {
      // The registry is the authority: sales_report_insights accepts ONLY the
      // "reports" sentinel entity (ai-guardrails.ts). Sending "opportunities"
      // with a real deal id returned 400 AI_ENTITY_NOT_ALLOWED on every call,
      // in production, from the day this shipped — the brief silently fell
      // back to "AI commentary unavailable" and looked like a provider being
      // down. The agent summarises an org-wide aggregate, not one deal, which
      // is exactly what the sentinel means.
      const res = await runAiAgent({
        agent: "sales_report_insights",
        entityType: "reports",
        entityId: AGGREGATE_ENTITY_ID,
        input: { language: lang },
      });
      return res.ok ? res : null;
    },
  });

  // One mapping, from the authoritative schema's field names, in a pure
  // function that a test can drive end to end. Reading `insights` /
  // `recommendations` here — names SalesReportInsightsOutputSchema has never
  // used — is what let a 200 render nothing at all.
  //
  // filterRecommendations (inside withAiCommentary) still drops anything
  // proposing a forbidden action before it can reach the screen.
  const { brief, commentaryState } = useMemo(() => {
    const c = commentary.data;
    if (!c || !c.ok) {
      return {
        brief: deterministicBrief,
        commentaryState: (commentary.isFetched ? "unavailable" : "ok") as CommentaryState,
      };
    }
    const { inferences, recommendations } = commentaryFromReportInsights(c.result);
    const merged = withAiCommentary(deterministicBrief, {
      agentKey: "sales_report_insights",
      inferences,
      recommendations,
    }).brief;
    // A valid response that yields no usable line is its own state. It is not
    // a failure, and it must not pass for commentary that simply had nothing
    // to say — that ambiguity is what hid this defect in production.
    const rendered = merged.needsAttention.length - deterministicBrief.needsAttention.length;
    return { brief: merged, commentaryState: (rendered > 0 ? "ok" : "empty") as CommentaryState };
  }, [deterministicBrief, commentary.data, commentary.isFetched]);

  // §13 — data quality from the same engine Needs Attention uses, so the two
  // cannot disagree about what is missing.
  const dq = useMemo(() => {
    const active = ((data?.opportunities ?? []) as unknown as OppRow[]).filter((o) => {
      const st = resolveCanonicalStage(o).stage;
      return st !== null && (CANONICAL_ACTIVE_STAGES as readonly string[]).includes(st);
    }).length;
    return dataQuality(attention, active);
  }, [attention, data]);

  // §15 — per-owner outcomes. Reuses the attention engine's stalled verdicts
  // rather than recomputing them, so the table and Needs Attention cannot
  // disagree about which deals are stuck.
  const execution = useMemo(
    () =>
      salesExecution({
        opportunities: (data?.opportunities ?? []) as unknown as OppRow[],
        followUps: (data?.followUps ?? []) as never,
        activities: ((data?.activities ?? []) as Array<Record<string, unknown>>).map((a) => ({
          id: String(a.id),
          opportunity_id: (a.related_opportunity_id as string | null) ?? null,
          activity_type: (a.activity_type as string | null) ?? null,
          status: (a.status as string | null) ?? null,
          created_at: String(a.occurred_at ?? ""),
        })),
        quotations: (data?.quotations ?? []) as never,
        attention,
        today,
        since: new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10),
      }),
    [data, attention, today],
  );

  const { data: teamMembers = [] } = useQuery({
    queryKey: ["cc-team-names"],
    staleTime: 300_000,
    queryFn: async () =>
      (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });
  const teamName = (id: string) => {
    const m = (
      teamMembers as Array<{ id: string; full_name?: string | null; email?: string | null }>
    ).find((x) => x.id === id);
    return m?.full_name ?? m?.email ?? id.slice(0, 8);
  };

  // Canonical Phase 5 KPIs. `today` is derived once so every tile shares one
  // period boundary and they cannot disagree about what "this month" means.
  const execKpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return executiveKpis((data?.opportunities ?? []) as unknown as OppRow[], {
      today,
      period: thisMonth(today),
    });
  }, [data]);

  // Phase 5.1 §1/§4/§5. Same rows, same period boundary as execKpis — one
  // `today` for the whole page so two tiles cannot disagree about the month.
  const { forecast, buckets } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = (data?.opportunities ?? []) as unknown as OppRow[];
    const ctx = {
      today,
      period: teamTarget?.periodType === "annual" ? yearToDate(today) : thisMonth(today),
    };
    return {
      forecast: forecastVsTarget(
        rows,
        ctx,
        teamTarget?.total && teamTarget.total > 0 ? teamTarget.total : null,
      ),
      buckets: Object.fromEntries(
        MANAGEMENT_BUCKETS.map((b) => [b.key, bucketKpi(rows, ctx, b.key)]),
      ) as Record<ManagementBucketKey, ReturnType<typeof bucketKpi>>,
    };
  }, [data, teamTarget]);

  if (isError || targetError) return <QueryFailure retry={() => Promise.all([refetch(), refetchTarget()])} />;

  return (
    <div
      className="executive-command mx-auto max-w-7xl space-y-6"
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <PageHeader
        eyebrow={
          lang === "ar"
            ? "الإدارة العامة · إدارة المبيعات"
            : "General management · Sales leadership"
        }
        title={lang === "ar" ? "مركز القيادة التنفيذي" : "Executive Command Center"}
        description={
          lang === "ar"
            ? "الأداء، المخاطر، والقرارات التي تحتاج انتباهك."
            : "Performance, exposure, and decisions that need your attention."
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => void Promise.all([refetch(), refetchTarget()])}
              disabled={isFetching}
              className="executive-action"
            >
              {isFetching
                ? lang === "ar"
                  ? "جارٍ التحديث…"
                  : "Refreshing…"
                : lang === "ar"
                  ? "تحديث البيانات"
                  : "Refresh data"}
            </button>
            <button
              type="button"
              onClick={() => setAskOpen(true)}
              className="executive-action executive-action-primary"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {lang === "ar" ? "اسأل المساعد" : "Ask assistant"}
            </button>
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3 text-sm">
        <nav
          aria-label={lang === "ar" ? "أقسام مركز القيادة" : "Command center sections"}
          className="flex flex-wrap gap-2"
        >
          {[
            ["performance", lang === "ar" ? "الأداء" : "Performance"],
            ["decisions", lang === "ar" ? "الأولويات" : "Priorities"],
            ["pipeline", lang === "ar" ? "خط المبيعات" : "Pipeline"],
            ["team", lang === "ar" ? "الفريق" : "Team"],
          ].map(([id, label]) => (
            <a key={id} className="executive-action" href={`#executive-${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <p className="text-muted-foreground" role="status">
          {dataUpdatedAt > 0
            ? `${lang === "ar" ? "آخر تحديث" : "Updated"} ${new Date(dataUpdatedAt).toLocaleTimeString(localeFor(lang), { hour: "2-digit", minute: "2-digit" })}`
            : lang === "ar"
              ? "جارٍ تحميل المؤشرات"
              : "Loading metrics"}
        </p>
      </div>
      {data && !data.complete && (
        <Callout tone="critical">
          <p>
            {lang === "ar"
              ? "البيانات غير مكتملة؛ المؤشرات محسوبة على السجلات المتاحة فقط."
              : "Data is incomplete; metrics cover the available records only."}
          </p>
        </Callout>
      )}
      {isLoading ? (
        <SkeletonTable rows={5} />
      ) : (
        <>
          <section
            id="executive-performance"
            className="scroll-mt-6"
            aria-labelledby="executive-performance-title"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 id="executive-performance-title" className="text-xl font-semibold">
                {lang === "ar" ? "الأداء مقابل المستهدف" : "Performance against target"}
              </h2>
              <span className="rounded-full border border-border bg-surface px-3 py-1 text-sm">
                {targetPeriodLabel}
              </span>
            </div>
            <div className="executive-scorecard grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile
                kpi={forecast.target}
                label={lang === "ar" ? "الهدف الإجمالي للفريق" : "Team Target"}
                hint={targetPeriodLabel}
                accent="count"
                icon={<Target className="h-4 w-4" />}
              />
              <KpiTile
                kpi={forecast.won}
                label={lang === "ar" ? "قيمة الصفقات المحققة" : "Won deal value"}
                hint={targetPeriodLabel}
                accent="won"
                icon={<Wallet className="h-4 w-4" />}
              />
              <KpiTile
                kpi={forecast.achievement}
                label={lang === "ar" ? "نسبة تحقيق المستهدف" : "Target achievement"}
                hint={targetPeriodLabel}
                accent="won"
                icon={<Target className="h-4 w-4" />}
              />
              <KpiTile
                kpi={forecast.forecast}
                label={lang === "ar" ? "التوقع المرجّح" : "Weighted forecast"}
                hint={
                  lang === "ar"
                    ? "الفرص المفتوحة حاليًا · حسب احتمالية الفوز"
                    : "Current open deals · weighted by probability"
                }
                accent="money"
                icon={<Activity className="h-4 w-4" />}
              />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {lang === "ar"
                ? "المحقق والمستهدف لنفس الفترة. خط المبيعات والتوقع يمثلان الوضع الحالي، ولا يُعدّان إيرادًا محققًا."
                : "Actuals and target use the same period. Pipeline and forecast describe the current position, not realized revenue."}
            </p>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4">
            <div>
              <h2 className="font-semibold">
                {lang === "ar" ? "قرارات بانتظار الاعتماد" : "Decisions awaiting approval"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {approvals.length
                  ? lang === "ar"
                    ? `${formatNumber(approvals.length, lang)} طلبات تحتاج مراجعة أصحاب الصلاحية`
                    : `${formatNumber(approvals.length, lang)} requests need an authorized review`
                  : lang === "ar"
                    ? "لا توجد طلبات اعتماد معلّقة ضمن صلاحياتك"
                    : "No pending approvals within your access"}
              </p>
            </div>
            <button
              type="button"
              className="executive-action"
              onClick={() => nav({ to: "/approvals" })}
            >
              {lang === "ar" ? "فتح الاعتمادات" : "Open approvals"}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>
          <section id="executive-decisions" className="scroll-mt-6">
            <div className="mb-2 grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["at_risk", attentionSummary.atRisk, lang === "ar" ? "معرَّضة للخطر" : "At risk"],
                  ["stalled", attentionSummary.stalled, lang === "ar" ? "متوقفة" : "Stalled"],
                  [
                    "closing",
                    attentionSummary.closingSoon,
                    lang === "ar" ? "إغلاق قريب" : "Closing soon",
                  ],
                ] as const
              ).map(([key, roll, label]) => (
                <div
                  key={key}
                  className="rounded-xl border border-border/70 bg-surface/60 px-4 py-3"
                >
                  <div className="text-xs font-medium tracking-[0.02em] text-muted-foreground">
                    {label}
                  </div>
                  <div
                    className="num mt-1 text-[20px] font-semibold leading-none text-foreground"
                    data-tabular="true"
                  >
                    {formatNumber(roll.count, lang)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {roll.count === 0
                      ? "—"
                      : roll.value > 0
                        ? formatCurrency(roll.value, lang)
                        : lang === "ar"
                          ? "بلا قيمة مسجَّلة"
                          : "No value recorded"}
                  </div>
                </div>
              ))}
            </div>

            <ChartFrame
              title={
                lang === "ar" ? "أولويات التدخل التنفيذي" : "Executive intervention priorities"
              }
              subtitle={
                lang === "ar"
                  ? "أعلى 5 فرص حسب الأولوية · افتح الفرصة لمعرفة الأسباب"
                  : "Top 5 opportunities by priority · expand a row to see why"
              }
              action={
                <button
                  onClick={() => nav({ to: "/action-center" })}
                  className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {lang === "ar" ? "الكل" : "View all"} <ArrowRight className="h-3 w-3" />
                </button>
              }
              padded={false}
              bodyClassName="p-0"
            >
              {isLoading ? (
                <SkeletonTable rows={4} />
              ) : attention.length === 0 ? (
                <div className="px-3 py-6">
                  <EmptyState message={t("empty_needs_attention")} />
                </div>
              ) : (
                <NeedsAttentionPanel items={attention.slice(0, 5)} />
              )}
            </ChartFrame>
          </section>

          {inferredCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {lang === "ar"
                ? `${formatNumber(inferredCount, lang)} فرص استُنتجت مرحلتها؛ راجع مراحلها لتحسين دقة التوزيع.`
                : `${formatNumber(inferredCount, lang)} opportunities have inferred stages; review them to improve distribution accuracy.`}
            </p>
          )}
          <div
            id="executive-pipeline"
            className="scroll-mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
          >
            <PipelineComposition
              slices={compositionSlices}
              total={openPipelineValue}
              recordCount={openOpps.length}
              unvaluedCount={unvaluedOpenCount}
              className="mb-0"
            />

            {/* The question the bar provokes, answered beside it. */}
            <section className="rounded-xl border border-border/70 bg-surface/60 p-5">
              <h2 className="text-base font-semibold text-foreground">
                {lang === "ar" ? "جاهزية التنبؤ" : "Forecast readiness"}
              </h2>
              <p className="section-label mb-4 mt-1">
                {lang === "ar"
                  ? "الفرص المفتوحة، بما ينقصها"
                  : "Open opportunities, by what they are missing"}
              </p>
              <Donut
                slices={readiness.slices}
                total={openOpps.length}
                onSelect={(key) => {
                  // Donut hands back a plain string -- its slices belong to whoever
                  // passed them. The guard is what makes the narrowing true rather
                  // than asserted: a key that is not one of ours opens nothing.
                  if (!(key in readiness.bucket)) return;
                  const rows = readiness.bucket[key as ReadinessKey];
                  if (rows.length === 0) return;
                  setBreakdown({
                    title:
                      readiness.slices.find((sl) => sl.key === key)?.label ??
                      (lang === "ar" ? "جاهزية التنبؤ" : "Forecast readiness"),
                    rows: rows as unknown as OppRow[],
                  });
                }}
              />
            </section>
          </div>

          <section
            id="executive-team"
            className="grid min-w-0 scroll-mt-6 grid-cols-[minmax(0,1fr)]"
          >
            <ChartFrame
              title={lang === "ar" ? "أداء فريق المبيعات" : "Sales team performance"}
              subtitle={
                lang === "ar"
                  ? "خط المبيعات الحالي · المتابعات المستحقة · الاجتماعات خلال 30 يومًا"
                  : "Current pipeline · due follow-ups · meetings in the last 30 days"
              }
              padded={false}
            >
              {execution.length === 0 ? (
                <div className="px-5 py-6">
                  <EmptyState
                    message={lang === "ar" ? "لا فرص مُسنَدة بعد" : "No assigned opportunities yet"}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-start text-2xs tracking-[0.02em] text-muted-foreground">
                        <th className="px-4 py-2 text-start">
                          {lang === "ar" ? "المندوب" : "Salesperson"}
                        </th>
                        <th className="px-3 py-2 text-end">{lang === "ar" ? "مفتوح" : "Open"}</th>
                        <th className="px-3 py-2 text-end">
                          {lang === "ar" ? "مرجّح" : "Weighted"}
                        </th>
                        <th className="px-3 py-2 text-end">
                          {lang === "ar" ? "متابعات" : "Follow-ups"}
                        </th>
                        <th className="px-3 py-2 text-end">
                          {lang === "ar" ? "اجتماعات" : "Meetings"}
                        </th>
                        <th className="px-3 py-2 text-end">
                          {lang === "ar" ? "متوقفة" : "Stalled"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {execution.map((r) => (
                        <tr key={r.ownerId} className="border-b border-border/50">
                          <td className="px-4 py-2.5 text-foreground">{teamName(r.ownerId)}</td>
                          <td className="num px-3 py-2.5 text-end" data-tabular="true">
                            {r.openPipeline === null ? (
                              <span className="text-xs text-muted-foreground">
                                {lang === "ar"
                                  ? `بلا قيمة (${r.unpricedCount})`
                                  : `No value (${r.unpricedCount})`}
                              </span>
                            ) : (
                              <span className="text-foreground">
                                {formatCurrency(r.openPipeline, lang)}
                              </span>
                            )}
                          </td>
                          <td className="num px-3 py-2.5 text-end" data-tabular="true">
                            {/* Null, not zero: a book nobody has scored is not a
                            book worth nothing. Same rule as the company total. */}
                            {r.weightedPipeline === null ? (
                              <span className="text-xs text-muted-foreground">
                                {lang === "ar"
                                  ? `غير محتسَب (${r.unscoredCount})`
                                  : `Not calculated (${r.unscoredCount})`}
                              </span>
                            ) : (
                              <span className="text-foreground">
                                {formatCurrency(r.weightedPipeline, lang)}
                              </span>
                            )}
                          </td>
                          <td
                            className="num px-3 py-2.5 text-end text-foreground"
                            data-tabular="true"
                          >
                            {formatNumber(r.followUpsDue, lang)}
                          </td>
                          <td
                            className="num px-3 py-2.5 text-end text-foreground"
                            data-tabular="true"
                          >
                            {formatNumber(r.meetings, lang)}
                          </td>
                          <td className="num px-3 py-2.5 text-end" data-tabular="true">
                            {r.stalledCount === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className="text-amber-light">
                                {formatNumber(r.stalledCount, lang)}
                                {r.stalledValue > 0
                                  ? ` · ${formatCurrency(r.stalledValue, lang)}`
                                  : ""}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartFrame>
          </section>
          <ExecutiveDisclosure
            title={lang === "ar" ? "الموجز التنفيذي والتحليل" : "Executive brief and analysis"}
            description={
              lang === "ar"
                ? "ما تغيّر، نقاط التركيز، وتعليق المساعد عند توفره"
                : "What changed, focus areas, and assistant commentary when available"
            }
          >
            <ExecutiveBrief brief={brief} commentaryState={commentaryState} />
          </ExecutiveDisclosure>
          <ExecutiveDisclosure
            title={lang === "ar" ? "تفاصيل التشغيل والمتابعة" : "Operating and follow-up details"}
            description={
              lang === "ar"
                ? "توزيع المتابعات وأعمار طلبات عروض الأسعار"
                : "Follow-up distribution and RFQ aging"
            }
          >
            {/* Charts row 2 */}
            <section className="mt-3 grid gap-3 lg:grid-cols-2">
              <ChartFrame
                title={lang === "ar" ? "حالة المتابعات" : "Follow-ups by status"}
                subtitle={
                  lang === "ar" ? "توزيع المتابعات النشطة" : "Distribution of active follow-ups"
                }
              >
                {followUps.length === 0 ? (
                  <EmptyChart
                    label={lang === "ar" ? "لا توجد متابعات نشطة" : "No active follow-ups"}
                  />
                ) : (
                  <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_180px] items-center gap-6">
                    <div className="space-y-2.5">
                      {followUpsStatus.map((s) => {
                        const total = followUpsStatus.reduce((a, b) => a + b.value, 0) || 1;
                        const pct = Math.round((s.value / total) * 100);
                        return (
                          <div key={s.key}>
                            <div className="mb-1 flex items-center justify-between text-sm">
                              <span className="flex items-center gap-2 text-muted-foreground">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ background: s.color }}
                                />
                                {s.label}
                              </span>
                              <span className="num text-foreground" data-tabular="true">
                                {formatNumber(s.value, lang)}
                              </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${pct}%`, background: s.color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className={CHART_H_SM}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={followUpsStatus}
                            dataKey="value"
                            nameKey="label"
                            innerRadius={44}
                            outerRadius={64}
                            paddingAngle={2}
                            stroke="none"
                          >
                            {followUpsStatus.map((s) => (
                              <Cell key={s.key} fill={s.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </ChartFrame>

              <ChartFrame
                title={lang === "ar" ? "عمر طلبات عروض الأسعار" : "RFQ age"}
                subtitle={
                  rfqOverdue.length > 0
                    ? lang === "ar"
                      ? `${rfqTotal} طلب · ${rfqOverdue.length} تجاوز موعد الرد بلا تقديم`
                      : `${rfqTotal} RFQs · ${rfqOverdue.length} past the response date with nothing submitted`
                    : lang === "ar"
                      ? `${rfqTotal} طلب`
                      : `${rfqTotal} RFQs`
                }
              >
                {rfqTotal === 0 ? (
                  <EmptyChart label={lang === "ar" ? "لا توجد طلبات بعد" : "No RFQs yet"} />
                ) : (
                  <div className="space-y-4">
                    {/* Age first: it is the only fully derivable RFQ fact, since
                  received_date is NOT NULL on every row. */}
                    <div className="grid grid-cols-4 gap-2">
                      {rfqAges.map((b) => (
                        <div
                          key={b.bucket}
                          className="rounded-lg border border-border/70 bg-surface/60 px-2.5 py-2"
                        >
                          <div className="text-2xs tracking-[0.02em] text-muted-foreground">
                            {b.bucket === "15+"
                              ? lang === "ar"
                                ? "+15 يوم"
                                : "15+ days"
                              : `${b.bucket}${lang === "ar" ? " يوم" : "d"}`}
                          </div>
                          <div
                            className="num mt-0.5 text-lg font-semibold leading-none text-foreground"
                            data-tabular="true"
                          >
                            {formatNumber(b.count, lang)}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-1.5">
                      {rfqStates
                        .filter((st) => st.count > 0)
                        .map((st) => (
                          <div key={st.state} className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              {t(`rfqw_${st.state}` as never)}
                            </span>
                            <span className="num text-foreground" data-tabular="true">
                              {formatNumber(st.count, lang)}
                            </span>
                          </div>
                        ))}
                    </div>

                    {/* The data gap, stated rather than approximated. */}
                    <p className="text-2xs leading-relaxed text-muted-foreground/70">
                      {lang === "ar"
                        ? "الحالات مشتقّة من حالة الطلب وسلسلة عروض الأسعار. «بانتظار توضيح» و«معلومات ناقصة» غير معروضتين لأن لا حقل يسجّلهما."
                        : "States are derived from RFQ status and the quotation chain. \u201CAwaiting clarification\u201D and \u201Cmissing information\u201D are absent because no field records them."}
                    </p>
                  </div>
                )}
              </ChartFrame>
            </section>
          </ExecutiveDisclosure>
          <ExecutiveDisclosure
            title={lang === "ar" ? "تفصيل المؤشرات والنتائج" : "Metric and outcome breakdown"}
            description={
              lang === "ar"
                ? "المراحل التجارية ونتائج الشهر الحالي"
                : "Commercial stages and current-month outcomes"
            }
          >
            <KpiGroup
              title={
                lang === "ar" ? "خط الأنابيب حسب الموقع التجاري" : "Pipeline by commercial position"
              }
              columns="lg:grid-cols-3 xl:grid-cols-5"
              entries={MANAGEMENT_BUCKETS.map((b) => ({
                kpi: buckets[b.key],
                label: t(`mgmt_${b.key}` as never),
                // Rendered 2026-08-26: this row's "Open pipeline" and the strip above
                // it showed the SAME label and the SAME SAR 63,407,478 — but they are
                // different sets. The strip is every open stage (OPEN_STAGES, on_hold
                // included); this rung is rfq_received + jih only. They agree today
                // because nothing has ever advanced past jih, and would silently
                // disagree the moment one deal did. Naming the stages is what makes
                // the two readable side by side.
                hint: (b.stages as readonly string[])
                  .map((st) => t(canonicalStageLabelKey(st as never)))
                  .join(" · "),
              }))}
            />

            <KpiGroup
              title={lang === "ar" ? "النتائج" : "Outcomes"}
              columns="lg:grid-cols-3 xl:grid-cols-4"
              entries={[
                {
                  kpi: execKpis.lateStageExposure,
                  label: lang === "ar" ? "تعرض المراحل المتأخرة" : "Late-stage exposure",
                  accent: "risk",
                  icon: <Clock className="h-3.5 w-3.5" />,
                },
                {
                  kpi: execKpis.winRate,
                  label: lang === "ar" ? "معدل الفوز" : "Win rate",
                  accent: "won",
                  icon: <ArrowRight className="h-3.5 w-3.5" />,
                },
                {
                  kpi: execKpis.lossRate,
                  label: lang === "ar" ? "معدل الخسارة" : "Loss rate",
                  accent: "risk",
                  icon: <AlertTriangle className="h-3.5 w-3.5" />,
                },
                {
                  kpi: execKpis.lostValue,
                  label: lang === "ar" ? "قيمة الخسائر" : "Lost value",
                  accent: "risk",
                  icon: <Wallet className="h-3.5 w-3.5" />,
                },
              ]}
            />
          </ExecutiveDisclosure>
          <ExecutiveDisclosure
            title={lang === "ar" ? "جودة البيانات" : "Data quality"}
            description={
              lang === "ar"
                ? "الفجوات التي تؤثر على موثوقية الأرقام والتوقعات"
                : "Gaps affecting the reliability of metrics and forecasts"
            }
          >
            {/* §13 — last on the page on purpose: it is hygiene, not today's work. */}
            <section>
              <ChartFrame
                title={t("dq_title" as never)}
                subtitle={
                  lang === "ar"
                    ? "ثغرات في السجلات — تُحسب على حدة عن المخاطر"
                    : "Gaps in the records — counted separately from risk"
                }
                padded={false}
                bodyClassName="p-0"
              >
                {isLoading ? <SkeletonTable rows={4} /> : <DataQualityPanel report={dq} />}
              </ChartFrame>
            </section>
          </ExecutiveDisclosure>
        </>
      )}
      <AskAiPanel
        open={askOpen}
        onClose={() => setAskOpen(false)}
        context={{
          route: "/command-center",
          opportunities: (data?.opportunities ?? []) as unknown as AttentionOpp[],
          today,
        }}
      />

      <PipelineBreakdownDrawer
        open={breakdown !== null}
        onClose={() => setBreakdown(null)}
        title={breakdown?.title ?? ""}
        rows={(breakdown?.rows ?? []) as never}
        ownerName={teamName}
      />
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className={`flex ${CHART_H} flex-col items-center justify-center gap-2 text-center`}>
      <div className="grid h-9 w-9 place-items-center rounded-full border border-border/60 bg-surface-2/50 text-muted-foreground">
        <Sparkles className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
