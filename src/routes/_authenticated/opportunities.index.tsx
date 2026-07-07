import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { OpportunityCard, type OpportunityRow } from "@/components/phc/OpportunityCard";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const STAGES = [
  "discovery",
  "qualification",
  "preparation",
  "quotation",
  "follow_up",
  "won",
  "lost",
  "archived",
] as const;

function OppList() {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<string>("all");
  const [tier, setTier] = useState<string>("all");

  const { data = [], isLoading } = useQuery({
    queryKey: ["opps"],
    queryFn: async () => {
      const { data } = await supabase.from("opportunities").select("*").order("last_activity_at", { ascending: false, nullsFirst: false });
      return (data ?? []) as unknown as OpportunityRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((o: any) => {
      if (stage !== "all" && o.stage !== stage) return false;
      if (tier !== "all" && o.tier !== tier) return false;
      if (!q) return true;
      return [o.project_name, o.client, o.main_contractor, o.location, o.sector]
        .filter(Boolean)
        .some((f: string) => f.toLowerCase().includes(q));
    });
  }, [data, search, stage, tier]);

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader title={t("nav_opportunities")} count={filtered.length} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filter_search")}
            className="w-full rounded-md border border-border bg-surface py-2 pe-3 ps-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber/50"
          />
        </div>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter_all_stages")}</SelectItem>
            {STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger className="w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter_all_tiers")}</SelectItem>
            {(["A", "B", "C"] as const).map((x) => (
              <SelectItem key={x} value={x}>
                {t("label_tier")} {x}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : data.length === 0 ? (
        <EmptyState message={t("empty_opportunities")} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("filter_no_results")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((o) => <OpportunityCard key={o.id} o={o} lang={lang} />)}
        </div>
      )}
    </div>
  );
}
