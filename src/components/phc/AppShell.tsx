import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import {
  LayoutDashboard,
  FolderKanban,
  CalendarClock,
  Inbox,
  ShieldCheck,
  LineChart,
  Activity,
  Users2,
  Settings,
  Menu,
  Globe,
  LogOut,
  Bell,
  ShieldAlert,
  FileText,
  ClipboardList,
  Target,
  Building2,
  Contact2,
  Landmark,
  Briefcase,
  Truck,
  Library,
  Sparkles,
  ClipboardCheck,
  Gavel,
  GitMerge,
  Award,
  BellRing,
  DatabaseZap,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import phcLogo from "@/assets/phc-logo.png.asset.json";
import { cn } from "@/lib/utils";
import { StatusPill } from "./StatusPill";

type NavItem = { to: string; key: string; icon: LucideIcon; ceoOnly?: boolean };
type NavGroup = { key: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    key: "navgroup_overview",
    items: [
      { to: "/command-center", key: "nav_command_center", icon: LayoutDashboard },
      { to: "/my-workspace", key: "nav_workspace", icon: Briefcase },
    ],
  },
  {
    key: "navgroup_crm",
    items: [
      { to: "/accounts", key: "nav_accounts", icon: Building2 },
      { to: "/contacts", key: "nav_contacts", icon: Contact2 },
      { to: "/projects", key: "nav_projects", icon: Landmark },
      { to: "/opportunities", key: "nav_opportunities", icon: FolderKanban },
    ],
  },
  {
    key: "navgroup_pipeline",
    items: [
      { to: "/rfq-jih", key: "nav_rfq_jih", icon: ClipboardCheck },
      { to: "/tenders", key: "nav_tenders", icon: Gavel },
      { to: "/tender-conversion", key: "nav_tender_conversion", icon: GitMerge },
      { to: "/award-queue", key: "nav_award_queue", icon: Award },
    ],
  },
  {
    key: "navgroup_execution",
    items: [
      { to: "/action-center", key: "nav_action_center", icon: BellRing },
      { to: "/follow-ups", key: "nav_follow_ups", icon: CalendarClock },
      { to: "/quotations", key: "nav_quotations", icon: FileText },
      { to: "/boq", key: "nav_boq", icon: ClipboardList },
      { to: "/targets", key: "nav_targets", icon: Target },
    ],
  },
  {
    key: "navgroup_intelligence",
    items: [
      { to: "/discovery", key: "nav_discovery", icon: Inbox },
      { to: "/approvals", key: "nav_approvals", icon: ShieldCheck },
      { to: "/vendors", key: "nav_vendors", icon: Truck },
      { to: "/reference-library", key: "nav_reference_library", icon: Library },
      { to: "/knowledge", key: "nav_knowledge", icon: Sparkles },
      { to: "/reports", key: "nav_reports", icon: LineChart },
      { to: "/agent-activity", key: "nav_agent_activity", icon: Activity },
    ],
  },
  {
    key: "navgroup_admin",
    items: [
      { to: "/team", key: "nav_team", icon: Users2 },
      { to: "/data-import", key: "nav_data_import", icon: DatabaseZap, ceoOnly: true },
      { to: "/admin-settings", key: "nav_admin_settings", icon: ShieldAlert, ceoOnly: true },
      { to: "/settings", key: "nav_settings", icon: Settings },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang, dir } = useI18n();
  const { user, signOut, hasRole } = useAuth();
  const nav_ = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (to: string) =>
    to === "/" ? path === "/" : path === to || path.startsWith(to + "/");
  const isCeo = hasRole("ceo");
  const tSafe = (k: string, fallback: string) => {
    const v = t(k as never);
    return v === k ? fallback : v;
  };

  const groupFallbacks: Record<string, string> = {
    navgroup_overview: "Overview",
    navgroup_crm: "CRM",
    navgroup_pipeline: "Pipeline",
    navgroup_execution: "Execution",
    navgroup_intelligence: "Intelligence & Resources",
    navgroup_admin: "Admin",
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="px-5 pt-6 pb-5">
        <Link to="/command-center" className="flex items-center gap-3">
          <img
            src={phcIcon.url}
            alt="PHC"
            className="h-8 w-8 shrink-0 object-contain"
          />
          <img
            src={phcLogo.url}
            alt="PHC Wayfinding Signs"
            className="h-6 min-w-0 flex-1 object-contain object-left"
          />
        </Link>
      </div>

      <div className="mx-4 h-px bg-border/70" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g) => {
          const items = g.items.filter((n) => !n.ceoOnly || isCeo);
          if (items.length === 0) return null;
          return (
            <div key={g.key} className="mb-5 last:mb-0">
              <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                {tSafe(g.key, groupFallbacks[g.key] ?? g.key)}
              </div>
              <div className="flex flex-col gap-0.5">
                {items.map((n) => {
                  const Icon = n.icon;
                  const active = isActive(n.to);
                  return (
                    <Link
                      key={n.to}
                      to={n.to}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors duration-150",
                        active
                          ? "bg-sidebar-accent text-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                      )}
                    >
                      {active ? (
                        <span
                          className={cn(
                            "absolute top-1.5 bottom-1.5 w-[2px] rounded-full bg-foreground",
                            dir === "rtl" ? "right-0" : "left-0",
                          )}
                        />
                      ) : null}
                      <Icon
                        className={cn(
                          "h-[15px] w-[15px] shrink-0 transition-colors",
                          active ? "text-foreground" : "text-muted-foreground/80 group-hover:text-foreground",
                        )}
                        strokeWidth={1.75}
                      />
                      <span className="truncate">{t(n.key as never)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer identity */}
      <div className="border-t border-border/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-[11px] font-medium text-foreground">
            {(user?.email ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-foreground">
              {user?.email ?? ""}
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
              {isCeo ? "CEO" : t("nav_workspace")}
            </div>
          </div>
          <button
            onClick={async () => {
              await signOut();
              nav_({ to: "/auth", search: { next: "" } });
            }}
            aria-label={t("sign_out")}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div dir={dir} className="min-h-screen bg-background text-foreground">
      {/* Sidebar (desktop) */}
      <aside
        className={cn(
          "fixed inset-y-0 z-40 hidden w-64 bg-sidebar md:block",
          dir === "rtl" ? "right-0 border-l border-sidebar-border" : "left-0 border-r border-sidebar-border",
        )}
      >
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div
            className={cn(
              "absolute inset-y-0 w-72 bg-sidebar",
              dir === "rtl" ? "right-0 border-l border-sidebar-border" : "left-0 border-r border-sidebar-border",
            )}
          >
            {sidebar}
          </div>
        </div>
      ) : null}

      {/* Main column */}
      <div className={cn("flex min-h-screen flex-col", dir === "rtl" ? "md:mr-64" : "md:ml-64")}>
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-3 px-4 md:px-8">
            <button
              className="grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="hidden items-center gap-3 md:flex">
              <StatusPill tone="positive">● {t("agent_status_running")}</StatusPill>
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("last_refreshed")}
                <span className="ms-2 normal-case tracking-normal text-foreground/70">
                  {new Date().toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
            </div>

            <div className="ms-auto flex items-center gap-2">
              <button
                onClick={() => setLang(lang === "en" ? "ar" : "en")}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t("language")}
              >
                <Globe className="h-3.5 w-3.5" />
                {lang === "en" ? "AR" : "EN"}
              </button>
              <button
                className="relative hidden h-8 w-8 place-items-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground sm:grid"
                aria-label="Notifications"
              >
                <Bell className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-10">{children}</main>
      </div>
    </div>
  );
}
