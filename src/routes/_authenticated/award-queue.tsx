import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { useI18n, formatCurrency } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/award-queue")({
  head: () => ({ meta: [{ title: "Award & Contract Queue — PHC" }, { name: "robots", content: "noindex" }] }),
  component: AwardQueue,
});

const HIGH_VALUE_THRESHOLD = 300000;

function OppList({ items, lang, empty }: { items: any[]; lang: "en" | "ar"; empty: string }) {
  if (items.length === 0) return <div className="text-xs text-muted-foreground">{empty}</div>;
  return (
    <ul className="space-y-2">
      {items.map((o) => (
        <li key={o.id} className="flex items-center justify-between gap-2">
          <Link to="/opportunities/$id" params={{ id: o.id }} className="truncate text-sm text-foreground hover:underline">
            {o.project_name}
          </Link>
          <span className="num shrink-0 text-xs text-muted-foreground" data-tabular="true">
            {formatCurrency(o.contract_value ?? o.estimated_value_max, lang, o.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AwardQueue() {
  const { t, lang } = useI18n();
  const { data: opps = [], isLoading } = useQuery({
    queryKey: ["award-queue"],
    queryFn: async () =>
      (
        await supabase
          .from("opportunities")
          .select("id, project_name, sales_stage, estimated_value_max, contract_value, currency, expected_contract_date, handover_status")
          .in("sales_stage", ["verbally_awarded", "contract_received", "won"])
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });

  if (isLoading) return <EmptyState message={t("loading")} />;
  const today = new Date().toISOString().slice(0, 10);

  const verbalNoContract = opps.filter((o: any) => o.sales_stage === "verbally_awarded");
  const expiredExpected = verbalNoContract.filter((o: any) => o.expected_contract_date && o.expected_contract_date < today);
  const contractsAwaitingHandover = opps.filter((o: any) => o.sales_stage === "won" && o.handover_status !== "handed_over");
  const highValue = opps.filter((o: any) => (o.contract_value ?? o.estimated_value_max ?? 0) >= HIGH_VALUE_THRESHOLD);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <SectionHeader title={t("nav_award_queue")} />
      <div className="grid gap-5 md:grid-cols-2">
        <Panel title={t("aq_verbal_no_contract")} subtitle={String(verbalNoContract.length)} tone={verbalNoContract.length ? "attention" : "default"}>
          <OppList items={verbalNoContract} lang={lang} empty={t("wf_no_records")} />
        </Panel>
        <Panel title={t("aq_expected_passed")} subtitle={String(expiredExpected.length)} tone={expiredExpected.length ? "attention" : "default"}>
          <OppList items={expiredExpected} lang={lang} empty={t("wf_no_records")} />
        </Panel>
        <Panel title={t("aq_contracts_received")} subtitle={String(contractsAwaitingHandover.length)}>
          <OppList items={contractsAwaitingHandover} lang={lang} empty={t("wf_no_records")} />
        </Panel>
        <Panel title={t("aq_high_value")} subtitle={String(highValue.length)}>
          <OppList items={highValue} lang={lang} empty={t("wf_no_records")} />
        </Panel>
      </div>
    </div>
  );
}
