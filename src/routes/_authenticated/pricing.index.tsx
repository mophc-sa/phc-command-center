import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Calculator, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { PRICING_STATE_LABEL } from "@/lib/pricing";
import { listPricingQueue, openPricingFile } from "@/lib/pricing-actions";
import {
  canOpenPricing, daysWaiting, defaultQueueFilter, inQueue, nextOwner, NEXT_OWNER_LABEL, NO_RIGHTS,
  type QueueFilter,
} from "@/lib/pricing-access";
import { opportunityValue } from "@/lib/opportunity-value";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { searchOpportunities } from "@/lib/meetings-actions";
import { usePricingRights } from "@/components/phc/pricing/usePricingRights";

export const Route = createFileRoute("/_authenticated/pricing/")({
  head: () => ({ meta: [{ title: "Pricing — PHC" }, { name: "robots", content: "noindex" }] }),
  component: PricingQueuePage,
});

const TEXT = {
  eyebrow: { en: "Pricing & Finance", ar: "التسعير والمالية" },
  title: { en: "Pricing queue", ar: "قائمة التسعير" },
  desc: { en: "Open pricing files: where each price is, who owes the next step, and for how long.", ar: "ملفات التسعير المفتوحة: أين وصل كل سعر، ومن عليه الخطوة التالية، ومنذ متى." },
  all: { en: "All open", ar: "كل المفتوح" },
  pricer: { en: "Estimation & finance", ar: "التقدير والمالية" },
  gm: { en: "Set selling price (GM)", ar: "وضع سعر البيع (المدير العام)" },
  project: { en: "Project", ar: "المشروع" },
  state: { en: "State", ar: "الحالة" },
  next: { en: "Next step", ar: "الخطوة التالية" },
  waiting: { en: "Waiting", ar: "الانتظار" },
  value: { en: "Deal value", ar: "قيمة الفرصة" },
  days: { en: "days", ar: "يوم" },
  overdue: { en: "Missing items overdue", ar: "النواقص متأخرة" },
  empty: { en: "Nothing waiting here", ar: "لا شيء بالانتظار هنا" },
  emptyHint: { en: "A pricing file opens by itself when an RFQ is saved on a deal.", ar: "يُفتح ملف التسعير تلقائياً عند حفظ طلب تسعير على فرصة." },
  noAccess: { en: "Pricing is for estimation, finance and management", ar: "التسعير للتقدير والمالية والإدارة" },
  noAccessHint: { en: "Ask your manager if you need to see a price.", ar: "اسأل مديرك إن احتجت رؤية سعر." },
  openTitle: { en: "Open a pricing file for a deal", ar: "افتح ملف تسعير لفرصة" },
  openHint: { en: "For deals whose RFQ came in before pricing files existed.", ar: "للفرص التي وصل طلبها قبل ملفات التسعير." },
  search: { en: "Search deals by name…", ar: "ابحث عن فرصة بالاسم…" },
  open: { en: "Open file", ar: "افتح الملف" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

function PricingQueuePage() {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const rights = usePricingRights();
  const r = rights.data ?? NO_RIGHTS;
  const allowed = canOpenPricing(r);
  const queue = useQuery({ queryKey: ["pricing-queue"], queryFn: listPricingQueue, enabled: allowed });
  const [chosen, setChosen] = useState<QueueFilter | null>(null);
  const filter = chosen ?? defaultQueueFilter(r);
  const [term, setTerm] = useState("");
  const deals = useQuery({
    queryKey: ["pricing-deal-search", term],
    queryFn: () => searchOpportunities(term),
    enabled: r.is_pricer && term.trim().length >= 2,
  });
  const today = new Date().toISOString().slice(0, 10);

  const shown = useMemo(
    () =>
      (queue.data ?? [])
        .filter((row) => inQueue(row.state, filter))
        .map((row) => ({ row, days: daysWaiting(row.state_changed_at) }))
        .sort((a, b) => b.days - a.days),
    [queue.data, filter],
  );

  async function openFor(opportunityId: string) {
    try {
      const f = await openPricingFile(opportunityId);
      await navigate({ to: "/pricing/$id", params: { id: f.id }, search: {} });
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  if (rights.isLoading) return <SkeletonTable />;
  if (!allowed) {
    return <EmptyState icon={Calculator} title={pick(TEXT.noAccess, lang)} description={pick(TEXT.noAccessHint, lang)} />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow={pick(TEXT.eyebrow, lang)} title={pick(TEXT.title, lang)} description={pick(TEXT.desc, lang)} />
      <div className="flex flex-wrap gap-2" role="group" aria-label={pick(TEXT.title, lang)}>
        {(["pricer", "gm", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} aria-pressed={filter === f} onClick={() => setChosen(f)}>
            {pick(TEXT[f], lang)}
          </Button>
        ))}
      </div>

      {queue.isLoading ? (
        <SkeletonTable />
      ) : queue.isError ? (
        <QueryFailure retry={() => queue.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Calculator} title={pick(TEXT.empty, lang)} description={pick(TEXT.emptyHint, lang)} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.project, lang)}</TableHead>
              <TableHead>{pick(TEXT.state, lang)}</TableHead>
              <TableHead>{pick(TEXT.next, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.waiting, lang)}</TableHead>
              <TableHead className="text-end">{pick(TEXT.value, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(({ row, days }) => {
              const overdue = row.state === "needs_info" && row.needs_info_due != null && row.needs_info_due < today;
              return (
                <TableRow key={row.file_id}>
                  <TableCell>
                    <Link to="/pricing/$id" params={{ id: row.file_id }} search={{}} className="font-medium text-foreground hover:underline">
                      {row.project_name ?? "—"}
                    </Link>
                    {row.project_code ? <div className="text-xs text-muted-foreground">{row.project_code}</div> : null}
                  </TableCell>
                  <TableCell>
                    <StatusPill tone={overdue ? "danger" : "neutral"}>{pick(PRICING_STATE_LABEL[row.state], lang)}</StatusPill>
                    {overdue ? <div className="mt-1 text-xs text-destructive">{pick(TEXT.overdue, lang)}</div> : null}
                  </TableCell>
                  <TableCell>{pick(NEXT_OWNER_LABEL[nextOwner(row.state)], lang)}</TableCell>
                  <TableCell className="text-end tabular-nums">{days} {pick(TEXT.days, lang)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(opportunityValue(row), lang)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {r.is_pricer ? (
        <Panel title={pick(TEXT.openTitle, lang)} subtitle={pick(TEXT.openHint, lang)}>
          <div className="space-y-3">
            <input className={FIELD} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={pick(TEXT.search, lang)} aria-label={pick(TEXT.search, lang)} />
            {(deals.data ?? []).map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{d.project_name ?? "—"}</span>
                <Button size="sm" variant="outline" onClick={() => void openFor(d.id)}>
                  <FolderPlus className="me-1 h-4 w-4" aria-hidden="true" />
                  {pick(TEXT.open, lang)}
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
