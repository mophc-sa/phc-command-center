// Auto sign-out after a period of inactivity, scoped to sensitive roles
// (src/lib/roles.ts's MFA_REQUIRED_ROLES) per the 2026-08-02 security
// hardening request: "جلسة محددة المدة، مع مهلة خمول 30-60 دقيقة للأدوار
// الحساسة". Warns 2 minutes before sign-out so an idle-but-present user has
// a chance to stay signed in.
import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll"] as const;
const WARNING_BEFORE_MS = 2 * 60 * 1000;

export function useIdleLogout(enabled: boolean, idleMinutes = 30, lang: "en" | "ar" = "en") {
  const nav = useNavigate();
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const idleMs = idleMinutes * 60 * 1000;
    let warnTimer: ReturnType<typeof setTimeout>;
    let logoutTimer: ReturnType<typeof setTimeout>;

    const clearTimers = () => {
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
    };

    const scheduleTimers = () => {
      clearTimers();
      warnedRef.current = false;
      warnTimer = setTimeout(() => {
        warnedRef.current = true;
        toast.warning(
          lang === "ar"
            ? "ستُسجَّل خروجك تلقائيًا خلال دقيقتين بسبب عدم النشاط."
            : "You'll be signed out automatically in 2 minutes due to inactivity.",
        );
      }, Math.max(idleMs - WARNING_BEFORE_MS, 0));
      logoutTimer = setTimeout(async () => {
        await supabase.auth.signOut();
        nav({ to: "/auth", search: { next: "" } as never, replace: true });
      }, idleMs);
    };

    const onActivity = () => scheduleTimers();

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
    scheduleTimers();

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
    };
  }, [enabled, idleMinutes, lang, nav]);
}
