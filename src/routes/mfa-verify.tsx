import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authErrorMessage } from "@/lib/auth-error-messages";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

const phcLogo = { url: "/phc-logo.png" };

export const Route = createFileRoute("/mfa-verify")({
  head: () => ({
    meta: [
      { title: "Verify two-factor code — PHC Command Center" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MfaVerifyPage,
});

function MfaVerifyPage() {
  const { user, loading } = useAuth();
  const { lang, setLang, dir } = useI18n();
  const nav = useNavigate();

  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [preparing, setPreparing] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      nav({ to: "/auth", search: { next: "" } as never, replace: true });
    }
  }, [loading, user, nav]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function prepare() {
      setPreparing(true);
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;
        const verified = data?.totp?.find((f) => f.status === "verified");
        if (cancelled) return;
        if (!verified) {
          // No verified factor at all — this account still needs enrollment.
          nav({ to: "/mfa-setup", replace: true });
          return;
        }
        setFactorId(verified.id);
      } catch (err: unknown) {
        if (!cancelled) setPrepError(authErrorMessage(err, lang));
      } finally {
        if (!cancelled) setPreparing(false);
      }
    }
    void prepare();
    return () => { cancelled = true; };
  }, [user, nav]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setVerifying(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw error;
      nav({ to: "/", replace: true });
    } catch (err: unknown) {
      const msg = authErrorMessage(err, lang);
      toast.error(msg);
      setCode("");
    } finally {
      setVerifying(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    nav({ to: "/auth", search: { next: "" } as never, replace: true });
  }

  if (loading || preparing) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div dir={dir} className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <img src={phcLogo.url} alt="PHC" className="h-7 w-auto object-contain brightness-0" />
        <button
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {lang === "en" ? "AR" : "EN"}
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber/30 bg-amber/10">
            <ShieldCheck className="h-6 w-6 text-amber-light" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {lang === "ar" ? "أدخل رمز التحقق" : "Enter your verification code"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {lang === "ar"
                ? "افتح تطبيق المصادقة على هاتفك وأدخل الرمز المكوّن من 6 أرقام."
                : "Open your authenticator app and enter the 6-digit code."}
            </p>
          </div>

          {prepError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/[0.07] px-4 py-3 text-sm text-destructive/90">
              {prepError}
            </div>
          ) : (
            <form onSubmit={handleVerify} className="space-y-3.5 text-start">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
                className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-center text-lg tracking-[0.3em] text-foreground outline-none transition-colors focus:border-amber/60 focus:ring-1 focus:ring-amber/40"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
              <button
                disabled={verifying || code.length !== 6}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {lang === "ar" ? "تحقق" : "Verify"}
              </button>
            </form>
          )}

          <button
            onClick={handleSignOut}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {lang === "ar" ? "تسجيل الخروج" : "Sign out"}
          </button>
        </div>
      </main>
    </div>
  );
}
