// Generic "run + review" risk-assessment panel for any single-record risk
// agent that shares risk_finance's output shape (risk_score/risk_level/
// risk_factors/mitigations) — introduced for commercial_risk_assessment (2026-08-04)
// but written entity-agnostic so any future agent using the same output
// schema (see CommercialRiskOutputSchema = RiskFinanceOutputSchema in
// _shared/ai-schemas.ts) can reuse it instead of a fourth near-identical
// inline block. opportunities.$id.tsx's risk_finance panel predates this
// and is left as-is (working code, not worth the churn to migrate).
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { runAiAgent } from "@/lib/ai-orchestrator-actions";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canReviewAiOutput } from "@/lib/roles";
import { getLatestAgentOutput, reviewAgentOutput, type AiAgentOutputRow } from "@/lib/ai-review-actions";

const IMPACT_TONE: Record<string, string> = {
  low: "bg-won/15 text-won",
  medium: "bg-amber-500/15 text-amber-400",
  high: "bg-destructive/15 text-destructive",
};
const RISK_LEVEL_TONE: Record<string, string> = {
  low: "bg-won/15 text-won",
  medium: "bg-amber-500/15 text-amber-400",
  high: "bg-orange-500/15 text-orange-400",
  critical: "bg-destructive/15 text-destructive",
};

export function AiRiskAssessment({
  entityType,
  entityId,
  agentKey,
  title,
}: {
  entityType: "rfqs" | "tenders" | "quotations" | "companies";
  entityId: string;
  agentKey: "commercial_risk_assessment";
  title: string;
}) {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const canReview = canReviewAiOutput(roles);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const outputQ = useQuery({
    queryKey: ["ai-output", entityType, entityId, agentKey],
    queryFn: () => getLatestAgentOutput(entityType, entityId, agentKey),
  });

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const result = await runAiAgent({ agent: agentKey, entityType, entityId });
      if (!result.ok) throw new Error(result.message);
      qc.invalidateQueries({ queryKey: ["ai-output", entityType, entityId, agentKey] });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleDecide(output: AiAgentOutputRow, decision: "accepted" | "rejected") {
    setReviewingId(output.id);
    try {
      await reviewAgentOutput({ outputId: output.id, decision });
      toast.success(decision === "accepted" ? t("toast_ai_output_accepted") : t("toast_ai_output_rejected"));
      qc.invalidateQueries({ queryKey: ["ai-output", entityType, entityId, agentKey] });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setReviewingId(null);
    }
  }

  const output = outputQ.data;
  const display = output?.structured_output as any;

  return (
    <Panel
      title={title}
      action={
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-2.5 py-1 text-xs font-medium text-amber-light transition-colors hover:bg-amber/20 disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" />
          {running ? (lang === "ar" ? "جارٍ التقييم…" : "Assessing…") : (lang === "ar" ? "تقييم المخاطر" : "Run Risk Assessment")}
        </button>
      }
    >
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {!error && !display && (
        <div className="text-xs text-muted-foreground">
          {lang === "ar" ? "لا يوجد تقييم بعد." : "No assessment yet."}
        </div>
      )}
      {display && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {display.risk_level && (
              <span className={`rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide ${RISK_LEVEL_TONE[display.risk_level] ?? "bg-muted text-muted-foreground"}`}>
                {display.risk_level}
              </span>
            )}
            {display.risk_score != null && (
              <span className="text-sm font-medium text-foreground">
                {lang === "ar" ? "درجة المخاطرة" : "Risk Score"}: {display.risk_score}/100
              </span>
            )}
          </div>

          {display.risk_factors?.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                {lang === "ar" ? "عوامل المخاطرة" : "Risk Factors"}
              </div>
              <ul className="space-y-1.5">
                {display.risk_factors.map((factor: any, i: number) => (
                  <li key={i} className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
                    {factor.impact && (
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide ${IMPACT_TONE[factor.impact] ?? ""}`}>
                        {factor.impact}
                      </span>
                    )}
                    <span className="text-muted-foreground">{factor.description ?? factor.factor}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {display.mitigations?.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                {lang === "ar" ? "إجراءات التخفيف" : "Mitigations"}
              </div>
              <ul className="space-y-1.5">
                {display.mitigations.map((m: any, i: number) => (
                  <li key={i} className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
                    {m.priority && (
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide ${IMPACT_TONE[m.priority] ?? ""}`}>
                        {m.priority}
                      </span>
                    )}
                    <span className="text-muted-foreground">{m.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {display.disclaimer && (
            <div className="text-xs italic text-muted-foreground">{display.disclaimer}</div>
          )}

          {output && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-xs">
              <span className="text-muted-foreground">
                {output.status === "pending_review"
                  ? (lang === "ar" ? "بانتظار المراجعة" : "Pending review")
                  : output.status === "accepted"
                  ? (lang === "ar" ? "تم القبول" : "Accepted")
                  : (lang === "ar" ? "تم الرفض" : "Rejected")}
              </span>
              {output.status === "pending_review" && canReview ? (
                <>
                  <button
                    type="button"
                    disabled={reviewingId === output.id}
                    onClick={() => handleDecide(output, "accepted")}
                    className="rounded-md border border-won/40 bg-won/10 px-2.5 py-1 text-xs font-medium text-won transition-colors hover:bg-won/[0.16] disabled:opacity-50"
                  >
                    {lang === "ar" ? "قبول" : "Accept"}
                  </button>
                  <button
                    type="button"
                    disabled={reviewingId === output.id}
                    onClick={() => handleDecide(output, "rejected")}
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive/90 transition-colors hover:bg-destructive/[0.16] disabled:opacity-50"
                  >
                    {lang === "ar" ? "رفض" : "Reject"}
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
