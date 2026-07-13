import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { Loader2, Clock } from "lucide-react";

const phcLogo = { url: "/phc-logo.png" };

export const Route = createFileRoute("/pending-approval")({
  head: () => ({
    meta: [
      { title: "Account Pending Approval — PHC Command Center" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PendingApprovalPage,
});

function PendingApprovalPage() {
  const { user, loading } = useAuth();
  const { lang, setLang, dir } = useI18n();
  const nav = useNavigate();

  // If not logged in → go to /auth
  useEffect(() => {
    if (!loading && !user) {
      nav({ to: "/auth", search: { next: "" } as never, replace: true });
    }
  }, [loading, user, nav]);

  // If user becomes active while on this page (admin approved in real time),
  // redirect immediately via Supabase Realtime — no polling needed.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`profile-status-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${user.id}`,
        },
        (payload: { new: { status?: string } }) => {
          if (payload.new?.status === "active") {
            nav({ to: "/command-center", replace: true });
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, nav]);

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
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <img src={phcLogo.url} alt="PHC" className="h-7 w-auto object-contain" />
        <button
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {lang === "en" ? "AR" : "EN"}
        </button>
      </header>

      {/* Body */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber/30 bg-amber/10">
            <Clock className="h-6 w-6 text-amber-light" />
          </div>

          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {lang === "ar" ? "طلبك قيد المراجعة" : "Account pending approval"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {lang === "ar"
                ? "تم إنشاء حسابك بنجاح. يحتاج مسؤول النظام إلى تفعيله قبل تمكنك من الوصول. ستتلقى إشعارًا عند الموافقة."
                : "Your account has been created and is awaiting administrator approval. You'll be redirected automatically once your account is activated."}
            </p>
          </div>

          <div className="rounded-md border border-border bg-surface px-4 py-3 text-left text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {lang === "ar" ? "البريد الإلكتروني: " : "Signed in as: "}
            </span>
            {user?.email}
          </div>

          <button
            onClick={handleSignOut}
            className="w-full rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {lang === "ar" ? "تسجيل الخروج" : "Sign out"}
          </button>
        </div>
      </main>
    </div>
  );
}
