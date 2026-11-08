import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, localeFor, formatCurrency, formatNumber } from "@/lib/i18n";
import { canPricerMove, PRICING_STATE_LABEL } from "@/lib/pricing";
import { getPricingFile, listCostNotes, listFileEvents, movePricingFile } from "@/lib/pricing-actions";
import {
  canOpenPricing, daysWaiting, defaultTab, nextOwner, NEXT_OWNER_LABEL, NO_RIGHTS, parsePricingTab,
  PRICING_TAB_LABEL, visibleTabs, type PricingTab,
} from "@/lib/pricing-access";
import { opportunityValue } from "@/lib/opportunity-value";
import { asError, dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { usePricingRights } from "@/components/phc/pricing/usePricingRights";
import { PackageTab } from "@/components/phc/pricing/PackageTab";
import { SupplierTab } from "@/components/phc/pricing/SupplierTab";
import { CostReviewTab } from "@/components/phc/pricing/CostReviewTab";
import { SellingPriceTab } from "@/components/phc/pricing/SellingPriceTab";

export const Route = createFileRoute("/_authenticated/pricing/$id")({
  validateSearch: (s: Record<string, unknown>): { tab?: PricingTab } => ({ tab: parsePricingTab(s.tab) }),
  head: () => ({ meta: [{ title: "Pricing file — PHC" }, { name: "robots", content: "noindex" }] }),
  component: PricingFilePage,
});

const TEXT = {
  eyebrow: { en: "Pricing file", ar: "ملف التسعير" },
  next: { en: "Next step", ar: "الخطوة التالية" },
  waiting: { en: "waiting", ar: "بالانتظار" },
  days: { en: "days", ar: "يوم" },
  value: { en: "Deal value", ar: "قيمة الفرصة" },
  deal: { en: "Open the deal", ar: "افتح الفرصة" },
  start: { en: "Start package review", ar: "ابدأ دراسة الباكيج" },
  started: { en: "Package review started", ar: "بدأت دراسة الباكيج" },
  close: { en: "Close file", ar: "أغلق الملف" },
  closeTitle: { en: "Close this pricing file", ar: "إغلاق ملف التسعير" },
  closeDesc: { en: "The reason is visible to the sales rep on the deal. Do not write cost or margin reasons here.", ar: "السبب ظاهر لمندوب المبيعات في الفرصة. لا تكتب هنا أسباباً تخص التكلفة أو الهامش." },
  reason: { en: "Reason", ar: "السبب" },
  closed: { en: "Closed", ar: "مغلق" },
  history: { en: "History", ar: "السجل" },
  costNote: { en: "Cost note", ar: "ملاحظة تكلفة" },
  noHistory: { en: "No moves yet.", ar: "لا حركات بعد." },
  notFound: { en: "Pricing file not found", ar: "ملف التسعير غير موجود" },
  noAccess: { en: "Pricing is for estimation, finance and management", ar: "التسعير للتقدير والمالية والإدارة" },
} satisfies Record<string, Bi>;

function PricingFilePage() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const rights = usePricingRights();
  const r = rights.data ?? NO_RIGHTS;
  const allowed = canOpenPricing(r);
  const file = useQuery({ queryKey: ["pricing-file", id], queryFn: () => getPricingFile(id), enabled: allowed });
  const events = useQuery({ queryKey: ["pricing-events", id], queryFn: () => listFileEvents(id), enabled: allowed });
  const notes = useQuery({ queryKey: ["pricing-cost-notes", id], queryFn: () => listCostNotes(id), enabled: allowed && r.can_read_cost });
  const [closeOpen, setCloseOpen] = useState(false);

  const onChanged = () => {
    void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("pricing-") });
  };

  if (rights.isLoading || (allowed && file.isLoading)) return <SkeletonTable />;
  if (!allowed) return <EmptyState icon={Calculator} title={pick(TEXT.noAccess, lang)} />;
  if (file.isError) return <QueryFailure retry={() => file.refetch()} />;
  if (!file.data) return <EmptyState icon={Calculator} title={pick(TEXT.notFound, lang)} />;

  const f = file.data;
  const tabs = visibleTabs(r);
  const current: PricingTab = tab && tabs.includes(tab) ? tab : defaultTab(f.state, r);
  const goToCost = tabs.includes("cost") ? () => void navigate({ search: { tab: "cost" as PricingTab } }) : undefined;
  const props = { file: f, rights: r, onChanged, goToCost };

  async function start() {
    try {
      await movePricingFile(f.file_id, "package_review");
      toast.success(pick(TEXT.started, lang));
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow={f.project_code ? `${pick(TEXT.eyebrow, lang)} · ${f.project_code}` : pick(TEXT.eyebrow, lang)}
        title={f.project_name ?? "—"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={f.state === "closed" ? "muted" : "neutral"}>{pick(PRICING_STATE_LABEL[f.state], lang)}</StatusPill>
            <span>
              {pick(TEXT.next, lang)}: {pick(NEXT_OWNER_LABEL[nextOwner(f.state)], lang)} · {formatNumber(daysWaiting(f.state_changed_at), lang)} {pick(TEXT.days, lang)} {pick(TEXT.waiting, lang)}
            </span>
            <span>
              {pick(TEXT.value, lang)}: {formatCurrency(opportunityValue(f), lang)}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/opportunities/$id" params={{ id: f.opportunity_id }}>{pick(TEXT.deal, lang)}</Link>
            </Button>
            {r.is_pricer && f.state === "received" ? (
              <Button size="sm" onClick={() => void start()}>{pick(TEXT.start, lang)}</Button>
            ) : null}
            {r.is_pricer && canPricerMove(f.state, "closed") ? (
              <Button size="sm" variant="outline" onClick={() => setCloseOpen(true)}>{pick(TEXT.close, lang)}</Button>
            ) : null}
          </div>
        }
      />

      {f.state === "closed" && f.closed_reason ? (
        <p className="text-sm text-muted-foreground">
          {pick(TEXT.closed, lang)}: {f.closed_reason}
        </p>
      ) : null}

      <Tabs value={current} onValueChange={(v) => void navigate({ search: { tab: v as PricingTab } })}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t}>{pick(PRICING_TAB_LABEL[t], lang)}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="package"><PackageTab {...props} /></TabsContent>
        <TabsContent value="supplier"><SupplierTab {...props} /></TabsContent>
        {tabs.includes("cost") ? <TabsContent value="cost"><CostReviewTab {...props} /></TabsContent> : null}
        {tabs.includes("selling") ? <TabsContent value="selling"><SellingPriceTab {...props} /></TabsContent> : null}
      </Tabs>

      <Panel title={pick(TEXT.history, lang)}>
        {(events.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{pick(TEXT.noHistory, lang)}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {(events.data ?? []).map((e) => (
              <li key={e.id}>
                <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString(localeFor(lang))}</span>{" "}
                {e.from_state ? `${pick(PRICING_STATE_LABEL[e.from_state], lang)} → ` : ""}
                {pick(PRICING_STATE_LABEL[e.to_state], lang)}
                {e.note ? <span className="text-muted-foreground"> · {e.note}</span> : null}
              </li>
            ))}
            {(notes.data ?? []).map((n) => (
              <li key={`c-${n.id}`}>
                <span className="text-muted-foreground">{new Date(n.created_at).toLocaleString(localeFor(lang))}</span>{" "}
                {pick(TEXT.costNote, lang)} ({pick(PRICING_STATE_LABEL[n.to_state], lang)}): {n.cost_note}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ActionDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title={pick(TEXT.closeTitle, lang)}
        description={pick(TEXT.closeDesc, lang)}
        fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
        submitLabel={pick(TEXT.close, lang)}
        destructive
        recordId={f.file_id}
        onSubmit={async (v) => {
          try {
            await movePricingFile(f.file_id, "closed", v.reason);
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </div>
  );
}
