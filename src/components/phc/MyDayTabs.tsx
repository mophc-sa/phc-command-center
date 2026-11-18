// Image 27 (Omar's CRM review): My Day is four tabs — Tasks, Calendar,
// Meetings, Approvals. Each tab is its existing page; this bar ties them together.
import { Link, useLocation } from "@tanstack/react-router";
import { CalendarDays, CheckSquare, ClipboardCheck, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const TABS = [
  { to: "/my-workspace", en: "Tasks", ar: "المهام", Icon: CheckSquare },
  { to: "/calendar", en: "Calendar", ar: "التقويم", Icon: CalendarDays },
  { to: "/meetings", en: "Meetings", ar: "الاجتماعات", Icon: Users },
  { to: "/approvals", en: "Approvals", ar: "الموافقات", Icon: ClipboardCheck },
] as const;

export function MyDayTabs() {
  const { lang } = useI18n();
  const path = useLocation({ select: (l) => l.pathname });
  return (
    <nav aria-label={lang === "ar" ? "يومي" : "My Day"} className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map(({ to, en, ar, Icon }) => {
        const on = path === to || path.startsWith(`${to}/`);
        return (
          <Link
            key={to}
            to={to}
            aria-current={on ? "page" : undefined}
            className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold ${on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {lang === "ar" ? ar : en}
          </Link>
        );
      })}
    </nav>
  );
}
