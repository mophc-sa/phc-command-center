import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { PageHeader } from "@/components/phc/PageHeader";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { requiresMfa } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { Link } from "@tanstack/react-router";

// Verifies a password by signing in on a throwaway, non-persisting client —
// never the shared `supabase` singleton. Reusing the real client for this
// would replace its live session with a fresh AAL1 one from the sign-in
// call, and for an MFA-enrolled user that silently downgrades the session
// below the AAL2 that GoTrue then requires for updateUser({password}),
// making the *real* password change 401 right after a "successful" check.
async function verifyPassword(email: string, password: string): Promise<boolean> {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const probe = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await probe.auth.signInWithPassword({ email, password });
  return !error;
}

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

      <div className="mt-6">
        <SecuritySection lang={lang} />
      </div>
    </div>
  );
}

function SecuritySection({ lang }: { lang: "en" | "ar" }) {
  const { user, roles } = useAuth();
  const mfaMandatory = requiresMfa(roles);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!mfaMandatory) return;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      setMfaEnabled(!!data?.totp?.some((f) => f.status === "verified"));
    });
  }, [mfaMandatory]);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    if (newPassword !== confirmPassword) {
      toast.error(lang === "ar" ? "كلمتا المرور الجديدتان غير متطابقتين" : "New passwords don't match");
      return;
    }
    setBusy(true);
    try {
      // Secure password change: re-verify the current password before
      // accepting a new one — Supabase's updateUser() has no built-in
      // "old password" check, so we confirm it ourselves first.
      const isCurrentPasswordCorrect = await verifyPassword(user.email, currentPassword);
      if (!isCurrentPasswordCorrect) {
        toast.error(lang === "ar" ? "كلمة المرور الحالية غير صحيحة" : "Current password is incorrect");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success(lang === "ar" ? "تم تحديث كلمة المرور" : "Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (lang === "ar" ? "حدث خطأ" : "Something went wrong");
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border/70 bg-surface/60">
      <header className="border-b border-border/60 px-5 py-4">
        <div className="text-sm font-medium text-foreground">
          {lang === "ar" ? "الأمان" : "Security"}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {lang === "ar" ? "كلمة المرور والتحقق بخطوتين." : "Password and two-factor authentication."}
        </div>
      </header>

      <div className="space-y-5 p-5">
        {mfaMandatory ? (
          <div
            className={
              "flex items-center gap-3 rounded-lg border px-4 py-3 " +
              (mfaEnabled ? "border-won/25 bg-won/[0.07]" : "border-destructive/30 bg-destructive/[0.07]")
            }
          >
            {mfaEnabled ? (
              <ShieldCheck className="h-5 w-5 shrink-0 text-won" />
            ) : (
              <ShieldAlert className="h-5 w-5 shrink-0 text-destructive/90" />
            )}
            <div className="min-w-0 flex-1 text-sm">
              {mfaEnabled === null
                ? (lang === "ar" ? "جارٍ التحقق…" : "Checking…")
                : mfaEnabled
                  ? (lang === "ar" ? "التحقق بخطوتين مفعّل لهذا الحساب." : "Two-factor authentication is enabled on this account.")
                  : (lang === "ar" ? "دورك يتطلب تفعيل التحقق بخطوتين." : "Your role requires two-factor authentication.")}
            </div>
            {mfaEnabled === false ? (
              <Link
                to="/mfa-setup"
                className="shrink-0 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                {lang === "ar" ? "تفعيل الآن" : "Enable now"}
              </Link>
            ) : null}
          </div>
        ) : null}

        <form onSubmit={handleChangePassword} className="space-y-3.5">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {lang === "ar" ? "تغيير كلمة المرور" : "Change password"}
          </div>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              {lang === "ar" ? "كلمة المرور الحالية" : "Current password"}
            </span>
            <input
              type="password"
              autoComplete="current-password"
              className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-amber/60 focus:ring-1 focus:ring-amber/40"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              {lang === "ar" ? "كلمة المرور الجديدة" : "New password"}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-amber/60 focus:ring-1 focus:ring-amber/40"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              {lang === "ar" ? "تأكيد كلمة المرور الجديدة" : "Confirm new password"}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-amber/60 focus:ring-1 focus:ring-amber/40"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </label>
          <button
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {lang === "ar" ? "تحديث كلمة المرور" : "Update password"}
          </button>
        </form>
      </div>
    </section>
  );
}
