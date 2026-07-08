import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Users, Copy, FileBarChart } from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { AiEvidencePanel } from "@/components/phc/AiEvidencePanel";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canManageSalesPipeline } from "@/lib/roles";
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
          <EmptyState message="Loading…" />
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
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20")
      }
    >
      {icon}
      {busy ? "Running…" : label}
    </button>
  );
}
