import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { QuotationsPanel } from "@/components/phc/pipeline/QuotationsPanel";
import { RfqJihPanel } from "@/components/phc/pipeline/RfqJihPanel";
import { BoqPanel } from "@/components/phc/pipeline/BoqPanel";

// Phase 2 (system-redesign request): "these 3 pages have the same purpose —
// keep only the one that works for sales and estimation monitoring."
// /rfq-jih and /boq are retired to redirects into this page's tabs — their
// full content lives on unchanged in src/components/phc/pipeline/*Panel.tsx.
type PipelineTab = "quotations" | "rfq_jih" | "boq";

export const Route = createFileRoute("/_authenticated/quotations")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: s.tab === "rfq_jih" ? "rfq_jih" as const : s.tab === "boq" ? "boq" as const : "quotations" as const,
  }),
  head: () => ({
    meta: [{ title: "Quotations — PHC" }, { name: "robots", content: "noindex" }],
  }),
  component: QuotationsRoute,
});

function QuotationsRoute() {
  const { t } = useI18n();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setTab = (next: PipelineTab) => navigate({ search: { tab: next } });

  return (
    <div className="mx-auto max-w-7xl">
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
