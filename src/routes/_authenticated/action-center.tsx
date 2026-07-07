import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n } from "@/lib/i18n";
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

function ActionCenter() {
  const { t } = useI18n();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const [kindFilter, setKindFilter] = useState<"all" | "action_required" | "risk">("all");
  const isManager = hasAnyRole(["bd_manager", "sales_manager", "ceo"]);

  const { data: flags = [], isLoading } = useQuery({
    queryKey: ["flags-open"],
    queryFn: async () => (await supabase.from("opportunity_flags").select("*").eq("status", "open").order("created_at", { ascending: false })).data ?? [],
  });

  const filtered = kindFilter === "all" ? flags : flags.filter((f: any) => f.flag_kind === kindFilter);

  return (
    <div className="mx-auto max-w-5xl">
      <SectionHeader
        title={t("nav_action_center")}
        count={filtered.length}
        action={
          isManager ? (
            <button
              onClick={async () => {
                try { const r: any = await runAutomations(); toast.success(`${t("wf_run_automations")}: ${r.raised}`); qc.invalidateQueries({ queryKey: ["flags-open"] }); }
                catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("wf_run_automations")}
            </button>
          ) : null
        }
      />

      <div className="mb-4 flex gap-1.5">
        {(["all", "action_required", "risk"] as const).map((k) => (
          <button key={k} onClick={() => setKindFilter(k)} className={`rounded-full border px-3 py-1 text-xs ${kindFilter === k ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {k === "all" ? t("crm_filter_all_types") : humanize(k)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("wf_no_records")} />
      ) : (
        <div className="space-y-2">
          {filtered.map((f: any) => (
            <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={f.flag_kind === "risk" ? "danger" : "attention"}>
                    {humanize(f.action_type ?? f.risk_flag ?? f.flag_kind)}
                  </StatusPill>
                  {f.priority ? <StatusPill tone="muted">{f.priority}</StatusPill> : null}
                  <span className="text-xs text-muted-foreground">{humanize(f.linked_record_type)}</span>
                  {f.due_date ? <span className="text-xs text-muted-foreground">{f.due_date}</span> : null}
                </div>
                {f.reason ? <div className="mt-1 truncate text-sm text-foreground">{f.reason}</div> : null}
              </div>
              <button
                onClick={async () => {
                  try { await resolveFlag(f.id); qc.invalidateQueries({ queryKey: ["flags-open"] }); }
                  catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                }}
                className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("ac_resolve")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
