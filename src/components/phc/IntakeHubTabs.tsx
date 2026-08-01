import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// System-redesign request (2026-08-01): Intake is the unified entry point
// for Requests, Opportunities, and Quotations. Rather than physically
// merging three independent, fully-featured routes (each with its own
// data-fetching, role gating, and sub-dialogs) into one component — which
// would risk breaking existing bookmarks and duplicating a lot of working
// code — this tab bar gives all three pages the same clear, one-click
// navigation between them, with zero duplicated logic and zero moved
// routes. Every existing URL (/lead-tender-inbox, /opportunities,
// /quotations) keeps working exactly as before.
export type IntakeHubTab = "requests" | "opportunities" | "quotations";

export function IntakeHubTabs({ active }: { active: IntakeHubTab }) {
  const { t } = useI18n();
  const tabs: { key: IntakeHubTab; label: string; to: string }[] = [
    { key: "requests", label: t("ibx_title"), to: "/lead-tender-inbox" },
    { key: "opportunities", label: t("nav_opportunities"), to: "/opportunities" },
    { key: "quotations", label: t("nav_quotations"), to: "/quotations" },
  ];
  return (
    <div className="mb-4 flex items-center gap-1 rounded-md border border-border bg-surface/60 p-1 text-xs">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          to={tab.to}
          className={cn(
            "rounded px-3 py-1.5 font-medium transition-colors",
            active === tab.key
              ? "bg-surface text-foreground shadow-card"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
