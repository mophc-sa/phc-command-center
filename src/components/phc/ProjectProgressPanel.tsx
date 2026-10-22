// =============================================================================
// Projects in progress — the manager's home page view of where each live
// project stands (manager feedback group 4, 2026-10-19: "actual completion %
// and current stage per project, shown on the home page").
//
// Self-contained (its own query) so it can sit anywhere on the home page; the
// rest of that page is being reworked separately (group 3).
//
// Per row: project — contractor, canonical sales stage, the site's stage
// (excavation, structure, ...) with the construction %, and the latest entry from
// the project's update log. Ordered by the latest update,
// then by last activity, so what moved most recently is on top.
// =============================================================================
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { CompletionBar } from "@/components/phc/CompletionBar";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { useI18n, localeFor } from "@/lib/i18n";
import { canonicalStageLabelKey } from "@/lib/stage-canonical";
import { siteStageLabel, updateKindLabel, projectProgressItems, type ProjectProgressRow } from "@/lib/project-tracking";

export function ProjectProgressPanel() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["home-project-progress"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select(
          "id, project_name, main_contractor, stage, sales_stage, completion_pct, project_stage, last_activity_at, contractor_company:companies!opportunities_main_contractor_id_fkey(name), opportunity_updates(kind, created_at)",
        )
        .neq("stage", "archived")
        .order("last_activity_at", { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return projectProgressItems((data ?? []) as unknown as ProjectProgressRow[]);
    },
  });

  return (
    <Panel
      title={ar ? "المشاريع الجارية" : "Projects in progress"}
      subtitle={ar ? "مرحلة البيع، ومرحلة الموقع ونسبة إنجازه، وآخر تحديث" : "Sales stage, site stage and construction progress, latest update"}
      action={
        <Link
          to="/opportunities"
          search={{ q: "", stage: "all", tier: "all", view: "table" }}
          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {ar ? "الكل" : "View all"} <ArrowRight className="h-3 w-3 rtl:-scale-x-100" />
        </Link>
      }
    >
      {isLoading ? (
        <SkeletonTable rows={4} />
      ) : items.length === 0 ? (
        <EmptyState message={ar ? "لا توجد مشاريع جارية." : "No projects in progress."} />
      ) : (
        <ul className="divide-y divide-border/60">
          {items.map((it) => (
            <li key={it.id} className="grid gap-2 py-2.5 sm:grid-cols-[minmax(0,2fr)_auto_minmax(7rem,1fr)_minmax(0,1.4fr)] sm:items-center sm:gap-4">
              <div className="min-w-0">
                <Link to="/opportunities/$id" params={{ id: it.id }} className="block truncate text-sm font-medium text-foreground hover:underline">
                  {it.name}
                </Link>
                {it.contractor ? <span className="block truncate text-xs text-muted-foreground">{it.contractor}</span> : null}
              </div>
              <div>
                <StatusPill tone="neutral">{t(canonicalStageLabelKey(it.stage))}</StatusPill>
              </div>
              <div className="grid min-w-0 gap-1">
                <span className="truncate text-xs text-foreground">
                  {it.siteStage ? siteStageLabel(it.siteStage, lang) : <span className="text-muted-foreground">{ar ? "المرحلة غير محددة" : "Stage not given"}</span>}
                </span>
                <CompletionBar pct={it.pct} compact />
              </div>
              <div className="min-w-0 text-xs text-muted-foreground">
                {it.latest ? (
                  <span className="block truncate">
                    <span className="text-foreground">{updateKindLabel(it.latest.kind, lang)}</span>
                    {" · "}
                    <span className="num" data-tabular="true">
                      {new Date(it.latest.created_at).toLocaleDateString(localeFor(lang), { day: "numeric", month: "short" })}
                    </span>
                  </span>
                ) : (
                  <span>{ar ? "لا تحديثات بعد" : "No updates yet"}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
