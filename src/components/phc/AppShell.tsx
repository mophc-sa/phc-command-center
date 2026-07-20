import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canViewSalesAdmin, ALL_ROLES, type AppRole } from "@/lib/roles";
import { usePinnedRecords, type PinnedRecord } from "@/hooks/usePinnedRecords";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { useNotifications } from "@/hooks/useNotifications";
import { CommandPalette, RECORD_TYPE_ICONS } from "@/components/phc/CommandPalette";
import { NotificationCenter } from "@/components/phc/NotificationCenter";
import { FontSizeControl } from "@/components/phc/FontSizeControl";
import { StatusPill } from "@/components/phc/StatusPill";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Bot,
  BookOpen,
  ClipboardCheck,
  Gavel,
  GitMerge,
  Award,
  BellRing,
  DatabaseZap,
  Mailbox,
  Search,
  Plus,
  ChevronDown,
  Pin,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const phcLogo = { url: "/phc-logo.png" };

// ── Nav type system ────────────────────────────────────────────────────────

type NavLink = {
  kind: "link";
  to: string;
  key: string;
  icon: LucideIcon;
  requireAdmin?: boolean;
};

type NavButton = {
  kind: "button";
  action: "notifications";
  key: string;
  icon: LucideIcon;
};

type NavItem = NavLink | NavButton;

type NavGroup = {
  key: string;
  fallback: string;
  collapsible?: boolean;
  items: NavItem[];
};

// ── Navigation architecture ────────────────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    key: "navgroup_workspace",
    fallback: "Workspace",
    items: [
      { kind: "link",   to: "/my-workspace",      key: "nav_my_day",        icon: Briefcase },
      { kind: "link",   to: "/action-center",      key: "nav_action_center", icon: BellRing },
      { kind: "button", action: "notifications",   key: "nav_notifications", icon: Bell },
    ],
  },
  {
    key: "navgroup_pipeline",
    fallback: "Pipeline",
    items: [
      { kind: "link", to: "/command-center",    key: "nav_pipeline_overview", icon: LayoutDashboard },
      { kind: "link", to: "/lead-tender-inbox", key: "nav_intake",            icon: Mailbox },
      { kind: "link", to: "/opportunities",     key: "nav_opportunities",     icon: FolderKanban },
      { kind: "link", to: "/rfq-jih",           key: "nav_rfq_jih",           icon: ClipboardCheck },
      { kind: "link", to: "/tenders",           key: "nav_tenders",           icon: Gavel },
    ],
  },
  {
    key: "navgroup_execution",
    fallback: "Execution",
    items: [
      { kind: "link", to: "/approvals",         key: "nav_approvals",         icon: ShieldCheck },
      { kind: "link", to: "/follow-ups",        key: "nav_follow_ups",        icon: CalendarClock },
      { kind: "link", to: "/quotations",        key: "nav_quotations",        icon: FileText },
      { kind: "link", to: "/boq",               key: "nav_boq",               icon: ClipboardList },
      { kind: "link", to: "/award-queue",       key: "nav_awards",            icon: Award },
      { kind: "link", to: "/tender-conversion", key: "nav_conversion_queue",  icon: GitMerge },
    ],
  },
  {
    key: "navgroup_crm",
    fallback: "CRM",
    items: [
      { kind: "link", to: "/accounts", key: "nav_accounts", icon: Building2 },
      { kind: "link", to: "/contacts", key: "nav_contacts", icon: Contact2 },
      { kind: "link", to: "/projects", key: "nav_projects", icon: Landmark },
    ],
  },
  {
    key: "navgroup_reports",
    fallback: "Reports & Analysis",
    items: [
      { kind: "link", to: "/reports", key: "nav_reports", icon: LineChart },
      { kind: "link", to: "/targets", key: "nav_targets", icon: Target },
    ],
  },
  {
    key: "navgroup_resources",
    fallback: "Resources",
    items: [
      { kind: "link", to: "/knowledge",         key: "nav_knowledge",         icon: BookOpen },
      { kind: "link", to: "/reference-library", key: "nav_reference_library", icon: Library },
      { kind: "link", to: "/vendors",           key: "nav_vendors",           icon: Truck },
      { kind: "link", to: "/discovery",         key: "nav_discovery",         icon: Inbox },
    ],
  },
  {
    key: "navgroup_admin",
    fallback: "Admin",
    collapsible: true,
    items: [
      { kind: "link", to: "/ai-agents",       key: "nav_ai_agents",       icon: Bot },
      { kind: "link", to: "/agent-activity",  key: "nav_agent_activity",  icon: Activity },
      { kind: "link", to: "/team",            key: "nav_team",            icon: Users2 },
      { kind: "link", to: "/data-import",     key: "nav_data_import",     icon: DatabaseZap, requireAdmin: true },
      { kind: "link", to: "/admin-settings",  key: "nav_admin_settings",  icon: ShieldAlert, requireAdmin: true },
      { kind: "link", to: "/settings",        key: "nav_settings",        icon: Settings },
    ],
  },
];

// Admin routes — used to auto-open the admin group when the user is on one
const ADMIN_ROUTE_PREFIXES = [
  "/ai-agents", "/agent-activity", "/team", "/data-import", "/admin-settings", "/settings",
];

// Record type → to-path segment mapping (for auto-tracking recents)
const PATH_TO_TYPE: Record<string, PinnedRecord["type"]> = {
  opportunities: "opportunity",
  accounts: "account",
  projects: "project",
};

// ── AppShell ───────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang, dir } = useI18n();
  const { user, signOut, roles } = useAuth();
  const nav_ = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const canAdmin = canViewSalesAdmin(roles);
  const topRole = ALL_ROLES.find((r) => (roles as AppRole[]).includes(r));

  // UI state
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const { data: notifItems = [] } = useNotifications();
  const notifCount = notifItems.length;

  const isOnAdminRoute = ADMIN_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
  const [adminOpen, setAdminOpen] = useState(() => canAdmin || isOnAdminRoute);

  // Auto-open admin group when navigating to admin route
  useEffect(() => {
    if (isOnAdminRoute) setAdminOpen(true);
  }, [isOnAdminRoute]);

  // Recents & pins
  const { recent, trackRecent } = useRecentRecords();
  const { pinned } = usePinnedRecords();

  // Auto-track $id page visits from the path
  useEffect(() => {
    const m = path.match(/^\/(opportunities|accounts|projects)\/([0-9a-f-]{36})/i);
    if (!m) return;
    const [, segment, id] = m;
    const type = PATH_TO_TYPE[segment];
    if (!type) return;
    // Try to find the label in React Query cache
    const cached =
      qc.getQueryData<any>(["opportunity", id]) ??
      qc.getQueryData<any>(["company", id]) ??
      qc.getQueryData<any>(["project", id]);
    const label =
      cached?.project_name ??
      cached?.name ??
      cached?.tender_name ??
      (type.charAt(0).toUpperCase() + type.slice(1));
    trackRecent({ id, type, label, to: path, visitedAt: Date.now() });
  }, [path, qc, trackRecent]);

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const isActive = useCallback(
    (to: string) =>
      to === "/" ? path === "/" : path === to || path.startsWith(to + "/"),
    [path],
  );

  const tSafe = useCallback(
    (k: string, fallback: string) => {
      const v = t(k as never);
      return v === k ? fallback : v;
    },
    [t],
  );

  // ── Nav item renderers ───────────────────────────────────────────────────

  function renderNavItem(n: NavItem) {
    if (n.kind === "button") {
      // Notification trigger button styled as a nav item
      return (
        <button
          key={n.key}
          onClick={() => { setNotifOpen(true); setMobileOpen(false); }}
          className="group relative flex w-full items-center gap-3 rounded-lg px-3 py-[7px] text-[13px] text-muted-foreground transition-all duration-150 hover:bg-sidebar-accent/40 hover:text-foreground"
        >
          <n.icon
            className="h-[15px] w-[15px] shrink-0 text-muted-foreground/80 transition-colors group-hover:text-foreground"
            strokeWidth={1.75}
          />
          <span className="truncate">{t(n.key as never)}</span>
        </button>
      );
    }

    // Regular link
    const active = isActive(n.to);
    return (
      <Link
        key={n.to}
        to={n.to}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "group relative flex items-center gap-3 rounded-full px-3 py-[7px] text-[13px] transition-all duration-150",
          active
            ? "bg-sidebar-accent text-foreground shadow-sm"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        <n.icon
          className={cn(
            "h-[15px] w-[15px] shrink-0 transition-colors",
            active
              ? "text-foreground"
              : "text-muted-foreground/80 group-hover:text-foreground",
          )}
          strokeWidth={1.75}
        />
        <span className="truncate">{t(n.key as never)}</span>
      </Link>
    );
  }

  // ── Sidebar content ──────────────────────────────────────────────────────

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="px-4 pt-5 pb-4">
        <Link to="/my-workspace" className="flex items-center gap-3 rounded-lg px-1 py-1 transition-opacity hover:opacity-80">
          <img
            src={phcLogo.url}
            alt="PHC Wayfinding Signs"
            className="h-7 min-w-0 flex-1 object-contain object-left brightness-0"
          />
        </Link>
      </div>

      <div className="mx-4 h-px bg-border/55" />

      {/* Search trigger */}
      <div className="px-3 pt-3 pb-1">
        <button
          onClick={() => { setPaletteOpen(true); setMobileOpen(false); }}
          className="flex w-full items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[12px] text-muted-foreground/80 shadow-card transition-all duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={t("cmd_placeholder")}
        >
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1 truncate">{t("cmd_placeholder")}</span>
          <kbd className="hidden select-none rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-muted-foreground/60 sm:inline">
            {typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main navigation">

        {/* Pinned records */}
        {pinned.length > 0 && (
          <div className="mb-4">
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
              {t("cmd_pinned")}
            </div>
            <div className="flex flex-col gap-0.5">
              {pinned.map((r) => {
                const Icon = RECORD_TYPE_ICONS[r.type] ?? Pin;
                return (
                  <Link
                    key={r.id}
                    to={r.to as never}
                    onClick={() => setMobileOpen(false)}
                    className="group flex items-center gap-3 rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                  >
                    <Icon className="h-[14px] w-[14px] shrink-0 text-muted-foreground/50" strokeWidth={1.75} aria-hidden="true" />
                    <span className="truncate">{r.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent records */}
        {recent.length > 0 && (
          <div className="mb-4">
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
              {t("cmd_recent")}
            </div>
            <div className="flex flex-col gap-0.5">
              {recent.slice(0, 3).map((r) => {
                const Icon = RECORD_TYPE_ICONS[r.type] ?? Clock;
                return (
                  <Link
                    key={r.to}
                    to={r.to as never}
                    onClick={() => setMobileOpen(false)}
                    className="group flex items-center gap-3 rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                  >
                    <Icon className="h-[14px] w-[14px] shrink-0 text-muted-foreground/50" strokeWidth={1.75} aria-hidden="true" />
                    <span className="truncate">{r.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Divider if recent/pinned present */}
        {(pinned.length > 0 || recent.length > 0) && (
          <div className="mx-3 mb-4 h-px bg-border/50" />
        )}

        {/* Main nav groups */}
        {NAV_GROUPS.map((g) => {
          const visibleItems = g.items.filter(
            (n) => !(n.kind === "link" && n.requireAdmin) || canAdmin,
          );
          if (visibleItems.length === 0) return null;

          if (g.collapsible) {
            return (
              <Collapsible
                key={g.key}
                open={adminOpen}
                onOpenChange={setAdminOpen}
                className="mb-5 last:mb-0"
              >
                <CollapsibleTrigger asChild>
                  <button className="flex w-full items-center gap-1 px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80 hover:text-muted-foreground">
                    <span className="flex-1 text-left">{tSafe(g.key, g.fallback)}</span>
                    <ChevronDown
                      className={cn("h-3 w-3 transition-transform", adminOpen && "rotate-180")}
                      aria-hidden="true"
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-col gap-0.5">
                    {visibleItems.map(renderNavItem)}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          }

          return (
            <div key={g.key} className="mb-5 last:mb-0">
              <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                {tSafe(g.key, g.fallback)}
              </div>
              <div className="flex flex-col gap-0.5">
                {visibleItems.map(renderNavItem)}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer identity */}
      <div className="border-t border-border/60 px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent/30">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-structural/60 text-[11px] font-semibold text-foreground ring-1 ring-border/60">
            {(user?.email ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-foreground leading-tight">
              {user?.email ?? ""}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              {topRole ? t(`role_${topRole}` as never) : "—"}
            </div>
          </div>
          <button
            onClick={async () => {
              await signOut();
              nav_({ to: "/auth", search: { next: "" } });
            }}
            aria-label={t("sign_out")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  // ── Layout ─────────────────────────────────────────────────────────────

  return (
    <div dir={dir} className="min-h-screen bg-background text-foreground">
      {/* Skip-to-main-content (WCAG 2.4.1) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-md focus:border focus:border-border focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-foreground focus:shadow-lg"
      >
        {lang === "ar" ? "تخطى إلى المحتوى الرئيسي" : "Skip to main content"}
      </a>

      {/* Sidebar — desktop */}
      <aside
        className={cn(
          "fixed inset-y-0 z-40 hidden w-[15.5rem] bg-sidebar md:block",
          dir === "rtl"
            ? "right-0 border-l border-sidebar-border"
            : "left-0 border-r border-sidebar-border",
        )}
      >
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            className={cn(
              "absolute inset-y-0 w-[min(18rem,85vw)] bg-sidebar",
              dir === "rtl"
                ? "right-0 border-l border-sidebar-border"
                : "left-0 border-r border-sidebar-border",
            )}
          >
            {sidebar}
          </div>
        </div>
      )}

      {/* Main column */}
      <div className={cn("flex min-h-screen flex-col", dir === "rtl" ? "md:mr-[15.5rem]" : "md:ml-[15.5rem]")}>
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-2xl backdrop-saturate-150">
          <div className="flex h-12 items-center gap-3 px-4 md:px-8">
            {/* Mobile hamburger */}
            <button
              className="grid h-9 w-9 place-items-center rounded-full border border-border bg-surface shadow-card text-muted-foreground transition-all duration-150 hover:border-border hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={lang === "ar" ? "فتح القائمة" : "Open navigation"}
            >
              <Menu className="h-4 w-4" />
            </button>

            {/* Desktop status */}
            <div className="hidden items-center gap-3 md:flex">
              <StatusPill tone="positive">● {t("agent_status_running")}</StatusPill>
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("last_refreshed")}
                <span className="ms-2 normal-case tracking-normal text-foreground/70">
                  {new Date().toLocaleTimeString(
                    lang === "ar" ? "ar-SA" : "en-US",
                    { hour: "2-digit", minute: "2-digit" },
                  )}
                </span>
              </span>
            </div>

            {/* Right actions */}
            <div className="ms-auto flex items-center gap-2">
              <FontSizeControl />

              {/* Language toggle */}
              <button
                onClick={() => setLang(lang === "en" ? "ar" : "en")}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface shadow-card px-2.5 text-[11px] font-medium text-muted-foreground transition-all duration-150 hover:border-border hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={t("language")}
              >
                <Globe className="h-3.5 w-3.5" />
                {lang === "en" ? "AR" : "EN"}
              </button>

              {/* Quick Actions "+" */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface shadow-card text-muted-foreground transition-all duration-150 hover:border-border hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={t("nav_quick_actions")}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {t("nav_quick_actions")}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => nav_({ to: "/my-workspace" })}>
                    <Activity className="h-3.5 w-3.5" />
                    {t("qa_log_activity")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => nav_({ to: "/lead-tender-inbox" })}>
                    <Mailbox className="h-3.5 w-3.5" />
                    {t("qa_new_lead")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => nav_({ to: "/follow-ups" })}>
                    <CalendarClock className="h-3.5 w-3.5" />
                    {t("qa_new_follow_up")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => nav_({ to: "/opportunities", search: { q: "", stage: "all", tier: "all", view: "cards" } })}>
                    <FolderKanban className="h-3.5 w-3.5" />
                    {t("qa_new_opportunity")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Notification bell */}
              <button
                className="relative grid h-8 w-8 place-items-center rounded-full border border-border bg-surface shadow-card text-muted-foreground transition-all duration-150 hover:border-border hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => setNotifOpen(true)}
                aria-label={`${t("notif_title")}${notifCount > 0 ? ` (${notifCount})` : ""}`}
              >
                <Bell className="h-3.5 w-3.5" />
                {notifCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-amber"
                  />
                )}
              </button>
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 md:px-10 md:py-10">
          {children}
        </main>
      </div>

      {/* Global overlays — mounted once at shell level */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <NotificationCenter open={notifOpen} onOpenChange={setNotifOpen} />
    </div>
  );
}
