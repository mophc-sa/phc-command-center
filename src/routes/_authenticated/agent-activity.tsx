import { createFileRoute } from "@tanstack/react-router";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/agent-activity")({
  head: () => ({ meta: [{ title: "Agent Activity — PHC" }, { name: "robots", content: "noindex" }] }),
  component: () => {
    const { t, lang } = useI18n();
    const { data = [] } = useQuery({
      queryKey: ["agent-runs-all"],
      queryFn: async () => (await supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(50)).data ?? [],
    });
    return (
      <div className="mx-auto max-w-7xl">
        <SectionHeader title={t("nav_agent_activity")} count={data.length} />
        {data.length === 0 ? <EmptyState message={t("empty_agent_runs")} /> : (
          <ol className="rounded-lg border border-border bg-surface">
            {data.map((r) => (
              <li key={r.id} className="border-t border-border/70 px-4 py-3 first:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-foreground">{r.loop_name ?? r.agent_name}</div>
                  <span className="text-xs text-muted-foreground num" data-tabular="true">
                    {new Date(r.started_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US")}
                  </span>
                </div>
                {r.summary ? <div className="mt-1 text-xs text-muted-foreground">{r.summary}</div> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  },
});
