import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Activity, CheckCircle2, AlertTriangle, PauseCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { ChartFrame } from "@/components/phc/ChartFrame";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/agent-activity")({
  head: () => ({ meta: [{ title: "Agent Activity — PHC" }, { name: "robots", content: "noindex" }] }),
  component: AgentActivityPage,
});

type Status = "all" | "running" | "completed" | "needs_review" | "paused" | "error";

function statusTone(s: string): "positive" | "attention" | "danger" | "muted" | "neutral" {
  if (s === "completed") return "positive";
  if (s === "needs_review") return "attention";
  if (s === "error") return "danger";
  if (s === "paused") return "muted";
  return "neutral";
}

function fmtTime(iso: string | null, lang: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(lang === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
}

function AgentActivityPage() {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<Status>("all");
  const [agent, setAgent] = useState<string>("all");
  const [query, setQuery] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["agent-runs-all"],
    staleTime: 30_000,
    queryFn: async () =>
      (await supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(200)).data ?? [],
  });

  const agents = useMemo(() => Array.from(new Set(rows.map((r: any) => r.agent_name).filter(Boolean))), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r: any) => {
      if (status !== "all" && r.status !== status) return false;
      if (agent !== "all" && r.agent_name !== agent) return false;
      if (q) {
        const hay = `${r.agent_name ?? ""} ${r.loop_name ?? ""} ${r.summary ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, status, agent, query]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const errors = rows.filter((r: any) => r.status === "error").length;
    const needsReview = rows.filter((r: any) => r.status === "needs_review").length;
    const completed = rows.filter((r: any) => r.status === "completed").length;
    return { total, errors, needsReview, completed };
  }, [rows]);

  const trend = useMemo(() => {
    const buckets: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      buckets[d.toISOString().slice(0, 10)] = 0;
    }
    for (const r of rows as any[]) {
      const key = (r.started_at ?? "").slice(0, 10);
      if (key in buckets) buckets[key]++;
    }
    return Object.entries(buckets).map(([date, count]) => ({
      label: new Date(date).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { weekday: "short" }),
      count,
    }));
  }, [rows, lang]);

  const hasTrendData = trend.some((d) => d.count > 0);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Governance"
        title={t("nav_agent_activity")}
        description="Operational intelligence: every agent run, filtered by module, status, and time."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Runs (recent 200)" value={kpis.total} icon={<Activity className="h-3.5 w-3.5" />} />
        <KpiCard label="Completed" value={kpis.completed} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
        <KpiCard label="Needs review" value={kpis.needsReview} icon={<PauseCircle className="h-3.5 w-3.5" />} />
        <KpiCard label="Errors" value={kpis.errors} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
      </div>

      <div className="mb-6">
        <ChartFrame title="Runs — last 7 days">
          {hasTrendData ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.40 0.015 253 / 0.35)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "oklch(0.50 0.010 253)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "oklch(0.50 0.010 253)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "oklch(0.24 0.020 253 / 0.4)" }}
                    contentStyle={{ background: "oklch(0.20 0.020 253)", border: "1px solid oklch(0.30 0.015 253)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="count" fill="oklch(0.70 0.115 65)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-muted-foreground">No runs in the last 7 days.</div>
          )}
        </ChartFrame>
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agent, loop, summary"
          className="w-full max-w-xs rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
          >
            <option value="all">All agents</option>
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="flex flex-wrap gap-1">
            {(["all", "running", "completed", "needs_review", "paused", "error"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-full border px-3 py-1 text-xs ${status === s ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {s === "all" ? "All" : s.replaceAll("_", " ")}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("empty_agent_runs")} />
      ) : (
        <ol className="space-y-2">
          {filtered.map((r: any) => (
            <li key={r.id} className="rounded-xl border border-border/70 bg-surface/60 px-5 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={statusTone(r.status)}>{r.status?.replaceAll("_", " ") ?? "—"}</StatusPill>
                    <span className="truncate text-sm font-medium text-foreground">{r.loop_name ?? r.agent_name}</span>
                    <StatusPill tone="muted">{r.agent_name}</StatusPill>
                  </div>
                  {r.summary ? <div className="mt-1 text-xs text-muted-foreground">{r.summary}</div> : null}
                  {(r.records_processed != null || r.records_created != null || r.records_updated != null) ? (
                    <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      {r.records_processed != null ? <span className="num" data-tabular="true">{r.records_processed} processed</span> : null}
                      {r.records_created != null ? <span className="num" data-tabular="true">{r.records_created} created</span> : null}
                      {r.records_updated != null ? <span className="num" data-tabular="true">{r.records_updated} updated</span> : null}
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground num" data-tabular="true">
                  {fmtTime(r.started_at, lang)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
