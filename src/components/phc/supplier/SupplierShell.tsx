import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { pick, type Bi } from "@/lib/pricing-text";

const TEXT = {
  portal: { en: "Supplier portal", ar: "بوابة الموردين" },
  signOut: { en: "Sign out", ar: "تسجيل الخروج" },
} satisfies Record<string, Bi>;

/** The supplier's whole frame: no staff navigation, no search, no notifications. */
export function SupplierShell({ children }: { children: ReactNode }) {
  const { lang, setLang, dir } = useI18n();
  const { signOut } = useAuth();
  return (
    <div dir={dir} className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <Link to="/supplier" className="flex items-center gap-3">
          <img src="/phc-logo.png" alt="PHC" className="h-7 w-auto object-contain brightness-0 dark:brightness-100" />
          <span className="text-sm font-medium text-muted-foreground">{pick(TEXT.portal, lang)}</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {lang === "en" ? "AR" : "EN"}
          </button>
          <button
            onClick={() => void signOut()}
            className="flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            {pick(TEXT.signOut, lang)}
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
