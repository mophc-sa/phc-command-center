import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authErrorMessage } from "@/lib/auth-error-messages";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

const phcLogo = { url: "/phc-logo.png" };

// Enrolls a fresh unverified TOTP factor, self-healing against the "a
// factor with this friendly name already exists" conflict that a second
// concurrent enroll() call produces — which happens routinely in dev
// (React re-invokes effects with side effects once as a bug-detection
// measure) and, defensively, under any other legitimate double-call.
// Each attempt re-lists factors and clears any unverified one before
// enrolling, so whichever call loses the race simply cleans up after the
// winner and retries once more.
async function enrollTotpFactor() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: existing } = await supabase.auth.mfa.listFactors();
    const stale = existing?.all?.find((f) => f.factor_type === "totp" && f.status === "unverified");
    if (stale) await supabase.auth.mfa.unenroll({ factorId: stale.id });

    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (!error) return data;
    if (attempt === 2 || !/already exists/i.test(error.message)) throw error;
  }
  throw new Error("Could not enroll a TOTP factor after retrying.");
}

export const Route = createFileRoute("/mfa-setup")({
  head: () => ({
    meta: [
      { title: "Set up two-factor authentication — PHC Command Center" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MfaSetupPage,
});

function MfaSetupPage() {
  const { user, loading } = useAuth();
  const { lang, setLang, dir } = useI18n();
  const nav = useNavigate();

  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
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
    if (!user?.id) return;
    let cancelled = false;

    async function prepare() {
      setPreparing(true);
      setPrepError(null);
      try {
        const data = await enrollTotpFactor();
        if (cancelled) return;
        setFactorId(data.id);
        setQrCode(data.totp.qr_code);
        setSecret(data.totp.secret);
      } catch (err: unknown) {
        if (!cancelled) setPrepError(authErrorMessage(err, lang));
      } finally {
        if (!cancelled) setPreparing(false);
      }
    }
    void prepare();
    return () => { cancelled = true; };
  }, [user?.id]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setVerifying(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw error;
      toast.success(lang === "ar" ? "تم تفعيل التحقق بخطوتين" : "Two-factor authentication enabled");
      nav({ to: "/", replace: true });
    } catch (err: unknown) {
      const msg = authErrorMessage(err, lang);
      toast.error(msg);
    } finally {
      setVerifying(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    nav({ to: "/auth", search: { next: "" } as never, replace: true });
  }

  if (loading) {
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
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber/30 bg-amber/10">
              <ShieldCheck className="h-6 w-6 text-amber-light" />
            </div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
              {lang === "ar" ? "مطلوب تفعيل التحقق بخطوتين" : "Two-factor authentication required"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {lang === "ar"
                ? "دورك في النظام يتطلب حماية إضافية. امسح رمز QR بتطبيق مصادقة (مثل Google Authenticator) ثم أدخل الرمز المكوّن من 6 أرقام."
                : "Your role requires extra protection. Scan the QR code with an authenticator app (e.g. Google Authenticator), then enter the 6-digit code."}
            </p>
          </div>

          {preparing ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : prepError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/[0.07] px-4 py-3 text-center text-sm text-destructive/90">
              {prepError}
            </div>
          ) : (
            <>
              {qrCode ? (
                <div className="flex justify-center rounded-lg border border-border bg-white p-4">
                  {/* GoTrue returns the QR code as raw SVG XML, not a data URI. */}
                  <img
                    src={qrCode.startsWith("data:") ? qrCode : `data:image/svg+xml;utf8,${encodeURIComponent(qrCode)}`}
                    alt="TOTP QR code"
                    className="h-40 w-40"
                  />
                </div>
              ) : null}
              {secret ? (
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-center font-mono text-xs text-muted-foreground">
                  {secret}
                </div>
              ) : null}

              <form onSubmit={handleVerify} className="space-y-3.5">
                <label className="block">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {lang === "ar" ? "رمز التحقق" : "Verification code"}
                  </span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-center text-lg tracking-[0.3em] text-foreground outline-none transition-colors focus:border-amber/60 focus:ring-1 focus:ring-amber/40"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                </label>
                <button
                  disabled={verifying || code.length !== 6}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {lang === "ar" ? "تفعيل" : "Enable"}
                </button>
              </form>
            </>
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
