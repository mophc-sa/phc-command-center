import { createFileRoute } from "@tanstack/react-router";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({ meta: [{ title: "Approvals — PHC" }, { name: "robots", content: "noindex" }] }),
  component: () => {
    const { t } = useI18n();
    const { data = [] } = useQuery({
      queryKey: ["approvals"],
      queryFn: async () => (await supabase.from("approvals").select("*, opportunities(project_name, client)").eq("status", "pending")).data ?? [],
    });
    return (
      <div className="mx-auto max-w-7xl">
        <SectionHeader title={t("nav_approvals")} count={data.length} />
        {data.length === 0 ? <EmptyState message={t("empty_approvals")} /> : (
          <div className="rounded-lg border border-border bg-surface">
            {data.map((a) => (
              <div key={a.id} className="border-t border-border/70 px-4 py-3 first:border-t-0 text-sm">
                <div className="font-medium text-foreground">{a.approval_type}</div>
                <div className="text-xs text-muted-foreground">{a.recommendation ?? "—"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
});
