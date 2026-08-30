import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Clock,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KpiTile } from "@/components/phc/KpiTile";
import {
  MANAGEMENT_BUCKETS,
  bucketKpi,
  executiveKpis,
  forecastVsTarget,
  pipelineHealth,
  thisMonth,
  type ManagementBucketKey,
  type OppRow,
} from "@/lib/sales-kpis";
import { useI18n, formatCurrency, formatNumber, localeFor } from "@/lib/i18n";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { KpiGroup } from "@/components/phc/KpiGroup";
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
import { StatusPill } from "@/components/phc/StatusPill";
import type { OpportunityRow } from "@/components/phc/OpportunityCard";
import {
  resolveCanonicalStage,
  groupByCanonicalStage,
  canonicalStageLabelKey,
  CANONICAL_ACTIVE_STAGES,
  CANONICAL_FUNNEL_ORDER,
} from "@/lib/stage-canonical";
import { isSalesperson, canManageSalesPipeline, isSystemAdmin, isFinanceManager, type AppRole } from "@/lib/roles";

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
    const hasElevatedRole = canManageSalesPipeline(roles) || isSystemAdmin(roles) || isFinanceManager(roles);
    if (isSalesperson(roles) && !hasElevatedRole) {
      throw redirect({ to: "/my-workspace" });
    }
  },
  head: () => ({
    meta: [
      { title: "Command Center — PHC Sales Agent" },
      { name: "description", content: "Executive operating view: pipeline, follow-ups, RFQ activity, and priority work." },
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
  get primary() { return getCssVar("--chart-primary") || "oklch(0.20 0.010 253)"; },
  get primaryDim() { return getCssVar("--chart-primary-dim") || "oklch(0.55 0.010 253)"; },
  get amber() { return getCssVar("--chart-amber") || "oklch(0.62 0.135 65)"; },
  get amberDim() { return getCssVar("--chart-amber-dim") || "oklch(0.75 0.09 65)"; },
  get muted() { return getCssVar("--chart-muted") || "oklch(0.90 0.006 90)"; },
  get grid() { return getCssVar("--chart-grid") || "oklch(0.60 0.010 253 / 0.14)"; },
  get surface() { return getCssVar("--color-surface") || "oklch(1 0 0)"; },
  get border() { return getCssVar("--color-border") || "oklch(0.20 0.010 253 / 0.09)"; },
};

const CHART_H = "h-[240px]";
const CHART_H_SM = "h-[160px]";

function CommandCenter() {
  const { t, lang } = useI18n();
  const nav = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["cc-core"],
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 29);
      const sinceIso = since.toISOString();

      const [opps, followUps, approvals, agentRuns, activities, rfqs, quotations, transitions, stakeholders] = await Promise.all([
        // Paged to completion, not capped. The old cap here silently
        // computed every KPI over the first 200 rows: at 201 opportunities the
        // pipeline total was confidently, precisely wrong with nothing on
        // screen saying so.
        fetchAllRows(() =>
          supabase
            .from("opportunities")
            .select("id, project_name, stage, sales_stage, tier, pipeline_step, estimated_value_min, estimated_value_max, quotation_value, contract_value, currency, owner_id, last_activity_at, next_action, next_action_due, client, main_contractor, human_win_probability, score, loss_reason, lost_at_stage, lost_to_competitor, expected_contract_date, contractor_decision_maker, updated_at, created_at")
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
        supabase.from("ai_agent_runs").select("*").order("started_at", { ascending: false }).limit(6),
        // activity_type + status decide whether a row counts as client contact:
        // a note is internal and an unsent draft never reached anyone.
        supabase.from("activities").select("id, related_opportunity_id, activity_type, status, occurred_at").gte("occurred_at", sinceIso),
        fetchAllRows(() =>
          supabase
            .from("rfqs")
            .select("id, rfq_number, status, estimated_value, received_date, response_due_date, opportunity_id, classification"),
        ),
        fetchAllRows(() =>
          supabase.from("quotations").select("id, related_opportunity_id, status, value, issued_date"),
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
      return {
        opportunities: opps.rows as unknown as OpportunityRow[],
        followUps: followUps.rows,
        stakeholders: stakeholders.rows,
        // One truncated source makes every derived metric unreliable, so
        // completeness is an AND across the set that feeds the KPIs.
        complete: allComplete(opps, followUps, rfqs, quotations, stakeholders, transitions),
        approvals: approvals.data ?? [],
        agentRuns: agentRuns.data ?? [],
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
  const { data: teamTarget } = useQuery({
    queryKey: ["cc-team-target"],
    staleTime: 60_000,
    queryFn: async () => {
      const annYear = `${new Date().getFullYear()}-01-01`;
      const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
      const [annual, monthly] = await Promise.all([
        supabase.from("sales_targets").select("sales_target").eq("period_type", "annual").eq("period_start", annYear),
        supabase.from("sales_targets").select("sales_target").eq("period_type", "monthly").eq("period_start", monthStart),
      ]);
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
  const agentRuns = data?.agentRuns ?? [];
  const activities = data?.activities ?? [];
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
  const openPipelineValue = openOpps.reduce(
    (s, o) => s + (o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min ?? 0),
    0,
  );

  const today = new Date().toISOString().slice(0, 10);
  const overdue = followUps.filter((f: any) => f.status === "overdue" || (f.due_date && f.due_date < today));
  const overdueValue = overdue.reduce((s: number, f: any) => {
    const o = opps.find((x) => x.id === f.opportunity_id);
    return s + (o?.quotation_value ?? o?.estimated_value_max ?? o?.estimated_value_min ?? 0);
  }, 0);

  const newlyQualified = opps.filter((o) => canonicalOf(o) === "jih").length;

  // Pipeline by stage — the real PHC flow (rfq_received → … → contract_signed),
  // not the generic CRM buckets this used to show.
  const pipelineByStage = useMemo(() => {
    const grouped = groupByCanonicalStage(opps as unknown as Parameters<typeof groupByCanonicalStage>[0]);
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

  /** Open deals carrying no value at all — excluded from the total, and said so. */
  const unvaluedOpenCount = useMemo(
    () =>
      openOpps.filter(
        (o) => (o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min ?? null) === null,
      ).length,
    [openOpps],
  );

  // How much of the chart above rests on rows with no sales_stage, where the
  // position had to be inferred. Surfaced rather than averaged in silently —
  // a number built from guesses is not the same quality as one built from data.
  const inferredCount = useMemo(
    () => groupByCanonicalStage(opps as unknown as Parameters<typeof groupByCanonicalStage>[0]).inferredCount,
    [opps],
  );

  // Activity trend (last 30 days)
  const activityTrend = useMemo(() => {
    const days: { date: string; label: string; count: number }[] = [];
    const map = new Map<string, number>();
    for (const a of activities) {
      const d = (a.occurred_at ?? "").slice(0, 10);
      if (!d) continue;
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      days.push({
        date: iso,
        label: d.toLocaleDateString(localeFor(lang), { month: "short", day: "numeric" }),
        count: map.get(iso) ?? 0,
      });
    }
    return days;
  }, [activities, lang]);

  // Follow-ups status distribution
  const followUpsStatus = useMemo(() => {
    let overdueC = 0, dueToday = 0, upcoming = 0, scheduled = 0;
    for (const f of followUps as any[]) {
      const dd = f.due_date as string | null;
      if (f.status === "overdue" || (dd && dd < today)) overdueC++;
      else if (dd === today) dueToday++;
      else if (f.status === "due") upcoming++;
      else scheduled++;
    }
    return [
      { key: "overdue", label: lang === "ar" ? "متأخر" : "Overdue", value: overdueC, color: CHART_COLORS.amber },
      { key: "today", label: lang === "ar" ? "اليوم" : "Today", value: dueToday, color: CHART_COLORS.primary },
      { key: "due", label: lang === "ar" ? "مستحق" : "Due", value: upcoming, color: CHART_COLORS.primaryDim },
      { key: "scheduled", label: lang === "ar" ? "مجدول" : "Scheduled", value: scheduled, color: CHART_COLORS.muted },
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
    for (const s of (data?.stakeholders ?? []) as Array<StakeholderRow & { opportunity_id?: string | null }>) {
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
        ctx: { today, period: thisMonth(today) },
        targetAmount: teamTarget?.total && teamTarget.total > 0 ? teamTarget.total : null,
      }),
    [data, today, teamTarget],
  );

  // A separate query on purpose: a slow or failing model must not hold up the
  // facts. `retry: false` because a brief nobody is waiting for is not worth
  // three attempts, and `ok === false` is a normal outcome here, not an error.
  const commentary = useQuery({
    queryKey: ["cc-brief-commentary"],
    staleTime: 900_000,
    retry: false,
    enabled: (data?.opportunities ?? []).length > 0,
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
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });
  const teamName = (id: string) => {
    const m = (teamMembers as Array<{ id: string; full_name?: string | null; email?: string | null }>).find(
      (x) => x.id === id,
    );
    return m?.full_name ?? m?.email ?? id.slice(0, 8);
  };

  // §12 — business-facing AI insights. Every line is a count the deterministic
  // engines already produced, which is what lets this panel render unchanged
  // when no AI provider is reachable.
  const aiInsights = useMemo(() => {
    const health = pipelineHealth((data?.opportunities ?? []) as unknown as OppRow[], { today, period: null });
    const countIssue = (issue: string) => new Set(health.filter((h) => h.issue === issue).map((h) => h.opportunityId)).size;
    return [
      {
        key: "at_risk",
        label: lang === "ar" ? "فرص معرَّضة للخطر" : "Opportunities at risk",
        count: attentionSummary.atRisk.count,
        detail: attentionSummary.atRisk.value > 0 ? formatCurrency(attentionSummary.atRisk.value, lang) : null,
      },
      {
        key: "overdue",
        label: lang === "ar" ? "متابعات متأخرة" : "Overdue follow-ups",
        count: overdue.length,
        detail: null,
      },
      {
        key: "closing",
        label: lang === "ar" ? "إغلاق خلال 30 يومًا" : "Closing within 30 days",
        count: attentionSummary.closingSoon.count,
        detail: attentionSummary.closingSoon.value > 0 ? formatCurrency(attentionSummary.closingSoon.value, lang) : null,
      },
      {
        key: "no_dm",
        label: lang === "ar" ? "بلا صانع قرار" : "No decision maker identified",
        count: attention.filter((a) => a.reasons.some((r) => r.kind === "no_decision_maker")).length,
        detail: null,
      },
      {
        key: "incomplete",
        label: lang === "ar" ? "بيانات تجارية ناقصة" : "Incomplete commercial data",
        count: new Set(
          health
            .filter((h) => h.issue === "unscored" || h.issue === "no_next_action")
            .map((h) => h.opportunityId),
        ).size,
        detail: lang === "ar" ? "بلا احتمالية أو إجراء تالٍ" : "No probability or no next action",
      },
      {
        key: "rfq_overdue",
        label: lang === "ar" ? "طلبات تجاوزت موعد الرد" : "RFQs past their response date",
        count: rfqOverdue.length,
        detail: null,
      },
    ];
  }, [data, today, lang, attention, attentionSummary, overdue, rfqOverdue]);

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
    const ctx = { today, period: thisMonth(today) };
    return {
      forecast: forecastVsTarget(rows, ctx, teamTarget?.total && teamTarget.total > 0 ? teamTarget.total : null),
      buckets: Object.fromEntries(
        MANAGEMENT_BUCKETS.map((b) => [b.key, bucketKpi(rows, ctx, b.key)]),
      ) as Record<ManagementBucketKey, ReturnType<typeof bucketKpi>>,
    };
  }, [data, teamTarget]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={lang === "ar" ? "نظرة تنفيذية" : "Executive Overview"}
        title={t("nav_command_center")}
        description={
          lang === "ar"
            ? "خط الأنابيب، المتابعات، وأولويات القرار في مكان واحد."
            : "Pipeline, follow-ups, and decision-ready priorities in a single view."
        }
      />

      {/* ── Sales Management (Phase 5) ──────────────────────────────────────
          Canonical KPIs from src/lib/sales-kpis.ts. Every tile carries its own
          formula, source, active filters and record ids, and links to exactly
          the records behind the number — the tooltip cannot drift from the
          value because both are read off the same object. */}
      {/* The one thing worse than a truncated dataset is a truncated dataset
          that looks complete. Every KPI below derives from these rows, so if
          the ceiling stopped the read, the reader is told before they read a
          single number. */}
      {data && !data.complete ? (
        <Callout tone="critical" className="mb-4">
          <p>
            {lang === "ar"
              ? "تجاوز حجم البيانات حدّ القراءة، فالأرقام أدناه محسوبة على جزء من الدفتر لا عليه كاملًا."
              : "The dataset exceeded the read ceiling, so the figures below are computed over part of the book, not all of it."}
          </p>
        </Callout>
      ) : null}

      {/* §11 — the brief leads. It is the one thing a manager can read in
          fifteen seconds, and it stands entirely on counted records. */}
      {isLoading ? null : (
        <ExecutiveBrief brief={brief} commentaryState={commentaryState} />
      )}

      {/* The total, and what it is made of, before anything else.
          It used to be stated twice — once here and once on the commercial
          ladder below — as two identical cards with no breakdown anywhere. A
          figure that size is a question, not a finding; this answers it in the
          space the duplicate used to take. */}
      <PipelineComposition
        slices={compositionSlices}
        total={openPipelineValue}
        recordCount={openOpps.length}
        unvaluedCount={unvaluedOpenCount}
      />

      {/* Phase 5.1 §5 — the numbers the month is run on. KpiGroup keeps the
          ones with a value as cards and folds the rest into a single line that
          names each and why it cannot be computed. Nothing is dropped: on
          2026-08-30 fifteen of nineteen tiles here said "no data" or "needs
          setup", each at the size of a real number, and the seven charts below
          were pushed off the screen by them. */}
      <KpiGroup
        title={lang === "ar" ? "مؤشرات المبيعات" : "Sales performance"}
        subtitle={lang === "ar" ? "هذا الشهر · اضغط أي رقم لفتح سجلاته" : "This month · click any number to open its records"}
        entries={[
          {
            kpi: execKpis.openPipeline,
            label: t("mgmt_open_pipeline" as never),
            onOpen: () =>
              setBreakdown({
                title: t("mgmt_open_pipeline" as never),
                rows: (data?.opportunities ?? []).filter((o) =>
                  execKpis.openPipeline.recordIds.includes(o.id),
                ) as unknown as OppRow[],
              }),
          },
          // Forecast is the WEIGHTED pipeline: a forecast that ignores
          // probability is the pipeline again under a more confident name.
          { kpi: forecast.forecast, label: t("kpi_forecast" as never) },
          { kpi: forecast.target, label: t("kpi_target_sales" as never) },
          { kpi: forecast.won, label: lang === "ar" ? "المحقق (Won فقط)" : "Won (official)" },
          { kpi: forecast.achievement, label: t("kpi_achievement" as never) },
          { kpi: forecast.coverage, label: t("kpi_coverage" as never) },
        ]}
      />

      {/* Phase 5.1 §1 — the commercial ladder. Mutually exclusive by
          construction, so these add up; on_hold and lost sit outside it. */}
      <KpiGroup
        title={lang === "ar" ? "خط الأنابيب حسب الموقع التجاري" : "Pipeline by commercial position"}
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
          hint: (b.stages as readonly string[]).map((st) => t(canonicalStageLabelKey(st as never))).join(" · "),
        }))}
      />

      <KpiGroup
        title={lang === "ar" ? "النتائج" : "Outcomes"}
        columns="lg:grid-cols-3 xl:grid-cols-4"
        entries={[
          { kpi: execKpis.lateStageExposure, label: lang === "ar" ? "تعرض المراحل المتأخرة" : "Late-stage exposure" },
          { kpi: execKpis.winRate, label: lang === "ar" ? "معدل الفوز" : "Win rate" },
          { kpi: execKpis.lossRate, label: lang === "ar" ? "معدل الخسارة" : "Loss rate" },
          { kpi: execKpis.lostValue, label: lang === "ar" ? "قيمة الخسائر" : "Lost value" },
        ]}
      />

      {/* Phase 5.1 §6/§9 — Action Required, and the three risk roll-ups beside
          it. This sat at the bottom of the page under the charts; it is the one
          section a sales manager opens the dashboard to read, so it now sits
          directly under the numbers and above every chart. */}
      <section className="mt-6">
        <div className="mb-2 grid gap-3 sm:grid-cols-3">
          {([
            ["at_risk", attentionSummary.atRisk, lang === "ar" ? "معرَّضة للخطر" : "At risk"],
            ["stalled", attentionSummary.stalled, lang === "ar" ? "متوقفة" : "Stalled"],
            ["closing", attentionSummary.closingSoon, lang === "ar" ? "إغلاق قريب" : "Closing soon"],
          ] as const).map(([key, roll, label]) => (
            <div key={key} className="rounded-xl border border-border/70 bg-surface/60 px-4 py-3">
              <div className="text-xs font-medium tracking-[0.02em] text-muted-foreground">{label}</div>
              <div className="num mt-1 text-[20px] font-semibold leading-none text-foreground" data-tabular="true">
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
          title={t("needs_attention")}
          subtitle={
            lang === "ar"
              ? "صف واحد لكل فرصة · اضغط لترى القواعد التي أطلقت التصنيف"
              : "One row per opportunity · open a row to see which rules fired"
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
            <div className="px-3 py-6"><EmptyState message={t("empty_needs_attention")} /></div>
          ) : (
            <NeedsAttentionPanel items={attention.slice(0, 8)} />
          )}
        </ChartFrame>
      </section>

      {/* KPI row */}
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label={lang === "ar" ? "الهدف الإجمالي للفريق" : "Team Target"}
          value={teamTarget && teamTarget.total > 0 ? formatCurrency(teamTarget.total, lang, "SAR") : "—"}
          hint={
            teamTarget?.periodType === "annual"
              ? (lang === "ar" ? "هدف سنوي" : "Annual target")
              : (lang === "ar" ? "هدف شهري" : "Monthly target")
          }
          icon={<Target className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label={t("metric_pipeline_value")}
          value={formatCurrency(openPipelineValue, lang)}
          hint={`${formatNumber(openOpps.length, lang)} ${lang === "ar" ? "فرصة مفتوحة" : "open opportunities"}`}
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label={t("metric_follow_up_value")}
          value={formatCurrency(overdueValue, lang)}
          hint={`${formatNumber(overdue.length, lang)} ${lang === "ar" ? "متأخرة" : "overdue"}`}
          trend={overdue.length > 0 ? "down" : "flat"}
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label={t("metric_awaiting_approval")}
          value={formatNumber(approvals.length, lang)}
          hint={approvals.length > 0 ? (lang === "ar" ? "بحاجة قرار" : "Awaiting decision") : (lang === "ar" ? "لا يوجد" : "All clear")}
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label={t("metric_newly_qualified")}
          value={formatNumber(newlyQualified, lang)}
          hint={lang === "ar" ? "قيد التأهيل" : "In qualification"}
          icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />}
        />
      </section>

      {/* Charts row 1 */}
      {/* One chart now, not two: the "Team activity (30 days)" line chart that
          sat beside this was the widget §15 replaced, and it was still
          rendering below the Sales Execution table it had been superseded by. */}
      <section className="mt-6 grid gap-3">
        <ChartFrame
          title={lang === "ar" ? "قيمة خط الأنابيب حسب المرحلة" : "Pipeline value by stage"}
          subtitle={
            <>
              {lang === "ar" ? "الفرص المفتوحة فقط" : "Open opportunities only"}
              {/* The disclosure this number was computed for. `inferredCount`
                  had been calculated on every render and never rendered, so a
                  bar built partly from guessed stage positions looked exactly
                  as solid as one built from recorded ones. */}
              {inferredCount > 0 && (
                <span className="ms-2 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-2xs font-medium text-amber-light">
                  {lang === "ar"
                    ? `${formatNumber(inferredCount, lang)} استُنتجت مرحلتها`
                    : `${formatNumber(inferredCount, lang)} inferred`}
                </span>
              )}
            </>
          }
        >
          {openOpps.length === 0 ? (
            <EmptyChart label={lang === "ar" ? "لا توجد فرص مفتوحة" : "No open opportunities yet"} />
          ) : (
            <div className={CHART_H}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pipelineByStage} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="stage" tick={{ fill: CHART_COLORS.primaryDim, fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fill: CHART_COLORS.primaryDim, fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(v))}
                  />
                  <Tooltip
                    contentStyle={{ background: CHART_COLORS.surface, border: `1px solid ${CHART_COLORS.border}`, borderRadius: 8, fontSize: 12, color: CHART_COLORS.primary }}
                    // v3 types the value as ValueType (number | string | array),
                    // so the old `v: number` annotation no longer matches. The bars
                    // are numeric; coerce rather than assert.
                    formatter={(v, name) => {
                      const n = typeof v === "number" ? v : Number(v);
                      return name === "value" ? formatCurrency(n, lang) : formatNumber(n, lang);
                    }}
                    cursor={{ fill: CHART_COLORS.muted }}
                  />
                  {/* Coloured by the same ramp as the composition bar above. One
                      stage was one colour there and a different colour here,
                      so the two pictures of the same data disagreed. */}
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={44}>
                    {pipelineByStage.map((b) => (
                      <Cell key={b.key} fill={`var(--stage-${b.tone})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartFrame>

      </section>

      {/* Charts row 2 */}
      <section className="mt-3 grid gap-3 lg:grid-cols-2">
        <ChartFrame
          title={lang === "ar" ? "حالة المتابعات" : "Follow-ups by status"}
          subtitle={lang === "ar" ? "توزيع المتابعات النشطة" : "Distribution of active follow-ups"}
        >
          {followUps.length === 0 ? (
            <EmptyChart label={lang === "ar" ? "لا توجد متابعات نشطة" : "No active follow-ups"} />
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-6">
              <div className="space-y-2.5">
                {followUpsStatus.map((s) => {
                  const total = followUpsStatus.reduce((a, b) => a + b.value, 0) || 1;
                  const pct = Math.round((s.value / total) * 100);
                  return (
                    <div key={s.key}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                          {s.label}
                        </span>
                        <span className="num text-foreground" data-tabular="true">{formatNumber(s.value, lang)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={CHART_H_SM}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={followUpsStatus} dataKey="value" nameKey="label" innerRadius={44} outerRadius={64} paddingAngle={2} stroke="none">
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
              : lang === "ar" ? `${rfqTotal} طلب` : `${rfqTotal} RFQs`
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
                  <div key={b.bucket} className="rounded-lg border border-border/70 bg-surface/60 px-2.5 py-2">
                    <div className="text-2xs tracking-[0.02em] text-muted-foreground">
                      {b.bucket === "15+" ? (lang === "ar" ? "+15 يوم" : "15+ days") : `${b.bucket}${lang === "ar" ? " يوم" : "d"}`}
                    </div>
                    <div className="num mt-0.5 text-lg font-semibold leading-none text-foreground" data-tabular="true">
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
                      <span className="text-muted-foreground">{t(`rfqw_${st.state}` as never)}</span>
                      <span className="num text-foreground" data-tabular="true">{formatNumber(st.count, lang)}</span>
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


      {/* §18 — persistent, and it stays out of the way until asked. It is
          handed ROWS, never a client, so it cannot reach a record the signed-in
          user could not already open. */}
      <button
        type="button"
        onClick={() => setAskOpen(true)}
        className="fixed bottom-5 end-5 z-40 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground shadow-lg transition-colors hover:border-border-strong"
      >
        <Sparkles className="h-3.5 w-3.5 text-amber-light" aria-hidden="true" />
        {t("ask_ai_open" as never)}
      </button>

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

      {/* Phase 5.1 §12 — AI INSIGHTS, business-facing.
          This slot held Agent Activity: contact_mapping, data_cleanup,
          risk_finance, "scaffold — enrichment source not configured". Real
          information, addressed to a developer, occupying the most valuable
          column on a sales manager's screen. The audit trail is NOT deleted —
          /agent-activity already reads the same ai_agent_runs table and is
          reachable from Admin → AI Audit, role-gated as before.

          What replaces it is deterministic: every line is a count the engines
          above already computed, so this panel renders identically whether or
          not an AI provider is reachable. */}
      {/* minmax(0,1fr) on the SINGLE-column case too, not just lg. A default
          grid column is auto-sized to max-content, so the 560px-min execution
          table below stretched the column, the card, and the page — dragging
          the whole document sideways on a phone instead of scrolling inside
          its own overflow-x-auto. Verified at 375px in both directions. */}
      <section className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartFrame
          title={lang === "ar" ? "تنفيذ المبيعات" : "Sales execution"}
          subtitle={
            lang === "ar"
              ? "ما يحمله كل مندوب وما تحرّك — لا عدّ مكالمات"
              : "What each rep carries and what has moved — not a count of calls"
          }
          padded={false}
        >
          {execution.length === 0 ? (
            <div className="px-5 py-6"><EmptyState message={lang === "ar" ? "لا فرص مُسنَدة بعد" : "No assigned opportunities yet"} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-2xs tracking-[0.02em] text-muted-foreground">
                    <th className="px-4 py-2 text-start">{lang === "ar" ? "المندوب" : "Salesperson"}</th>
                    <th className="px-3 py-2 text-end">{lang === "ar" ? "مفتوح" : "Open"}</th>
                    <th className="px-3 py-2 text-end">{lang === "ar" ? "مرجّح" : "Weighted"}</th>
                    <th className="px-3 py-2 text-end">{lang === "ar" ? "متابعات" : "Follow-ups"}</th>
                    <th className="px-3 py-2 text-end">{lang === "ar" ? "اجتماعات" : "Meetings"}</th>
                    <th className="px-3 py-2 text-end">{lang === "ar" ? "متوقفة" : "Stalled"}</th>
                  </tr>
                </thead>
                <tbody>
                  {execution.map((r) => (
                    <tr key={r.ownerId} className="border-b border-border/50">
                      <td className="px-4 py-2.5 text-foreground">{teamName(r.ownerId)}</td>
                      <td className="num px-3 py-2.5 text-end" data-tabular="true">
                        {r.openPipeline === null ? (
                          <span className="text-xs text-muted-foreground">
                            {lang === "ar" ? `بلا قيمة (${r.unpricedCount})` : `No value (${r.unpricedCount})`}
                          </span>
                        ) : (
                          <span className="text-foreground">{formatCurrency(r.openPipeline, lang)}</span>
                        )}
                      </td>
                      <td className="num px-3 py-2.5 text-end" data-tabular="true">
                        {/* Null, not zero: a book nobody has scored is not a
                            book worth nothing. Same rule as the company total. */}
                        {r.weightedPipeline === null ? (
                          <span className="text-xs text-muted-foreground">
                            {lang === "ar" ? `غير محتسَب (${r.unscoredCount})` : `Not calculated (${r.unscoredCount})`}
                          </span>
                        ) : (
                          <span className="text-foreground">{formatCurrency(r.weightedPipeline, lang)}</span>
                        )}
                      </td>
                      <td className="num px-3 py-2.5 text-end text-foreground" data-tabular="true">{formatNumber(r.followUpsDue, lang)}</td>
                      <td className="num px-3 py-2.5 text-end text-foreground" data-tabular="true">{formatNumber(r.meetings, lang)}</td>
                      <td className="num px-3 py-2.5 text-end" data-tabular="true">
                        {r.stalledCount === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="text-amber-light">
                            {formatNumber(r.stalledCount, lang)}
                            {r.stalledValue > 0 ? ` · ${formatCurrency(r.stalledValue, lang)}` : ""}
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

        <ChartFrame title={lang === "ar" ? "ملخص الذكاء" : "AI insights"} padded={false}>
          <ul className="divide-y divide-border/50">
            {aiInsights.map((i) => (
              <li key={i.key} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-foreground">{i.label}</span>
                  <span className="num shrink-0 text-base font-semibold text-foreground" data-tabular="true">
                    {i.count === null ? "—" : formatNumber(i.count, lang)}
                  </span>
                </div>
                {i.detail ? <div className="mt-0.5 text-xs text-muted-foreground">{i.detail}</div> : null}
              </li>
            ))}
          </ul>
        </ChartFrame>
      </section>

      {/* §13 — last on the page on purpose: it is hygiene, not today's work. */}
      <section className="mt-6">
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
