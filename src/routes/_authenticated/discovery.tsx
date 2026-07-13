import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Inbox, ShieldCheck, GitMerge, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
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
import { canManageSalesPipeline } from "@/lib/roles";
import { ArchivedBadge } from "@/components/phc/RecordLifecycleMenu";

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

type Bucket = "all" | "new" | "review" | "qualified" | "converted" | "rejected";

function bucketOf(stage: LeadStage): Bucket {
  if (stage === "converted") return "converted";
  if (stage === "rejected") return "rejected";
  if (stage === "human_review") return "review";
  if (stage === "scored") return "qualified";
  return "new";
}

function LeadIntakePage() {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>("all");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const canQualify = canManageSalesPipeline(roles);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads
      .filter((l: any) => showArchived || !l.archived_at)
      .filter((l: any) => bucket === "all" || bucketOf(l.lead_stage) === bucket)
      .filter((l: any) =>
        !q ||
        (l.project_name && l.project_name.toLowerCase().includes(q)) ||
        (l.main_contractor_guess && l.main_contractor_guess.toLowerCase().includes(q)) ||
        (l.location && l.location.toLowerCase().includes(q)),
      );
  }, [leads, bucket, query, showArchived]);

  const counts = useMemo(() => {
    const c = { all: leads.length, new: 0, review: 0, qualified: 0, converted: 0, rejected: 0 } as Record<Bucket, number>;
    for (const l of leads as any[]) c[bucketOf(l.lead_stage)]++;
    return c;
  }, [leads]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Intelligence"
        title={t("lead_intake_title")}
        description={t("lead_intake_hint")}
        actions={
          <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20">
            <Plus className="h-3.5 w-3.5" />
            {t("lead_new")}
          </button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total leads" value={counts.all} icon={<Inbox className="h-3.5 w-3.5" />} hint={`${counts.new} new`} />
        <KpiCard label="In review" value={counts.review} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
        <KpiCard label="Qualified" value={counts.qualified} icon={<GitMerge className="h-3.5 w-3.5" />} />
        <KpiCard label="Converted / Rejected" value={`${counts.converted} / ${counts.rejected}`} icon={<XCircle className="h-3.5 w-3.5" />} />
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads"
            className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            { k: "all", label: `All (${counts.all})` },
            { k: "new", label: `New (${counts.new})` },
            { k: "review", label: `Review (${counts.review})` },
            { k: "qualified", label: `Qualified (${counts.qualified})` },
            { k: "converted", label: `Converted (${counts.converted})` },
            { k: "rejected", label: `Rejected (${counts.rejected})` },
          ] as const).map((b) => (
            <button
              key={b.k}
              onClick={() => setBucket(b.k)}
              className={`rounded-full border px-3 py-1 text-xs ${bucket === b.k ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {b.label}
            </button>
          ))}
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`rounded-full border px-3 py-1 text-xs ${showArchived ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {t("lifecycle_include_archived")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("lead_no_leads")} />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((l: any) => {
            const ns = nextStage(l.lead_stage);
            const terminal = l.lead_stage === "converted" || l.lead_stage === "rejected";
            const canConvert = l.lead_stage === "human_review" || l.lead_stage === "scored";
            return (
              <div key={l.id} className="rounded-xl border border-border/70 bg-surface/60 px-5 py-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{l.project_name}</span>
                      <StatusPill tone={stageTone(l.lead_stage)}>{humanize(l.lead_stage)}</StatusPill>
                      <ArchivedBadge archived={!!l.archived_at} />
                      {l.lead_score != null ? (
                        <StatusPill tone="muted">{t("lead_score")}: {l.lead_score}</StatusPill>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{t("lead_source")}: {l.source}</span>
                      {l.main_contractor_guess ? <span>· {l.main_contractor_guess}</span> : null}
                      {l.location ? <span>· {l.location}</span> : null}
                      {l.estimated_value != null ? (
                        <span className="num text-foreground" data-tabular="true">· {formatCurrency(l.estimated_value, lang, "SAR")}</span>
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
                          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
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
