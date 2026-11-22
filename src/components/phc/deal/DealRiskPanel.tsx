// Review 81/82 item 8 (Omar, 2026-11-22): the deal's risks one by one — each
// with its reason, solution and next action — and Accept / Reject beside it.
// Rejecting a risk records it and re-runs the assessment told to leave it out.
// The run and refresh buttons live in this section; every user may use it.
// Decisions are kept on the deal (extra_data.risk_decisions, keyed by factor).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/phc/Panel";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { runAiAgent } from "@/lib/ai-orchestrator-actions";
import { getLatestAgentOutput } from "@/lib/ai-review-actions";
import type { Lang } from "@/lib/i18n";

type Factor = { factor: string; impact: "low" | "medium" | "high"; description: string; solution?: string; action?: string };
type Decision = "accepted" | "rejected";

const IMPACT: Record<Factor["impact"], { cls: string; en: string; ar: string }> = {
  low: { cls: "bg-won/[0.12] text-won-on-tint", en: "Low", ar: "منخفض" },
  medium: { cls: "bg-amber/[0.14] text-amber-on-tint", en: "Medium", ar: "متوسط" },
  high: { cls: "bg-destructive/[0.10] text-destructive-on-tint", en: "High", ar: "مرتفع" },
};

export function DealRiskPanel({ opportunityId, extraData, lang, onChanged }: {
  opportunityId: string; extraData: Record<string, unknown> | null; lang: Lang; onChanged: () => void;
}) {
  const ar = lang === "ar";
  const qc = useQueryClient();
  const key = ["ai-output", opportunityId, "risk_finance"];
  const q = useQuery({ queryKey: key, queryFn: () => getLatestAgentOutput("opportunities", opportunityId, "risk_finance") });
  const [busy, setBusy] = useState(false);
  const decisions = ((extraData ?? {}).risk_decisions ?? {}) as Record<string, Decision>;
  const out = (q.data?.structured_output ?? null) as { risk_score?: number; risk_level?: string; risk_factors?: Factor[] } | null;
  const factors = out?.risk_factors ?? [];

  async function run(rejected: string[]) {
    setBusy(true);
    try {
      const r = await runAiAgent({ agent: "risk_finance", entityType: "opportunities", entityId: opportunityId, input: { rejected_factors: rejected } });
      if (!r.ok) throw new Error(r.message);
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(f: Factor, d: Decision) {
    const next = { ...decisions, [f.factor]: d };
    const { error } = await supabase.from("opportunities")
      .update({ extra_data: { ...(extraData ?? {}), risk_decisions: next } } as never).eq("id", opportunityId);
    if (error) { toast.error(error.message); return; }
    onChanged();
    // A rejected risk sends the assessment back, without everything rejected so far.
    if (d === "rejected") await run(Object.keys(next).filter((k) => next[k] === "rejected"));
  }

  return (
    <Panel
      title={ar ? "تقييم المخاطر" : "Risk assessment"}
      action={
        <Button size="sm" variant={factors.length ? "outline" : "default"} disabled={busy}
          onClick={() => void run(Object.keys(decisions).filter((k) => decisions[k] === "rejected"))}>
          <RefreshCw className={`me-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
          {busy ? (ar ? "جارٍ التقييم…" : "Assessing…") : factors.length ? (ar ? "تحديث" : "Refresh") : (ar ? "تقييم المخاطر" : "Risk assessment")}
        </Button>
      }
    >
      {!factors.length ? (
        <p className="text-sm text-muted-foreground">{ar ? "لم يُقيَّم بعد. اضغط «تقييم المخاطر»." : "Not assessed yet. Press Risk assessment."}</p>
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center gap-2 text-sm">
            <ShieldAlert className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="font-semibold">{ar ? "المستوى" : "Level"}: {out?.risk_level ?? "—"}</span>
            {out?.risk_score != null ? <span className="text-muted-foreground">· {out.risk_score}/100</span> : null}
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {factors.map((f) => {
              const d = decisions[f.factor];
              return (
                <li key={f.factor} className={`grid gap-2 p-3 sm:grid-cols-[1fr_auto] ${d === "rejected" ? "opacity-50" : ""}`}>
                  <div className="grid gap-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${IMPACT[f.impact]?.cls ?? ""}`}>{ar ? IMPACT[f.impact]?.ar : IMPACT[f.impact]?.en}</span>
                      <span className="font-semibold text-foreground" dir="auto">{f.factor}</span>
                    </div>
                    <p dir="auto"><span className="text-muted-foreground">{ar ? "السبب" : "Reason"}:</span> {f.description}</p>
                    {f.solution ? <p dir="auto"><span className="text-muted-foreground">{ar ? "الحل" : "Solution"}:</span> {f.solution}</p> : null}
                    {f.action ? <p dir="auto"><span className="text-muted-foreground">{ar ? "الإجراء" : "Action"}:</span> {f.action}</p> : null}
                  </div>
                  <div className="flex items-start gap-1.5">
                    {d ? (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{d === "accepted" ? (ar ? "مقبول" : "Accepted") : (ar ? "مرفوض" : "Rejected")}</span>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(f, "accepted")}>
                          <Check className="me-1 h-3.5 w-3.5" aria-hidden="true" />{ar ? "قبول" : "Accept"}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(f, "rejected")}>
                          <X className="me-1 h-3.5 w-3.5" aria-hidden="true" />{ar ? "رفض" : "Reject"}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">{ar ? "تقييم بالذكاء الاصطناعي للمساعدة في القرار فقط." : "AI assessment, decision support only."}</p>
        </div>
      )}
    </Panel>
  );
}
