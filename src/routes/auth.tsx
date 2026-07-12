import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2, Clock } from "lucide-react";
const phcLogo = { url: "/phc-logo.png" };


export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//") ? s.next : "",
  }),
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
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup" | "pending">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      if (next) {
        window.location.replace(next);
      } else {
        nav({ to: "/command-center", replace: true });
      }
    }
  }, [loading, user, nav, next]);


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
            emailRedirectTo: next ? `${window.location.origin}${next}` : `${window.location.origin}/command-center`,
          },
        });
        if (error) throw error;
        // Show pending-approval holding state — do NOT redirect into the app.
        setMode("pending");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("error_generic");
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  // Post-signup holding screen — account created, awaiting admin approval.
  if (mode === "pending") {
    return (
      <div dir={dir} className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-6 text-foreground">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/30 bg-amber/10">
          <Clock className="h-6 w-6 text-amber-light" />
        </div>
        <div className="max-w-sm space-y-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            {lang === "ar" ? "طلبك قيد المراجعة" : "Account pending approval"}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {lang === "ar"
              ? "تم إنشاء حسابك بنجاح. سيقوم المسؤول بتفعيله قريبًا — ستتمكن من تسجيل الدخول بعد الموافقة."
              : "Your account has been created. An administrator will activate it shortly — you'll be able to sign in once approved."}
          </p>
        </div>
        <button
          onClick={() => setMode("signin")}
          className="rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {lang === "ar" ? "العودة لتسجيل الدخول" : "Back to sign in"}
        </button>
      </div>
    );
  }

  return (
    <div dir={dir} className="grid min-h-dvh bg-background text-foreground md:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden border-border bg-sidebar md:block md:border-e">
        {/* subtle brand wash — amber signal, tokenised */}
        <div
          className="absolute inset-0 opacity-90"
          style={{
            backgroundImage:
              "radial-gradient(1200px 600px at 20% 10%, color-mix(in oklch, var(--color-amber) 14%, transparent), transparent 60%), linear-gradient(180deg, var(--color-sidebar) 0%, var(--color-background) 100%)",
          }}
        />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber/30 to-transparent" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div>
            <img
              src={phcLogo.url}
              alt="PHC"
              className="h-8 w-auto object-contain object-start"
            />
            <div className="mt-6 text-[10px] font-semibold uppercase tracking-[var(--tracking-caps)] text-muted-foreground">
              {lang === "ar" ? "بي إتش سي · مركز القيادة" : "PHC · Command Center"}
            </div>
            <h2 className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-tight text-foreground">
              {lang === "ar" ? (
                <>
                  هندسة صامتة،
                  <br />
                  وضوح تشغيلي.
                </>
              ) : (
                <>
                  Silent architecture,
                  <br />
                  operational clarity.
                </>
              )}
            </h2>
          </div>
          <div className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {lang === "ar"
              ? "مركز القيادة الداخلي لإدارة فرص المبيعات، المتابعات، الاعتمادات، والأدلة، بلغة عربية وإنجليزية."
              : "The internal command center for pipeline decisions, follow-ups, approvals, and evidence — in Arabic and English."}
          </div>
          <div className="text-[10px] uppercase tracking-[var(--tracking-caps)] text-muted-foreground/70">
            {lang === "ar" ? "لافتات · إرشاد · تصنيع" : "Wayfinding · Signs · Fabrication"}
          </div>
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <img src={phcLogo.url} alt="PHC" className="mb-4 h-7 w-auto object-contain object-start md:hidden" />
              <div className="text-[10px] font-semibold uppercase tracking-[var(--tracking-caps)] text-muted-foreground">PHC</div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{t("sign_in_title")}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">{t("sign_in_sub")}</p>
            </div>
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="shrink-0 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("language")}
            >
              {lang === "en" ? "AR" : "EN"}
            </button>
          </div>


          <form onSubmit={submit} className="space-y-3.5">
            {mode === "signup" ? (
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("full_name")}</span>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-amber/60 focus:ring-1 focus:ring-amber/40"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </label>
            ) : null}
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("email")}</span>
              <input
                type="email"
                autoComplete="email"
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-amber/60 focus:ring-1 focus:ring-amber/40"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("password")}</span>
              <input
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-amber/60 focus:ring-1 focus:ring-amber/40"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>
            <button
              disabled={busy}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "signin" ? t("sign_in") : t("create_account")}
            </button>
          </form>

          <button
            className="mt-5 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? t("no_account") : t("have_account")}
          </button>
        </div>
      </div>
    </div>
  );
}

