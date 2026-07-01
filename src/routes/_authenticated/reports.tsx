import { createFileRoute } from "@tanstack/react-router";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — PHC" }, { name: "robots", content: "noindex" }] }),
  component: () => {
    const { t, lang } = useI18n();
    return (
      <div className="mx-auto max-w-7xl">
        <SectionHeader title={t("nav_reports")} hint={lang === "ar" ? "قريباً — تقارير المبيعات." : "Coming soon — sales performance reports."} />
        <EmptyState message={lang === "ar" ? "لا توجد تقارير حتى الآن." : "No reports have been generated yet."} />
      </div>
    );
  },
});
