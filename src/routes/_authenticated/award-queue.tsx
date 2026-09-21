import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, FileSignature, AlertTriangle, Timer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiRow } from "@/components/phc/KpiRow";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { AWARD_QUEUE_STAGES } from "@/lib/dashboard-helpers";
import { sumOpportunityValue, opportunityValue } from "@/lib/sales-kpis";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/award-queue")({
  head: () => ({ meta: [{ title: "Award & Contract Queue — PHC" }, { name: "robots", content: "noindex" }] }),
  component: AwardQueue,
});

const HIGH_VALUE_THRESHOLD = 300000;

function daysSince(d?: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - dt.getTime()) / 86400000));
}

function toneForStage(s: string): "positive" | "attention" | "muted" | "neutral" {
  if (s === "won") return "positive";
  if (s === "verbally_awarded") return "attention";
  // contract_signed is one step from award — read it as close to won, not as
  // just another mid-pipeline stage.
  if (s === "contract_signed") return "positive";
  if (s === "contract_received") return "neutral";
  return "muted";
}

function AwardQueue() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<"all" | "verbal" | "contract" | "signed" | "won" | "highvalue">("all");

  const { data: opps = [], isLoading } = useQuery({
    queryKey: ["award-queue"],
    queryFn: async () =>
      (
        await supabase
          .from("opportunities")
          .select("id, project_name, sales_stage, estimated_value_max, contract_value, currency, expected_contract_date, handover_status, updated_at, client")
          // Stage list is centralised in dashboard-helpers and guarded by a test
          // (awardQueueMissingStages) — do NOT inline it again here.
          .in("sales_stage", [...AWARD_QUEUE_STAGES])
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });

  const today = new Date().toISOString().slice(0, 10);

  const verbalNoContract = useMemo(() => opps.filter((o: any) => o.sales_stage === "verbally_awarded"), [opps]);
  const contractReceived = useMemo(() => opps.filter((o: any) => o.sales_stage === "contract_received"), [opps]);
  const contractSigned = useMemo(() => opps.filter((o: any) => o.sales_stage === "contract_signed"), [opps]);
  const wonAwaiting = useMemo(() => opps.filter((o: any) => o.sales_stage === "won" && o.handover_status !== "handed_over"), [opps]);
  const overdue = useMemo(() => verbalNoContract.filter((o: any) => o.expected_contract_date && o.expected_contract_date < today), [verbalNoContract, today]);
  const highValue = useMemo(() => opps.filter((o: any) => (opportunityValue(o) ?? 0) >= HIGH_VALUE_THRESHOLD), [opps]);

  const totalValue = useMemo(() => sumOpportunityValue(opps as never).total, [opps]);

  const rows = useMemo(() => {
    if (tab === "verbal") return verbalNoContract;
    if (tab === "contract") return contractReceived;
    if (tab === "signed") return contractSigned;
    if (tab === "won") return wonAwaiting;
    if (tab === "highvalue") return highValue;
    return opps;
  }, [tab, opps, verbalNoContract, contractReceived, contractSigned, wonAwaiting, highValue]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Execution"
        title={t("nav_award_queue")}
        description="Awarded, contracted, and pending-evidence deals — sorted by time in stage."
      />

      <KpiRow>
        <KpiCard label="Combined value" value={<span className="num" data-tabular="true">{formatCurrency(totalValue, lang, "SAR")}</span>} icon={<Trophy className="h-3.5 w-3.5" />} />
        <KpiCard label={t("aq_verbal_no_contract")} value={verbalNoContract.length} icon={<Timer className="h-3.5 w-3.5" />} hint={`${overdue.length} overdue`} />
        <KpiCard label={t("aq_contracts_received")} value={contractReceived.length} icon={<FileSignature className="h-3.5 w-3.5" />} />
        <KpiCard label={t("aq_high_value")} value={highValue.length} icon={<AlertTriangle className="h-3.5 w-3.5" />} hint={`≥ ${formatCurrency(HIGH_VALUE_THRESHOLD, lang, "SAR")}`} />
      </KpiRow>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {([
          { k: "all", label: `All (${opps.length})` },
          { k: "verbal", label: `Verbal (${verbalNoContract.length})` },
          { k: "contract", label: `Contract received (${contractReceived.length})` },
          { k: "signed", label: `Contract signed (${contractSigned.length})` },
          { k: "won", label: `Awaiting handover (${wonAwaiting.length})` },
          { k: "highvalue", label: `High value (${highValue.length})` },
        ] as const).map((f) => (
          <button
            key={f.k}
            onClick={() => setTab(f.k)}
            className={`rounded-full border px-3 py-1.5 text-xs ${tab === f.k ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <SkeletonTable rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState message={t("wf_no_records")} />
      ) : (
        <div className="rounded-xl border border-border/70 bg-surface/60">
          <Table>
            <TableCaption>{t("nav_award_queue")}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Opportunity</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Handover</TableHead>
                <TableHead className="text-end">Value</TableHead>
                <TableHead className="text-end">Time in stage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o: any) => {
                const tis = daysSince(o.updated_at);
                const isOverdue = o.sales_stage === "verbally_awarded" && o.expected_contract_date && o.expected_contract_date < today;
                return (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link to="/opportunities/$id" params={{ id: o.id }} className="text-foreground hover:underline">
                        {o.project_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{o.client ?? "—"}</TableCell>
                    <TableCell><StatusPill tone={toneForStage(o.sales_stage)}>{o.sales_stage.replaceAll("_", " ")}</StatusPill></TableCell>
                    <TableCell className="text-muted-foreground">{o.handover_status ? o.handover_status.replaceAll("_", " ") : "—"}</TableCell>
                    <TableCell className="text-end text-foreground num" data-tabular="true">{formatCurrency(opportunityValue(o as never), lang, o.currency)}</TableCell>
                    <TableCell className={`text-end num ${isOverdue ? "text-destructive" : "text-muted-foreground"}`} data-tabular="true">
                      {tis == null ? "—" : `${tis}d`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
