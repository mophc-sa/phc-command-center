import { createFileRoute } from "@tanstack/react-router";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/follow-ups")({
  head: () => ({ meta: [{ title: "Follow-ups — PHC" }, { name: "robots", content: "noindex" }] }),
  component: () => {
    const { t } = useI18n();
    const { data = [] } = useQuery({
      queryKey: ["all-followups"],
      queryFn: async () => (await supabase.from("follow_ups").select("*").order("due_date")).data ?? [],
    });
    return (
      <div className="mx-auto max-w-7xl">
        <SectionHeader title={t("nav_follow_ups")} count={data.length} />
        {data.length === 0 ? <EmptyState message={t("empty_follow_ups")} /> : (
          <div className="rounded-lg border border-border bg-surface">
            {data.map((f) => (
              <div key={f.id} className="flex items-center justify-between border-t border-border/70 px-4 py-3 first:border-t-0 text-sm">
                <div className="text-foreground">{f.channel ?? "—"} · {f.notes ?? ""}</div>
                <div className="text-xs text-muted-foreground num" data-tabular="true">{f.due_date}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
});
