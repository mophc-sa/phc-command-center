import { createFileRoute } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { useI18n } from "@/lib/i18n";
import { NO_RIGHTS, canEditCostRates, canSetGlobalMargins } from "@/lib/pricing-access";
import { pick, type Bi } from "@/lib/pricing-text";
import { usePricingRights } from "@/components/phc/pricing/usePricingRights";
import { CatalogCard, DefaultsCard, InstallationRatesCard } from "@/components/phc/pricing/SettingsCards";

export const Route = createFileRoute("/_authenticated/pricing/settings")({
  head: () => ({ meta: [{ title: "Pricing settings — PHC" }, { name: "robots", content: "noindex" }] }),
  component: PricingSettingsPage,
});

const TEXT = {
  eyebrow: { en: "Pricing & Finance", ar: "التسعير والمالية" },
  title: { en: "Pricing settings", ar: "إعدادات التسعير" },
  editDesc: { en: "Rates every price is built from. Changes apply to prices built from now on; a price already proposed keeps its figures.", ar: "الأسعار التي يُبنى منها كل سعر. التغييرات تسري على ما يُبنى من الآن؛ السعر المقترح يحتفظ بأرقامه." },
  viewDesc: { en: "Estimation and finance keep these rates. You can read them.", ar: "يحدّث التقدير والمالية هذه الأسعار. يمكنك الاطلاع عليها." },
  noAccess: { en: "Pricing settings are for estimation, finance and management", ar: "إعدادات التسعير للتقدير والمالية والإدارة" },
} satisfies Record<string, Bi>;

function PricingSettingsPage() {
  const { lang } = useI18n();
  const rights = usePricingRights();
  const r = rights.data ?? NO_RIGHTS;
  if (rights.isLoading) return <SkeletonTable />;
  // The cost rates are cost: readers see them, and RLS returns nothing to anyone else.
  if (!r.can_read_cost) return <EmptyState icon={SlidersHorizontal} title={pick(TEXT.noAccess, lang)} />;
  const canEditRates = canEditCostRates(r);
  const canSetMargins = canSetGlobalMargins(r);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={pick(TEXT.eyebrow, lang)} title={pick(TEXT.title, lang)} description={pick(canEditRates || canSetMargins ? TEXT.editDesc : TEXT.viewDesc, lang)} />
      <InstallationRatesCard canEdit={canEditRates} />
      <DefaultsCard canEditRates={canEditRates} canSetMargins={canSetMargins} />
      <CatalogCard canEdit={canEditRates} />
    </div>
  );
}
