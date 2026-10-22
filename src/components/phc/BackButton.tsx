import { useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * "A Back button on every page that returns to the last place you were"
 * (manager feedback, 2026-10-19). Lives in the shell's top bar, so every
 * signed-in page has it in the same spot.
 *
 * It walks the app's own history rather than the browser's: a page opened
 * from a link or a new tab has nowhere earlier inside the system to go back
 * to, and leaving the app would be the wrong answer, so it lands on home.
 */
export function BackButton() {
  const { t, dir } = useI18n();
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });

  if (path === "/") return null;

  const goBack = () => {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: "/" });
  };

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground shadow-card transition-all duration-150 hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      aria-label={t("back")}
      title={t("back")}
    >
      <ArrowLeft className={dir === "rtl" ? "h-3.5 w-3.5 rotate-180" : "h-3.5 w-3.5"} />
      <span className="hidden sm:inline">{t("back")}</span>
    </button>
  );
}
