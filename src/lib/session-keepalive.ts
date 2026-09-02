// =============================================================================
// Keeping a wall display signed in.
//
// Asked for on 2026-09-02: the board account "should not sign itself out."
//
// WHAT WAS ALREADY FINE
//
// `useIdleLogout` never arms for it. That hook is scoped to MFA_REQUIRED_ROLES
// and the display account holds bd_manager and viewer, neither of which is on
// that list — which is exactly why the board's own header says to drive it with
// a non-sensitive account.
//
// WHAT WAS NOT
//
// The access token expires in an hour. `autoRefreshToken` renews it on a timer
// and on focus, and a wall display gives it neither: browsers throttle timers
// in a tab nobody has touched, and a screen in the corner of an office is never
// focused, never clicked, never scrolled. Miss enough renewals and the session
// is gone — not because anyone signed out, but because nothing woke up to say
// it was still there.
//
// So the board asks for a fresh token on a schedule of its own, on the same
// clock that already refetches its data. It is belt over braces: when
// autoRefreshToken has already done the work this is a no-op against a cached
// session.
//
// WHY THIS IS NOT A WEAKENING
//
// It changes no lifetime and no policy. Nothing here extends what the session
// is allowed to do or how long the server will honour it; it keeps a renewal
// that the browser would otherwise sleep through. Any account can already do
// this by being used.
// =============================================================================

/** Well inside the one-hour access token, and clear of browser timer throttling. */
export const KEEPALIVE_MS = 20 * 60 * 1000;

export type RefreshFn = () => Promise<{ error: unknown } | { error: null }>;

/**
 * Whether it is time to renew, given when we last did.
 *
 * Separated from the timer so the decision is testable without waiting twenty
 * minutes for it. `lastAt === null` means we have never refreshed in this
 * session, and the first tick should.
 */
export function dueForRefresh(lastAt: number | null, now: number, everyMs = KEEPALIVE_MS): boolean {
  if (lastAt === null) return true;
  // A clock that jumped backwards must not park the session forever waiting
  // for a moment that has already passed.
  if (now < lastAt) return true;
  return now - lastAt >= everyMs;
}

/**
 * Try to renew, and report whether it worked. Never throws.
 *
 * A failed refresh is not a reason to tear anything down: the next tick tries
 * again, and if the session is genuinely gone the route guard will say so on
 * its own terms rather than this doing it mid-render.
 */
export async function keepAlive(refresh: RefreshFn): Promise<boolean> {
  try {
    const res = await refresh();
    return !res?.error;
  } catch {
    return false;
  }
}
