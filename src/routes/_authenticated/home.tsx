import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, CalendarDays, FileText, Landmark, LayoutDashboard, Target, Users, Wallet, type LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { canSeeCommandCenter } from "@/lib/roles";
import { canSeeCollections } from "@/lib/contract-billing";

// Image 01 (Omar's CRM review, 2026-11-18): one page that opens the six places
// the sales cycle runs on — from first enquiry to signed contract. The other
// departments' areas follow for the people who work in them; nothing here is a
// new page, every card opens one that exists.
export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({ meta: [{ title: "Home — PHC" }, { name: "robots", content: "noindex" }] }),
  component: HomePage,
});

type Card = { to: string; icon: LucideIcon; en: [string, string]; ar: [string, string] };

function HomePage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles } = useAuth();
  const sales: Card[] = [
    canSeeCommandCenter(roles)
      ? { to: "/command-center", icon: LayoutDashboard, en: ["Dashboard", "Key sales performance at a glance"], ar: ["لوحة الإدارة", "أهم مؤشرات المبيعات بنظرة"] }
      : { to: "/sales-management", icon: LayoutDashboard, en: ["Dashboard", "Your performance and the team's"], ar: ["لوحة الأداء", "أداؤك وأداء الفريق"] },
    { to: "/my-workspace", icon: CalendarDays, en: ["My Day", "Today's tasks, calls and follow-ups"], ar: ["يومي", "مهام اليوم والاتصالات والمتابعات"] },
    { to: "/opportunities", icon: Target, en: ["Opportunities", "Track and move deals to a signed contract"], ar: ["الفرص", "تابع الصفقات حتى توقيع العقد"] },
    { to: "/quotations", icon: FileText, en: ["Quotations", "Quotations and their revisions"], ar: ["عروض الأسعار", "العروض وإصداراتها"] },
    { to: "/accounts", icon: Users, en: ["Customers", "Companies and the people at them"], ar: ["العملاء", "الشركات والأشخاص المرتبطون بها"] },
    { to: "/reports", icon: BarChart3, en: ["Reports", "Sales, pipeline and the weekly report"], ar: ["التقارير", "المبيعات وخط الفرص والتقرير الأسبوعي"] },
  ];
  const company: Card[] = [
    { to: "/projects", icon: Landmark, en: ["Projects", "Awarded work in production"], ar: ["المشاريع", "الأعمال المرساة في التنفيذ"] },
    ...(canSeeCollections(roles) ? [{ to: "/collections", icon: Wallet, en: ["Finance", "Billing and collections"], ar: ["المالية", "الفوترة والتحصيل"] } as Card] : []),
  ];
  const tile = (c: Card) => {
    const [title, sub] = ar ? c.ar : c.en;
    return (
      <Link key={c.to} to={c.to as never} className="group flex items-start gap-4 rounded-xl border border-border/70 bg-surface/60 p-5 transition-colors hover:border-primary/50">
        <c.icon className="h-8 w-8 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-lg font-semibold text-foreground">{title}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{sub}</span>
        </span>
      </Link>
    );
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{ar ? "مرحبًا بك في PHC" : "Welcome to PHC"}</h1>
        <p className="mt-1 text-base text-muted-foreground">{ar ? "من أول استفسار حتى توقيع العقد." : "From first enquiry to signed contract."}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{sales.map(tile)}</div>
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{ar ? "أقسام الشركة" : "Company areas"}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{company.map(tile)}</div>
      </div>
    </div>
  );
}
