import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/phc/PageHeader";
import { parsePipelineSearch, type PipelineTab } from "@/lib/pipeline-tabs";
import { QuotationsPanel } from "@/components/phc/pipeline/QuotationsPanel";
import { RfqJihPanel } from "@/components/phc/pipeline/RfqJihPanel";
import { BoqPanel } from "@/components/phc/pipeline/BoqPanel";

// Phase 2 (system-redesign request): "these 3 pages have the same purpose —
// keep only the one that works for sales and estimation monitoring."
// /rfq-jih and /boq are retired to redirects into this page's tabs — their
// full content lives on unchanged in src/components/phc/pipeline/*Panel.tsx.
// The tab vocabulary and its parser live in @/lib/pipeline-tabs so they can be
// tested by calling them. They used to be a nested ternary here, guarded only
// by a contract test grepping this file for `s.tab === "rfq_jih"`.
export const Route = createFileRoute("/_authenticated/quotations")({
  validateSearch: parsePipelineSearch,
  head: () => ({
    meta: [{ title: "Quotations — PHC" }, { name: "robots", content: "noindex" }],
  }),
  component: QuotationsRoute,
});

function QuotationsRoute() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setTab = (next: PipelineTab) => navigate({ search: { tab: next } });

  return (
    <div className="mx-auto max-w-7xl">
      {/* This page opened straight into its tab bar, so it was the only screen
          in the app with no heading: a reader arriving from a link had nothing
          naming where they had landed. */}
      <PageHeader
        eyebrow={ar ? "التسعير" : "Pricing"}
        title={ar ? "عروض الأسعار والطلبات" : "Quotations and requests"}
        description={
          ar
            ? "عروض الأسعار وطلبات التسعير وجداول الكميات في مكان واحد."
            : "Quotations, pricing requests and bills of quantities in one place."
        }
      />
      <div className="mb-6 flex gap-2 border-b border-border/60">
        {([
          ["quotations", t("nav_quotations")],
          ["rfq_jih", t("nav_rfq_jih")],
          ["boq", t("nav_boq")],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "border-b-2 border-amber px-3 py-2 text-sm font-medium text-foreground"
                : "border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "quotations" ? <QuotationsPanel /> : tab === "rfq_jih" ? <RfqJihPanel /> : <BoqPanel />}
    </div>
  );
}
