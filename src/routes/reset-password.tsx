import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2, KeyRound } from "lucide-react";

const phcLogo = { url: "/phc-logo.png" };

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — PHC Command Center" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  // Supabase JS exchanges the recovery link's token for a session
  // automatically on load (detectSessionInUrl) — a present user here means
  // the link was valid; useAuth() already reflects that once loading settles.
  const { user, loading } = useAuth();
  const { lang, setLang, dir } = useI18n();
  const nav = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error(lang === "ar" ? "كلمتا المرور غير متطابقتين" : "Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success(lang === "ar" ? "تم تحديث كلمة المرور" : "Password updated");
      nav({ to: "/", replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (lang === "ar" ? "حدث خطأ" : "Something went wrong");
      toast.error(msg);
    } finally {
      setBusy(false);
    }
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
              <KeyRound className="h-6 w-6 text-amber-light" />
            </div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
              {lang === "ar" ? "اختر كلمة مرور جديدة" : "Choose a new password"}
            </h1>
          </div>

          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !user ? (
            <div className="space-y-4 text-center">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {lang === "ar"
                  ? "رابط الاستعادة غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا."
                  : "This reset link is invalid or has expired. Request a new one."}
              </p>
              <button
                onClick={() => nav({ to: "/auth", search: { next: "" } as never })}
                className="w-full rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {lang === "ar" ? "العودة لتسجيل الدخول" : "Back to sign in"}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {lang === "ar" ? "كلمة المرور الجديدة" : "New password"}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-amber/60 focus:ring-1 focus:ring-amber/40"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {lang === "ar" ? "تأكيد كلمة المرور" : "Confirm password"}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-amber/60 focus:ring-1 focus:ring-amber/40"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={8}
                  required
                />
              </label>
              <button
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {lang === "ar" ? "تحديث كلمة المرور" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
