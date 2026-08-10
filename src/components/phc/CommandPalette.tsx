import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { usePinnedRecords, type PinnedRecord } from "@/hooks/usePinnedRecords";
import { useRecentRecords, type RecentRecord } from "@/hooks/useRecentRecords";
import {
  buildSearchResults,
  filterPages,
  isCommandEmpty,
  MIN_QUERY_LENGTH,
  type SearchResult,
} from "@/lib/command-search";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  FolderKanban,
  CalendarClock,
  Inbox,
  ShieldCheck,
  LineChart,
  Activity,
  Settings,
  ShieldAlert,
  FileText,
  Target,
  Building2,
  Contact2,
  Landmark,
  Briefcase,
  Truck,
  Library,
  Bot,
  BookOpen,
  Gavel,
  GitMerge,
  Award,
  BellRing,
  DatabaseZap,
  Mailbox,
  Pin,
  Clock,
  type LucideIcon,
} from "lucide-react";

// ── Static page catalog ────────────────────────────────────────────────────

type PageEntry = { to: string; labelEn: string; labelAr: string; group: string; icon: LucideIcon };

const PAGES: PageEntry[] = [
  { to: "/my-workspace",      labelEn: "My Day",              labelAr: "يومي",                          group: "Workspace", icon: Briefcase },
  { to: "/action-center",     labelEn: "Action Queue",        labelAr: "قائمة الإجراءات",               group: "Workspace", icon: BellRing },
  { to: "/command-center",    labelEn: "Pipeline Overview",   labelAr: "نظرة خط المبيعات",              group: "Pipeline",  icon: LayoutDashboard },
  { to: "/lead-tender-inbox", labelEn: "Intake",              labelAr: "الاستقبال",                     group: "Pipeline",  icon: Mailbox },
  { to: "/opportunities",     labelEn: "Opportunities",       labelAr: "الفرص",                         group: "Pipeline",  icon: FolderKanban },
  { to: "/tenders",           labelEn: "Tenders",             labelAr: "المناقصات",                     group: "Pipeline",  icon: Gavel },
  { to: "/approvals",         labelEn: "Approvals",           labelAr: "الاعتمادات",                    group: "Execution", icon: ShieldCheck },
  { to: "/follow-ups",        labelEn: "Follow-ups",          labelAr: "المتابعات",                     group: "Execution", icon: CalendarClock },
  { to: "/quotations",        labelEn: "Quotations, RFQ & JIH, BOQ", labelAr: "عروض الأسعار وRFQ وJIH وBOQ", group: "Execution", icon: FileText },
  { to: "/award-queue",       labelEn: "Awards",              labelAr: "الترسيات",                      group: "Execution", icon: Award },
  { to: "/tender-conversion", labelEn: "Conversion Queue",    labelAr: "طابور التحويل",                 group: "Execution", icon: GitMerge },
  { to: "/accounts",          labelEn: "Accounts",            labelAr: "الحسابات",                      group: "CRM",       icon: Building2 },
  { to: "/contacts",          labelEn: "Contacts",            labelAr: "جهات الاتصال",                  group: "CRM",       icon: Contact2 },
  { to: "/projects",          labelEn: "Projects",            labelAr: "المشاريع",                      group: "CRM",       icon: Landmark },
  { to: "/reports",           labelEn: "Reports",             labelAr: "التقارير",                      group: "Reports",   icon: LineChart },
  { to: "/targets",           labelEn: "Targets",             labelAr: "الأهداف والأداء",               group: "Reports",   icon: Target },
  { to: "/knowledge",         labelEn: "Knowledge Search",    labelAr: "البحث المعرفي",                 group: "Resources", icon: BookOpen },
  { to: "/reference-library", labelEn: "Reference Library",   labelAr: "مكتبة المراجع",                 group: "Resources", icon: Library },
  { to: "/vendors",           labelEn: "Vendors",             labelAr: "الموردون",                      group: "Resources", icon: Truck },
  { to: "/discovery",         labelEn: "Project Radar",       labelAr: "رادار المشاريع",                group: "Resources", icon: Inbox },
  { to: "/ai-agents",         labelEn: "AI Agents",           labelAr: "وكلاء الذكاء",                  group: "Admin",     icon: Bot },
  { to: "/agent-activity",    labelEn: "Agent Activity",      labelAr: "نشاط الوكيل",                   group: "Admin",     icon: Activity },
  { to: "/data-import",       labelEn: "Data Import",         labelAr: "استيراد البيانات",              group: "Admin",     icon: DatabaseZap },
  { to: "/admin-settings",    labelEn: "Admin Settings",      labelAr: "إعدادات المسؤول",               group: "Admin",     icon: ShieldAlert },
  { to: "/settings",          labelEn: "Settings",            labelAr: "الإعدادات",                     group: "Admin",     icon: Settings },
];

// ── Record type icons ──────────────────────────────────────────────────────

export const RECORD_TYPE_ICONS: Record<string, LucideIcon> = {
  opportunity: FolderKanban,
  account:     Building2,
  contact:     Contact2,
  project:     Landmark,
  tender:      Gavel,
};

// ── Search result type ──────────────────────────────────────────────────────
// Shape and mapping live in @/lib/command-search so they can be unit-tested
// without a DOM. See the note there about the cmdk UUID-filtering bug.

// ── Component ──────────────────────────────────────────────────────────────

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { pinned } = usePinnedRecords();
  const { recent } = useRecentRecords();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Reset query when closed
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Debounced Supabase search. A stale-response guard keeps a slow request for
  // an earlier query from overwriting the results of a later one.
  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const q = query.trim();
      const [companies, opps, projects, contacts] = await Promise.allSettled([
        supabase.from("companies").select("id, name").ilike("name", `%${q}%`).limit(4),
        supabase.from("opportunities").select("id, project_name").ilike("project_name", `%${q}%`).limit(4),
        supabase.from("projects").select("id, name").ilike("name", `%${q}%`).limit(3),
        supabase.from("contacts").select("id, name, title").ilike("name", `%${q}%`).limit(3),
      ]);
      if (cancelled) return;
      setResults(
        buildSearchResults({
          companies: companies.status === "fulfilled" ? companies.value.data : null,
          opportunities: opps.status === "fulfilled" ? opps.value.data : null,
          projects: projects.status === "fulfilled" ? projects.value.data : null,
          contacts: contacts.status === "fulfilled" ? contacts.value.data : null,
        }),
      );
      setSearching(false);
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Client-side page filter. cmdk's own filter is disabled below, so this is
  // the only thing narrowing the page list.
  const filteredPages = useMemo(() => filterPages(PAGES, query), [query]);

  const go = useCallback(
    (to: string) => {
      onOpenChange(false);
      void navigate({ to: to as never });
    },
    [navigate, onOpenChange],
  );

  const showPinned = pinned.length > 0 && !query.trim();
  const showRecent = recent.length > 0 && !query.trim();
  const showResults = results.length > 0 && query.trim().length >= MIN_QUERY_LENGTH;
  const isEmpty = isCommandEmpty({
    searching,
    query,
    resultCount: results.length,
    pageCount: filteredPages.length,
  });

  return (
    // shouldFilter={false}: records are filtered server-side and pages by
    // filterPages(). Leaving cmdk's client-side filter on made it re-score
    // every item against the query and hide real matches (QA ISSUE-001).
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput
        placeholder={t("cmd_placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[420px]">
        {isEmpty && (
          <CommandEmpty>{t("cmd_no_results")}</CommandEmpty>
        )}

        {/* Pinned records */}
        {showPinned && (
          <>
            <CommandGroup heading={t("cmd_pinned")}>
              {pinned.map((r: PinnedRecord) => {
                const Icon = RECORD_TYPE_ICONS[r.type] ?? Pin;
                return (
                  <CommandItem key={r.id} value={`pinned-${r.id}`} onSelect={() => go(r.to)}>
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span>{r.label}</span>
                    <span className="ms-auto text-xs text-muted-foreground capitalize">{r.type}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Recent records */}
        {showRecent && (
          <>
            <CommandGroup heading={t("cmd_recent")}>
              {recent.map((r: RecentRecord) => {
                const Icon = RECORD_TYPE_ICONS[r.type] ?? Clock;
                return (
                  <CommandItem key={r.to} value={`recent-${r.to}`} onSelect={() => go(r.to)}>
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span>{r.label}</span>
                    <span className="ms-auto text-xs text-muted-foreground capitalize">{r.type}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Record search results */}
        {showResults && (
          <>
            <CommandGroup heading={t("cmd_records")}>
              {results.map((r) => {
                const Icon = RECORD_TYPE_ICONS[r.type] ?? Building2;
                return (
                  <CommandItem key={`${r.type}-${r.id}`} value={r.searchValue} onSelect={() => go(r.to)}>
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{r.label}</span>
                    {r.sub && (
                      <span className="truncate text-xs text-muted-foreground">{r.sub}</span>
                    )}
                    <span className="ms-auto shrink-0 text-xs text-muted-foreground capitalize">{r.type}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Pages */}
        {filteredPages.length > 0 && (
          <CommandGroup heading={t("cmd_pages")}>
            {filteredPages.map((p) => {
              const Icon = p.icon;
              const label = lang === "ar" ? p.labelAr : p.labelEn;
              return (
                <CommandItem key={p.to} value={`page-${p.labelEn}`} onSelect={() => go(p.to)}>
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span>{label}</span>
                  <span className="ms-auto text-xs text-muted-foreground">{p.group}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Searching indicator */}
        {searching && (
          <div className="flex items-center justify-center py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
