import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — PHC Command Center" },
      { name: "description", content: "Sign in to the PHC internal command center." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { t, lang, setLang, dir } = useI18n();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) nav({ to: "/command-center", replace: true });
  }, [loading, user, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success(lang === "ar" ? "تم تسجيل الدخول" : "Signed in");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${window.location.origin}/command-center`,
          },
        });
        if (error) throw error;
        toast.success(lang === "ar" ? "تم إنشاء الحساب" : "Account created");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("error_generic");
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div dir={dir} className="grid min-h-screen bg-background text-foreground md:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden border-border md:block md:border-e">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_20%_10%,rgba(181,105,43,0.10),transparent_60%),linear-gradient(180deg,#0E0F10_0%,#111111_100%)]" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
              PHC · Wayfinding Signs
            </div>
            <div className="mt-3 text-2xl font-semibold">Silent Architecture, Operational Clarity.</div>
          </div>
          <div className="max-w-md text-sm text-muted-foreground">
            {lang === "ar"
              ? "مركز القيادة الداخلي لإدارة فرص المبيعات، المتابعات، الاعتمادات، والأدلة، بلغة عربية وإنجليزية."
              : "The internal command center for pipeline decisions, follow-ups, approvals, and evidence — in Arabic and English."}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">PHC</div>
              <h1 className="mt-1 text-xl font-semibold">{t("sign_in_title")}</h1>
              <p className="mt-1 text-xs text-muted-foreground">{t("sign_in_sub")}</p>
            </div>
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {lang === "en" ? "AR" : "EN"}
            </button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" ? (
              <label className="block">
                <span className="text-xs text-muted-foreground">{t("full_name")}</span>
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-amber/60"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </label>
            ) : null}
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("email")}</span>
              <input
                type="email"
                autoComplete="email"
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-amber/60"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("password")}</span>
              <input
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-amber/60"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>
            <button
              disabled={busy}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "signin" ? t("sign_in") : t("create_account")}
            </button>
          </form>

          <button
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? t("no_account") : t("have_account")}
          </button>
        </div>
      </div>
    </div>
  );
}
