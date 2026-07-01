import { createFileRoute } from "@tanstack/react-router";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { StatusPill } from "@/components/phc/StatusPill";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [{ title: "Team & Permissions — PHC" }, { name: "robots", content: "noindex" }] }),
  component: () => {
    const { t, lang } = useI18n();
    const { user, roles } = useAuth();
    return (
      <div className="mx-auto max-w-3xl">
        <SectionHeader title={t("nav_team")} />
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {lang === "ar" ? "حسابك" : "Your account"}
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">{user?.email}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {roles.length === 0 ? (
              <StatusPill tone="muted">{lang === "ar" ? "قارئ" : "Viewer"}</StatusPill>
            ) : (
              roles.map((r) => <StatusPill key={r} tone={r === "ceo" || r === "sales_manager" ? "attention" : "neutral"}>{r.replaceAll("_"," ")}</StatusPill>)
            )}
          </div>
        </div>
        <div className="mt-6">
          <EmptyState
            message={t("empty_team")}
            hint={lang === "ar" ? "يمكن للمديرين تعيين الأدوار من صفحة الإعدادات." : "Managers can assign roles from Settings."}
          />
        </div>
      </div>
    );
  },
});
