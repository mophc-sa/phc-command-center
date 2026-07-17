import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Users, Copy, FileBarChart, Activity } from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonCard } from "@/components/phc/Skeleton";
import { AiEvidencePanel } from "@/components/phc/AiEvidencePanel";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canManageSalesPipeline } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";
import {
  listRecommendations,
  listAgentRuns,
  runLeadScoring,
  runDuplicateDetection,
  generateWeeklyReport,
  sendRecommendationFeedback,
  runAgent,
  AGENT_ACTIONS,
  type FeedbackAction,
} from "@/lib/ai-actions";

export const Route = createFileRoute("/_authenticated/ai-agents")({
  head: () => ({ meta: [{ title: "AI Agents — PHC" }, { name: "robots", content: "noindex" }] }),
  component: AiAgentsPage,
});

function AiAgentsPage() {
  const { roles } = useAuth();
  const canRun = canManageSalesPipeline(roles);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const [radarAlerts, setRadarAlerts] = useState<any[]>([]);
  const [radarScore, setRadarScore] = useState<number | null>(null);
  const [radarSummary, setRadarSummary] = useState("");
  const [radarRunning, setRadarRunning] = useState(false);
  const [radarError, setRadarError] = useState<string | null>(null);

  async function handleRunRadar() {
    setRadarRunning(true);
    setRadarError(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-orchestrator", {
        body: { agent: "project_radar", entityType: "pipeline", entityId: "pipeline" },
      });
      if (error || !data?.ok) throw new Error(data?.message ?? error?.message ?? "Failed");
      const result = data.result;
      setRadarAlerts(result.radar_alerts ?? []);
      setRadarScore(result.pipeline_health_score ?? null);
      setRadarSummary(result.summary ?? "");
    } catch (e: any) {
      setRadarError(e.message);
    } finally {
      setRadarRunning(false);
    }
  }

  const { data: recs = [], isLoading } = useQuery({ queryKey: ["ai-recs"], queryFn: () => listRecommendations("pending") });
  const { data: runs = [] } = useQuery({ queryKey: ["ai-runs"], queryFn: listAgentRuns });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai-recs"] });
    qc.invalidateQueries({ queryKey: ["ai-runs"] });
  };

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      const r: any = await fn();
      if (r?.configured === false) toast.message(`${label}: not configured`, { description: r.detail });
      else toast.success(`${label} complete`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function onAction(recId: string, action: FeedbackAction) {
    setBusy(recId);
    try {
      await sendRecommendationFeedback(recId, action);
      toast.success(`Recommendation ${action}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Intelligence" title="AI Agents" description="Real-data agents. Every recommendation shows its evidence; nothing is applied automatically." />

      {canRun ? (
        <Panel title="Run agents">
          <div className="flex flex-wrap gap-2">
            <RunButton icon={<Sparkles className="h-3.5 w-3.5" />} label="Lead Scoring" busy={busy === "Lead Scoring"} onClick={() => run("Lead Scoring", runLeadScoring)} />
            <RunButton icon={<Copy className="h-3.5 w-3.5" />} label="Duplicate Detection" busy={busy === "Duplicate Detection"} onClick={() => run("Duplicate Detection", runDuplicateDetection)} />
            <RunButton icon={<FileBarChart className="h-3.5 w-3.5" />} label="Weekly Report" busy={busy === "Weekly Report"} onClick={() => run("Weekly Report", generateWeeklyReport)} />
            {Object.entries(AGENT_ACTIONS).map(([key, action]) => (
              <RunButton key={key} icon={<Users className="h-3.5 w-3.5" />} label={key} muted busy={busy === key} onClick={() => run(key, () => runAgent(action))} />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Muted agents need an external source/credential and will honestly report “not configured”.
          </p>
        </Panel>
      ) : null}

      <Panel title="Recommendations">
        {isLoading ? (
          <SkeletonCard count={3} />
        ) : recs.length === 0 ? (
          <EmptyState message="No pending recommendations. Run an agent to generate evidence-backed suggestions." />
        ) : (
          <div className="space-y-3">
            {recs.map((rec) => (
              <AiEvidencePanel key={rec.id} rec={rec} busy={busy === rec.id} onAction={(a) => onAction(rec.id, a)} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Recent runs">
        {runs.length === 0 ? (
          <div className="text-xs text-muted-foreground">No runs yet.</div>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <span className="text-foreground">{r.agent_key}</span>
                <span className="text-muted-foreground">
                  {r.status}
                  {r.status !== "not_configured" ? ` · ${r.recommendations_created} recs / ${r.records_scanned} scanned` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Project Radar">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <RunButton
              icon={<Activity className="h-3.5 w-3.5" />}
              label="Scan Pipeline"
              busy={radarRunning}
              onClick={handleRunRadar}
            />
            {radarScore !== null && (
              <span className="rounded-md border border-won/30 bg-won/10 px-3 py-1 text-xs font-medium text-won">
                Pipeline Health: {radarScore}/100
              </span>
            )}
          </div>

          {radarRunning && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Scanning pipeline…
            </div>
          )}

          {radarError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive/90">
              {radarError}
            </div>
          )}

          {radarSummary && (
            <p className="text-sm text-muted-foreground leading-relaxed">{radarSummary}</p>
          )}

          {radarAlerts.length > 0 && (
            <div className="space-y-2">
              {(["high", "medium", "low"] as const).map((sev) => {
                const group = radarAlerts.filter((a: any) => a.severity === sev);
                if (group.length === 0) return null;
                return (
                  <div key={sev} className="space-y-1.5">
                    {group.map((alert: any, i: number) => (
                      <div
                        key={i}
                        className="rounded-md border border-border bg-surface px-3 py-2.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span
                            className={
                              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                              (sev === "high"
                                ? "bg-destructive/15 text-destructive"
                                : sev === "medium"
                                ? "bg-amber/15 text-amber-light"
                                : "bg-info/15 text-info")
                            }
                          >
                            {sev}
                          </span>
                          {alert.entity_name && (
                            <span className="font-medium text-foreground">{alert.entity_name}</span>
                          )}
                        </div>
                        {alert.description && (
                          <p className="text-muted-foreground leading-relaxed">{alert.description}</p>
                        )}
                        {alert.recommended_action && (
                          <p className="mt-1 text-muted-foreground/80 italic">{alert.recommended_action}</p>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {!radarRunning && radarAlerts.length === 0 && radarScore === null && (
            <div className="text-xs text-muted-foreground">
              Click "Scan Pipeline" to run the Project Radar agent.
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function RunButton({ icon, label, onClick, busy, muted }: { icon: React.ReactNode; label: string; onClick: () => void; busy?: boolean; muted?: boolean }) {
  return (
    <button
      disabled={busy}
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 " +
        (muted
          ? "border-border bg-surface text-muted-foreground hover:text-foreground"
          : "border-won/40 bg-won/10 text-won hover:bg-won/[0.16]")
      }
    >
      {icon}
      {busy ? "Running…" : label}
    </button>
  );
}
