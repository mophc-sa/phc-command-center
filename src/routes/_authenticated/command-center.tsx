import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { MetricTile } from "@/components/phc/MetricTile";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { PriorityItem } from "@/components/phc/PriorityItem";
import { OpportunityCard, type OpportunityRow } from "@/components/phc/OpportunityCard";
import { StatusPill } from "@/components/phc/StatusPill";
import { Activity, CheckCircle2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/command-center")({
  head: () => ({
    meta: [
      { title: "Command Center — PHC Sales Agent" },
      { name: "description", content: "Priority actions, pipeline decisions, and Sales Agent activity." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CommandCenter,
});

function CommandCenter() {
  const { t, lang } = useI18n();
  const nav = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["command-center"],
    queryFn: async () => {
      const [opps, followUps, approvals, agentRuns] = await Promise.all([
        supabase.from("opportunities").select("*").order("last_activity_at", { ascending: false, nullsFirst: false }),
        supabase.from("follow_ups").select("*").in("status", ["due", "overdue", "scheduled"]).order("due_date", { ascending: true }),
        supabase.from("approvals").select("*").eq("status", "pending"),
        supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(6),
      ]);
      return {
        opportunities: (opps.data ?? []) as unknown as OpportunityRow[],
        followUps: followUps.data ?? [],
        approvals: approvals.data ?? [],
        agentRuns: agentRuns.data ?? [],
      };
    },
  });

  const opps = data?.opportunities ?? [];
  const followUps = data?.followUps ?? [];
  const approvals = data?.approvals ?? [];
  const agentRuns = data?.agentRuns ?? [];

  const openPipelineValue = opps
    .filter((o) => !["won", "lost", "archived"].includes(o.stage))
    .reduce((s, o) => s + (o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min ?? 0), 0);

  const today = new Date().toISOString().slice(0, 10);
  const overdue = followUps.filter((f) => (f.status === "overdue") || (f.due_date && f.due_date < today));
  const overdueValue = overdue.reduce((s, f) => {
    const o = opps.find((x) => x.id === f.opportunity_id);
    return s + (o?.quotation_value ?? o?.estimated_value_max ?? o?.estimated_value_min ?? 0);
  }, 0);

  const newlyQualified = opps.filter((o) => o.stage === "qualification").length;

  // Needs Attention: pick top 5 by priority: overdue follow-ups, pending approvals, tier A without recent activity
  const attention = [
    ...overdue.slice(0, 3).map((f) => {
      const o = opps.find((x) => x.id === f.opportunity_id);
      return {
        key: `fu-${f.id}`,
        title: o?.project_name ?? "—",
        subtitle: o?.main_contractor ?? undefined,
        reason: lang === "ar" ? "متابعة متأخرة" : `Follow-up overdue`,
        due: f.due_date,
        tier: (o?.tier ?? "B") as "A" | "B" | "C",
        value: o ? formatCurrency(o.quotation_value ?? o.estimated_value_max, lang, o.currency) : undefined,
        oppId: o?.id,
      };
    }),
    ...approvals.slice(0, 2).map((a) => {
      const o = opps.find((x) => x.id === a.related_opportunity_id);
      return {
        key: `ap-${a.id}`,
        title: o?.project_name ?? "—",
        subtitle: o?.client ?? undefined,
        reason: lang === "ar" ? "بانتظار الاعتماد" : "Qualification awaiting approval",
        due: undefined as string | undefined,
        tier: (o?.tier ?? "A") as "A" | "B" | "C",
        value: o ? formatCurrency(o.estimated_value_max, lang, o.currency) : undefined,
        oppId: o?.id,
      };
    }),
  ].slice(0, 5);

  const highPriority = opps.filter((o) => o.tier === "A" && !["won", "lost", "archived"].includes(o.stage)).slice(0, 6);
  const upcoming = followUps.filter((f) => !overdue.includes(f)).slice(0, 6);
  const discovery = opps.filter((o) => o.stage === "discovery").slice(0, 6);

  return (
    <div className="mx-auto max-w-7xl space-y-10">
      {/* Metrics */}
      <section aria-labelledby="metrics">
        <h1 id="metrics" className="sr-only">
          {t("nav_command_center")}
        </h1>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label={t("metric_pipeline_value")}
            value={formatCurrency(openPipelineValue, lang)}
            hint={`${formatNumber(opps.filter((o) => !["won","lost","archived"].includes(o.stage)).length, lang)} open`}
            onAction={() => nav({ to: "/opportunities" })}
            actionLabel={lang === "ar" ? "استعراض الفرص" : "View pipeline"}
          />
          <MetricTile
            label={t("metric_follow_up_value")}
            value={formatCurrency(overdueValue, lang)}
            hint={`${formatNumber(overdue.length, lang)} overdue`}
            tone={overdue.length > 0 ? "attention" : "neutral"}
            onAction={() => nav({ to: "/follow-ups" })}
            actionLabel={lang === "ar" ? "عرض المتابعات" : "View follow-ups"}
          />
          <MetricTile
            label={t("metric_awaiting_approval")}
            value={formatNumber(approvals.length, lang)}
            tone={approvals.length > 0 ? "attention" : "neutral"}
            onAction={() => nav({ to: "/approvals" })}
            actionLabel={lang === "ar" ? "عرض الاعتمادات" : "Review approvals"}
          />
          <MetricTile
            label={t("metric_newly_qualified")}
            value={formatNumber(newlyQualified, lang)}
            hint={lang === "ar" ? "هذا الأسبوع" : "This week"}
            onAction={() => nav({ to: "/opportunities" })}
            actionLabel={lang === "ar" ? "استعراض" : "Explore"}
          />
        </div>
      </section>

      {/* Needs Attention */}
      <section aria-labelledby="attention">
        <SectionHeader
          title={t("needs_attention")}
          count={attention.length}
          hint={lang === "ar" ? "أهم البنود التي تحتاج قراراً الآن." : "The top items that need a decision now."}
        />
        <div className="rounded-lg border border-border bg-surface p-1 md:px-3 md:py-2">
          {isLoading ? (
            <EmptyState message={t("loading")} />
          ) : attention.length === 0 ? (
            <EmptyState message={t("empty_needs_attention")} />
          ) : (
            attention.map((a) => (
              <PriorityItem
                key={a.key}
                title={a.title}
                subtitle={a.subtitle}
                reason={a.reason}
                tier={a.tier}
                due={a.due ?? undefined}
                value={a.value}
                actionLabel={t("action_review")}
                onAction={() => a.oppId && nav({ to: "/opportunities" })}
              />
            ))
          )}
        </div>
      </section>

      {/* Two-column grid */}
      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <SectionHeader title={t("high_priority_opportunities")} count={highPriority.length} />
          {highPriority.length === 0 ? (
            <EmptyState message={t("empty_opportunities")} />
          ) : (
            <div className="grid gap-3">
              {highPriority.map((o) => <OpportunityCard key={o.id} o={o} lang={lang} />)}
            </div>
          )}
        </div>
        <div>
          <SectionHeader title={t("follow_ups_due")} count={followUps.length} />
          {followUps.length === 0 ? (
            <EmptyState message={t("empty_follow_ups")} />
          ) : (
            <div className="rounded-lg border border-border bg-surface p-1 md:px-3 md:py-2">
              {upcoming.map((f) => {
                const o = opps.find((x) => x.id === f.opportunity_id);
                return (
                  <PriorityItem
                    key={f.id}
                    title={o?.project_name ?? "—"}
                    subtitle={o?.main_contractor ?? undefined}
                    reason={f.status === "overdue" ? (lang === "ar" ? "متأخرة" : "Overdue") : (lang === "ar" ? "مجدولة" : "Scheduled")}
                    tier={(o?.tier ?? "B") as "A" | "B" | "C"}
                    due={f.due_date}
                    actionLabel={t("action_schedule")}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Discovery + Agent Activity */}
      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <SectionHeader title={t("new_opportunities")} count={discovery.length} />
          {discovery.length === 0 ? (
            <EmptyState message={t("empty_discovery")} />
          ) : (
            <div className="grid gap-3">
              {discovery.map((o) => <OpportunityCard key={o.id} o={o} lang={lang} />)}
            </div>
          )}
        </div>
        <div>
          <SectionHeader
            title={t("agent_activity")}
            count={agentRuns.length}
            action={<StatusPill tone="positive"><Sparkles className="h-3 w-3" /> {t("agent_status_running")}</StatusPill>}
          />
          {agentRuns.length === 0 ? (
            <EmptyState message={t("empty_agent_runs")} />
          ) : (
            <ol className="rounded-lg border border-border bg-surface">
              {agentRuns.map((r) => (
                <li key={r.id} className="flex items-start gap-3 border-t border-border/70 px-4 py-3 first:border-t-0">
                  <div className="mt-0.5">
                    {r.status === "error" ? (
                      <Activity className="h-4 w-4 text-amber" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-sm text-foreground">{r.loop_name ?? r.agent_name}</div>
                      <span className="text-xs text-muted-foreground num" data-tabular="true">
                        {new Date(r.started_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US")}
                      </span>
                    </div>
                    {r.summary ? (
                      <div className="mt-1 truncate text-xs text-muted-foreground">{r.summary}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
