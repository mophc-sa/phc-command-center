import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import {
  createLead,
  advanceLeadStage,
  rejectLead,
  convertLeadToOpportunity,
  LEAD_STAGES,
  type LeadStage,
} from "@/lib/lead-actions";

export const Route = createFileRoute("/_authenticated/discovery")({
  head: () => ({ meta: [{ title: "Lead Intake — PHC" }, { name: "robots", content: "noindex" }] }),
  component: LeadIntakePage,
});

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function nextStage(s: LeadStage): LeadStage | null {
  const i = LEAD_STAGES.indexOf(s);
  // Stop before the terminal states (converted / rejected).
  if (i < 0 || i >= LEAD_STAGES.indexOf("human_review")) return null;
  return LEAD_STAGES[i + 1];
}

function stageTone(s: LeadStage): "positive" | "attention" | "danger" | "muted" | "neutral" {
  if (s === "converted") return "positive";
  if (s === "rejected") return "danger";
  if (s === "human_review") return "attention";
  if (s === "detected") return "muted";
  return "neutral";
}

function LeadIntakePage() {
  const { t, lang } = useI18n();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const canQualify = hasAnyRole(["bd_manager", "sales_manager", "ceo"]);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads"],
    queryFn: async () =>
      (
        await supabase.from("leads").select("*").order("created_at", { ascending: false })
      ).data ?? [],
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title={t("lead_intake_title")}
        count={leads.length}
        hint={t("lead_intake_hint")}
        action={
          <button onClick={() => setCreateOpen(true)} className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20">
            {t("lead_new")}
          </button>
        }
      />

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : leads.length === 0 ? (
        <EmptyState message={t("lead_no_leads")} />
      ) : (
        <div className="space-y-3">
          {leads.map((l: any) => {
            const ns = nextStage(l.lead_stage);
            const terminal = l.lead_stage === "converted" || l.lead_stage === "rejected";
            const canConvert = l.lead_stage === "human_review" || l.lead_stage === "scored";
            return (
              <div key={l.id} className="rounded-lg border border-border bg-surface px-4 py-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{l.project_name}</span>
                      <StatusPill tone={stageTone(l.lead_stage)}>{humanize(l.lead_stage)}</StatusPill>
                      {l.lead_score != null ? (
                        <span className="text-xs text-muted-foreground">{t("lead_score")}: {l.lead_score}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{t("lead_source")}: {l.source}</span>
                      {l.main_contractor_guess ? <span>{l.main_contractor_guess}</span> : null}
                      {l.location ? <span>{l.location}</span> : null}
                      {l.estimated_value != null ? (
                        <span className="num" data-tabular="true">{t("lead_est_value")}: {formatCurrency(l.estimated_value, lang, "SAR")}</span>
                      ) : null}
                    </div>
                  </div>
                  {!terminal && canQualify ? (
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {ns ? (
                        <button
                          onClick={async () => {
                            try { await advanceLeadStage(l.id, ns); toast.success(humanize(ns)); refresh(); }
                            catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                          }}
                          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          {t("lead_advance")} → {humanize(ns)}
                        </button>
                      ) : null}
                      {canConvert ? (
                        <button
                          onClick={async () => {
                            try { await convertLeadToOpportunity(l); toast.success(t("lead_convert")); refresh(); qc.invalidateQueries({ queryKey: ["opportunities"] }); }
                            catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                          }}
                          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20"
                        >
                          {t("lead_convert")}
                        </button>
                      ) : null}
                      <button
                        onClick={() => setRejectFor(l.id)}
                        className="rounded-md border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10"
                      >
                        {t("lead_reject")}
                      </button>
                    </div>
                  ) : terminal ? (
                    <StatusPill tone={l.lead_stage === "converted" ? "positive" : "danger"}>
                      {humanize(l.lead_stage)}
                    </StatusPill>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("lead_new")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "projectName", type: "text", label: t("nav_projects"), required: true },
          { key: "source", type: "select", label: t("lead_source"), defaultValue: "manual", options: [
            { value: "manual", label: "Manual" },
            { value: "protenders", label: "ProTenders" },
            { value: "external", label: "External" },
          ] },
          { key: "sourceUrl", type: "text", label: "URL" },
          { key: "mainContractorGuess", type: "text", label: t("crm_main_contractor") },
          { key: "location", type: "text", label: t("crm_location") },
          { key: "estimatedValue", type: "text", label: t("lead_est_value") },
        ]}
        onSubmit={async (v) => {
          try {
            await createLead({
              projectName: v.projectName,
              source: v.source || "manual",
              sourceUrl: v.sourceUrl || undefined,
              mainContractorGuess: v.mainContractorGuess || undefined,
              location: v.location || undefined,
              estimatedValue: v.estimatedValue ? Number(v.estimatedValue) : null,
            });
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={!!rejectFor}
        onOpenChange={(o) => !o && setRejectFor(null)}
        title={t("lead_reject")}
        submitLabel={t("lead_reject")}
        destructive
        fields={[{ key: "reason", type: "textarea", label: t("lead_reject_reason"), required: true }]}
        onSubmit={async (v) => {
          try {
            await rejectLead(rejectFor!, v.reason);
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
