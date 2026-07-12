import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { usePinnedRecords, type PinnedRecord } from "@/hooks/usePinnedRecords";
import { useRecentRecords, type RecentRecord } from "@/hooks/useRecentRecords";
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
  Users2,
  Settings,
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
  { to: "/rfq-jih",           labelEn: "RFQ & Bids",          labelAr: "لوحة RFQ والفرص القائمة",       group: "Pipeline",  icon: ClipboardCheck },
  { to: "/tenders",           labelEn: "Tenders",             labelAr: "المناقصات",                     group: "Pipeline",  icon: Gavel },
  { to: "/approvals",         labelEn: "Approvals",           labelAr: "الاعتمادات",                    group: "Execution", icon: ShieldCheck },
  { to: "/follow-ups",        labelEn: "Follow-ups",          labelAr: "المتابعات",                     group: "Execution", icon: CalendarClock },
  { to: "/quotations",        labelEn: "Quotations",          labelAr: "عروض الأسعار",                  group: "Execution", icon: FileText },
  { to: "/boq",               labelEn: "BOQ Center",          labelAr: "مركز الـ BOQ",                  group: "Execution", icon: ClipboardList },
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
  { to: "/team",              labelEn: "Team & Permissions",  labelAr: "الفريق والصلاحيات",             group: "Admin",     icon: Users2 },
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

type SearchResult = {
  id: string;
  type: "opportunity" | "account" | "project";
  label: string;
  sub?: string;
  to: string;
};

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

  // Debounced Supabase search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const q = query.trim();
      const [companies, opps, projects] = await Promise.allSettled([
        supabase.from("companies").select("id, name").ilike("name", `%${q}%`).limit(4),
        supabase.from("opportunities").select("id, project_name").ilike("project_name", `%${q}%`).limit(4),
        supabase.from("projects").select("id, name").ilike("name", `%${q}%`).limit(3),
      ]);
      const hits: SearchResult[] = [
        ...(companies.status === "fulfilled" ? companies.value.data ?? [] : []).map(
          (r) => ({ id: r.id, type: "account" as const, label: r.name, to: `/accounts/${r.id}` }),
        ),
        ...(opps.status === "fulfilled" ? opps.value.data ?? [] : []).map(
          (r) => ({ id: r.id, type: "opportunity" as const, label: r.project_name, to: `/opportunities/${r.id}` }),
        ),
        ...(projects.status === "fulfilled" ? projects.value.data ?? [] : []).map(
          (r) => ({ id: r.id, type: "project" as const, label: r.name, to: `/projects/${r.id}` }),
        ),
      ];
      setResults(hits);
      setSearching(false);
    }, 220);
    return () => { clearTimeout(timer); };
  }, [query]);

  // Client-side page filter
  const filteredPages = useMemo(() => {
    if (!query.trim()) return PAGES;
    const q = query.trim().toLowerCase();
    return PAGES.filter(
      (p) =>
        p.labelEn.toLowerCase().includes(q) ||
        p.labelAr.includes(q) ||
        p.group.toLowerCase().includes(q),
    );
  }, [query]);

  const go = useCallback(
    (to: string) => {
      onOpenChange(false);
      void navigate({ to: to as never });
    },
    [navigate, onOpenChange],
  );

  const showPinned = pinned.length > 0 && !query.trim();
  const showRecent = recent.length > 0 && !query.trim();
  const showResults = results.length > 0 && query.trim().length >= 2;
  const isEmpty = !searching && query.trim().length >= 2 && results.length === 0 && filteredPages.length === 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
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
                  <CommandItem key={r.id} value={`result-${r.id}`} onSelect={() => go(r.to)}>
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
