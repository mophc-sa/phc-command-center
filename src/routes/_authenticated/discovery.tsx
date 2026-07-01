import { createFileRoute } from "@tanstack/react-router";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OpportunityCard, type OpportunityRow } from "@/components/phc/OpportunityCard";

export const Route = createFileRoute("/_authenticated/discovery")({
  head: () => ({ meta: [{ title: "Discovery Inbox — PHC" }, { name: "robots", content: "noindex" }] }),
  component: () => {
    const { t, lang } = useI18n();
    const { data = [] } = useQuery({
      queryKey: ["discovery"],
      queryFn: async () => ((await supabase.from("opportunities").select("*").eq("stage", "discovery")).data ?? []) as unknown as OpportunityRow[],
    });
    return (
      <div className="mx-auto max-w-7xl">
        <SectionHeader title={t("nav_discovery")} count={data.length} />
        {data.length === 0 ? <EmptyState message={t("empty_discovery")} /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.map((o) => <OpportunityCard key={o.id} o={o} lang={lang} />)}
          </div>
        )}
      </div>
    );
  },
});
