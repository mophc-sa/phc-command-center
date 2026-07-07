import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/phc/PageHeader";
import { useI18n } from "@/lib/i18n";
import { Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — PHC" }, { name: "robots", content: "noindex" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const options: { code: "en" | "ar"; label: string; native: string }[] = [
    { code: "en", label: t("english"), native: "English" },
    { code: "ar", label: t("arabic"), native: "العربية" },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Administration"
        title={t("nav_settings")}
        description="Personal preferences for your PHC workspace."
      />

      <section className="rounded-xl border border-border/70 bg-surface/60">
        <header className="border-b border-border/60 px-5 py-4">
          <div className="text-sm font-medium text-foreground">{t("language")}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Choose the display language for the interface. This does not affect stored data.
          </div>
        </header>
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          {options.map((o) => {
            const active = lang === o.code;
            return (
              <button
                key={o.code}
                onClick={() => setLang(o.code)}
                className={
                  "flex items-center justify-between rounded-lg border px-4 py-3 text-start transition-colors " +
                  (active
                    ? "border-amber/50 bg-amber/10"
                    : "border-border bg-surface hover:border-border-strong/70")
                }
              >
                <div>
                  <div className="text-sm font-medium text-foreground">{o.native}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{o.label}</div>
                </div>
                {active ? <Check className="h-4 w-4 text-amber-light" /> : null}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
