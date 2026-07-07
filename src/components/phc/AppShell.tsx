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
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusPill } from "./StatusPill";

const nav = [
  { to: "/command-center", key: "nav_command_center", icon: LayoutDashboard },
  { to: "/opportunities", key: "nav_opportunities", icon: FolderKanban },
  { to: "/follow-ups", key: "nav_follow_ups", icon: CalendarClock },
  { to: "/quotations", key: "nav_quotations", icon: FileText },
  { to: "/boq", key: "nav_boq", icon: ClipboardList },
  { to: "/targets", key: "nav_targets", icon: Target },
  { to: "/discovery", key: "nav_discovery", icon: Inbox },
  { to: "/approvals", key: "nav_approvals", icon: ShieldCheck },
  { to: "/reports", key: "nav_reports", icon: LineChart },
  { to: "/agent-activity", key: "nav_agent_activity", icon: Activity },
  { to: "/team", key: "nav_team", icon: Users2 },
  { to: "/admin-settings", key: "nav_admin_settings", icon: ShieldAlert, ceoOnly: true },
  { to: "/settings", key: "nav_settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang, dir } = useI18n();
  const { user, signOut, hasRole } = useAuth();
  const nav_ = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (to: string) => path.startsWith(to);
  const isCeo = hasRole("ceo");

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 px-3 pt-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">PHC</div>
        <div className="mt-1 text-sm font-semibold text-foreground">{t("area_sales_agent")}</div>
      </div>
      {nav.filter((n) => !("ceoOnly" in n && n.ceoOnly) || isCeo).map((n) => {
        const Icon = n.icon;
        const active = isActive(n.to);
        return (
          <Link
            key={n.to}
            to={n.to}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{t(n.key as never)}</span>
            {active ? <span className="ms-auto h-1.5 w-1.5 rounded-full bg-amber" /> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div dir={dir} className="min-h-screen bg-background text-foreground">
      {/* Sidebar (desktop) */}
      <aside
        className={cn(
          "fixed inset-y-0 z-40 hidden w-64 border-border bg-sidebar md:block",
          dir === "rtl" ? "right-0 border-l" : "left-0 border-r",
        )}
      >
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div
            className={cn(
              "absolute inset-y-0 w-72 bg-sidebar",
              dir === "rtl" ? "right-0 border-l border-border" : "left-0 border-r border-border",
            )}
          >
            {sidebar}
          </div>
        </div>
      ) : null}

      {/* Main column */}
      <div className={cn("flex min-h-screen flex-col", dir === "rtl" ? "md:mr-64" : "md:ml-64")}>
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:px-6">
            <div className="flex items-center gap-2">
              <button
                className="grid h-9 w-9 place-items-center rounded-md border border-border bg-surface md:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="hidden items-center gap-2 md:flex">
                <StatusPill tone="positive">● {t("agent_status_running")}</StatusPill>
                <span className="text-xs text-muted-foreground">
                  {t("last_refreshed")}: {new Date().toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>

            <div className="min-w-0 text-center md:text-start">
              <div className="truncate text-sm font-semibold text-foreground">
                PHC · {t("area_sales_agent")}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setLang(lang === "en" ? "ar" : "en")}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                aria-label={t("language")}
              >
                <Globe className="h-3.5 w-3.5" />
                {lang === "en" ? "AR" : "EN"}
              </button>
              <button
                className="hidden h-8 w-8 place-items-center rounded-md border border-border bg-surface hover:bg-muted sm:grid"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
              </button>
              <div className="hidden items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs sm:flex">
                <span className="max-w-[140px] truncate text-muted-foreground">
                  {user?.email ?? ""}
                </span>
                <button
                  onClick={async () => {
                    await signOut();
                    nav_({ to: "/auth" });
                  }}
                  aria-label={t("sign_out")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
