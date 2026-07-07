import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ShieldAlert, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { resolveFlag, runAutomations } from "@/lib/workflow-actions";

export const Route = createFileRoute("/_authenticated/action-center")({
  head: () => ({ meta: [{ title: "Action Required — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ActionCenter,
});

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function priorityRank(p: string | null | undefined): number {
  if (p === "critical" || p === "high") return 0;
  if (p === "medium") return 1;
  return 2;
}

function ActionCenter() {
  const { t, lang } = useI18n();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const [kindFilter, setKindFilter] = useState<"all" | "action_required" | "risk">("all");
  const isManager = hasAnyRole(["bd_manager", "sales_manager", "ceo"]);

  const { data: flags = [], isLoading } = useQuery({
    queryKey: ["flags-open"],
    queryFn: async () =>
      (await supabase.from("opportunity_flags").select("*, opportunities(id, project_name, owner_id, main_contractor, next_action)").eq("status", "open").order("created_at", { ascending: false })).data ?? [],
  });

  const filtered = useMemo(() => {
    const arr = kindFilter === "all" ? flags : flags.filter((f: any) => f.flag_kind === kindFilter);
    return [...arr].sort((a: any, b: any) => priorityRank(a.priority) - priorityRank(b.priority));
  }, [flags, kindFilter]);

  const critical = flags.filter((f: any) => f.priority === "critical" || f.priority === "high").length;
  const risks = flags.filter((f: any) => f.flag_kind === "risk").length;
  const overdue = flags.filter((f: any) => f.due_date && f.due_date < new Date().toISOString().slice(0, 10)).length;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={lang === "ar" ? "أولوية العمل" : "Priority work"}
        title={t("nav_action_center")}
        description={lang === "ar" ? "بنود تتطلب قراراً أو إجراءً من الفريق." : "Items requiring a decision or action from the team."}
        actions={
          isManager ? (
            <button
              onClick={async () => {
                try {
                  const r: any = await runAutomations();
                  toast.success(`${t("wf_run_automations")}: ${r.raised}`);
                  qc.invalidateQueries({ queryKey: ["flags-open"] });
                } catch (e) {
                  toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                }
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/70 bg-surface/60 px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <PlayCircle className="h-3.5 w-3.5" /> {t("wf_run_automations")}
            </button>
          ) : null
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <KpiCard label={lang === "ar" ? "أولوية عالية" : "High priority"} value={formatNumber(critical, lang)} hint={lang === "ar" ? "تحتاج قراراً الآن" : "Needs a decision now"} trend={critical > 0 ? "down" : "flat"} />
        <KpiCard label={lang === "ar" ? "مخاطر مفتوحة" : "Open risks"} value={formatNumber(risks, lang)} hint={lang === "ar" ? "بنود ذات مخاطر" : "Risk-flagged items"} />
        <KpiCard label={lang === "ar" ? "متأخرة" : "Overdue"} value={formatNumber(overdue, lang)} hint={lang === "ar" ? "تجاوزت التاريخ" : "Past due date"} />
      </section>

      <div className="mb-4 flex gap-1.5">
        {(["all", "action_required", "risk"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
              kindFilter === k
                ? "border-amber/40 bg-amber/10 text-amber-light"
                : "border-border/70 bg-surface/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {k === "all" ? t("crm_filter_all_types") : humanize(k)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-surface/60 py-10">
          <EmptyState message={t("wf_no_records")} />
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          {filtered.map((f: any) => {
            const high = f.priority === "critical" || f.priority === "high";
            const opp = f.opportunities;
            return (
              <li key={f.id} className="border-t border-border/60 first:border-t-0">
                <div className="grid grid-cols-[3px_minmax(0,1fr)_auto] items-stretch">
                  <div className={high ? "bg-amber/70" : f.flag_kind === "risk" ? "bg-red-500/50" : "bg-transparent"} />
                  <div className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={f.flag_kind === "risk" ? "danger" : "attention"}>
                        {f.flag_kind === "risk" ? <ShieldAlert className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {humanize(f.action_type ?? f.risk_flag ?? f.flag_kind)}
                      </StatusPill>
                      {f.priority ? (
                        <StatusPill tone={high ? "attention" : "muted"}>{humanize(f.priority)}</StatusPill>
                      ) : null}
                      <span className="text-[11px] text-muted-foreground">{humanize(f.linked_record_type)}</span>
                      {f.due_date ? (
                        <span className="num text-[11px] text-muted-foreground" data-tabular="true">· {f.due_date}</span>
                      ) : null}
                    </div>
                    {opp?.project_name ? (
                      <Link to="/opportunities/$id" params={{ id: opp.id }} className="mt-1.5 block truncate text-[13px] font-medium text-foreground hover:underline">
                        {opp.project_name}
                      </Link>
                    ) : null}
                    {f.reason ? <div className="mt-1 text-[12px] text-muted-foreground">{f.reason}</div> : null}
                    {opp?.next_action ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        <span className="text-amber-light">{lang === "ar" ? "التالي:" : "Next:"}</span> {opp.next_action}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center pe-4">
                    <button
                      onClick={async () => {
                        try {
                          await resolveFlag(f.id);
                          qc.invalidateQueries({ queryKey: ["flags-open"] });
                        } catch (e) {
                          toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                        }
                      }}
                      className="shrink-0 rounded-md border border-border/70 bg-background/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                    >
                      {t("ac_resolve")}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
