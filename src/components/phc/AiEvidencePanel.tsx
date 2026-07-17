import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Eye, ShieldAlert, FileSearch } from "lucide-react";
import { StatusPill } from "@/components/phc/StatusPill";
import { EmailComposeButton } from "@/components/phc/EmailComposeButton";
import {
  listEvidence,
  buildEvidencePanel,
  type AiRecommendation,
  type FeedbackAction,
} from "@/lib/ai-actions";

// Renders a single AI recommendation with its full evidence panel. Every
// recommendation MUST show evidence — there is no "trust me" path.
export function AiEvidencePanel({
  rec,
  onAction,
  busy,
}: {
  rec: AiRecommendation;
  onAction: (action: FeedbackAction) => void;
  busy?: boolean;
}) {
  const { data: evidence = [], isLoading } = useQuery({
    queryKey: ["ai-evidence", rec.id],
    queryFn: () => listEvidence(rec.id),
  });
  const panel = buildEvidencePanel(rec, evidence);

  return (
    <div className="rounded-xl border border-border/70 bg-surface/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusPill tone={rec.severity === "high" ? "attention" : "muted"}>{rec.agent_key}</StatusPill>
            {panel.requiresApproval ? (
              <StatusPill tone="attention">
                <ShieldAlert className="me-1 inline h-3 w-3" /> approval required
              </StatusPill>
            ) : null}
          </div>
          <div className="mt-1.5 text-[15px] font-medium text-foreground">{panel.title}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{rec.recommendation}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Confidence</div>
          <div className="text-lg font-semibold text-foreground num" data-tabular="true">
            {panel.confidence != null ? `${Math.round(panel.confidence)}%` : "—"}
          </div>
        </div>
      </div>

      {/* Evidence */}
      <div className="mt-4 rounded-lg border border-border/60 bg-background/40 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <FileSearch className="h-3 w-3" /> Evidence
        </div>
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading evidence…</div>
        ) : evidence.length === 0 ? (
          <div className="text-xs text-destructive/80">No evidence recorded — recommendation withheld.</div>
        ) : (
          <ul className="space-y-1.5">
            {evidence.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-foreground">
                  <span className="text-muted-foreground">{e.label}:</span> {e.value}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{e.source_ref ?? e.source_type}</span>
              </li>
            ))}
          </ul>
        )}
        {panel.reasonCodes.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {panel.reasonCodes.map((c) => (
              <span key={c} className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">{c}</span>
            ))}
          </div>
        ) : null}
        {panel.missingData.length ? (
          <div className="mt-2 text-[11px] text-amber-light">Missing: {panel.missingData.join(", ")}</div>
        ) : null}
        <div className="mt-2 text-[10px] text-muted-foreground">
          {panel.generatedBy} · {new Date(panel.timestamp).toLocaleString()}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
        <EmptyEmailBtn rec={rec} />
        <button disabled={busy} onClick={() => onAction("dismiss")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
          <XCircle className="h-3.5 w-3.5" /> Dismiss
        </button>
        <button disabled={busy} onClick={() => onAction("request_review")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
          <Eye className="h-3.5 w-3.5" /> Request review
        </button>
        {panel.requiresApproval ? (
          <button disabled={busy} onClick={() => onAction("create_approval")} className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20 disabled:opacity-50">
            <ShieldAlert className="h-3.5 w-3.5" /> Create approval
          </button>
        ) : (
          <button disabled={busy} onClick={() => onAction("accept")} className="inline-flex items-center gap-1.5 rounded-md border border-won/40 bg-won/10 px-3 py-1.5 text-xs font-medium text-won hover:bg-won/[0.16] disabled:opacity-50">
            <CheckCircle2 className="h-3.5 w-3.5" /> Accept
          </button>
        )}
      </div>
    </div>
  );
}

// AI recommendation follow-up: opens the compose modal only. It never
// executes a sensitive action; sensitive AI accepts still route through
// "Create approval". This is why we render the button alongside — not
// instead of — the standard actions.
function EmptyEmailBtn({ rec }: { rec: AiRecommendation }) {
  return (
    <EmailComposeButton
      size="sm"
      variant="ghost"
      template="opportunity_follow_up"
      context={{
        recipientName: null,
        recipientEmail: null,
        aiRecommendation: rec.recommendation,
      }}
      linked={{
        type: "ai_recommendation",
        id: rec.id,
        label: rec.recommendation,
        opportunityId: (rec as unknown as { opportunity_id?: string | null }).opportunity_id ?? null,
      }}
    />
  );
}
