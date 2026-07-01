import { createFileRoute } from "@tanstack/react-router";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — PHC" }, { name: "robots", content: "noindex" }] }),
  component: () => {
    const { t, lang, setLang } = useI18n();
    return (
      <div className="mx-auto max-w-3xl">
        <SectionHeader title={t("nav_settings")} />
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="text-sm font-medium text-foreground">{t("language")}</div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setLang("en")}
              className={`rounded-md border px-3 py-1.5 text-sm ${lang === "en" ? "border-amber/50 bg-amber/10 text-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground"}`}
            >
              {t("english")}
            </button>
            <button
              onClick={() => setLang("ar")}
              className={`rounded-md border px-3 py-1.5 text-sm ${lang === "ar" ? "border-amber/50 bg-amber/10 text-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground"}`}
            >
              {t("arabic")}
            </button>
          </div>
        </div>
      </div>
    );
  },
});
