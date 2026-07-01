import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { OpportunityCard, type OpportunityRow } from "@/components/phc/OpportunityCard";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";

export const Route = createFileRoute("/_authenticated/opportunities/")({
  head: () => ({
    meta: [
      { title: "Opportunities — PHC" },
      { name: "description", content: "All active opportunities across the pipeline." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OppList,
});

function OppList() {
  const { t, lang } = useI18n();
  const { data = [], isLoading } = useQuery({
    queryKey: ["opps"],
    queryFn: async () => {
      const { data } = await supabase.from("opportunities").select("*").order("last_activity_at", { ascending: false, nullsFirst: false });
      return (data ?? []) as unknown as OpportunityRow[];
    },
  });
  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader title={t("nav_opportunities")} count={data.length} />
      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : data.length === 0 ? (
        <EmptyState message={t("empty_opportunities")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((o) => <OpportunityCard key={o.id} o={o} lang={lang} />)}
        </div>
      )}
    </div>
  );
}
