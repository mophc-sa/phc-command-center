// =============================================================================
// The protected-route guard, and the shape that keeps it from flashing.
//
// `_authenticated/route.tsx` used to `throw redirect(...)` from `beforeLoad`.
// That resolves DURING hydration, substituting a different route match under a
// Suspense boundary the server had already streamed — React discards the page
// (error #418) and the user sees a flash on the ordinary way in with an expired
// session. React's own diff, from the dev build:
//
//     <OutletImpl>
//       <Suspense fallback={null}>
//   -     <Suspense>        ← the server's boundary for the protected route
//   +     <div dir="ltr">   ← the sign-in form, from /auth
//
// The fix carries the decision as data and navigates from an effect, so the
// match the client hydrates is the match the server rendered.
//
// Two properties have to hold together, and a test for either alone would be
// worse than nothing:
//
//   1. the redirect still happens after hydration, not during it; and
//   2. **every gate that existed before still exists.**
//
// The second is the one that matters. Rewriting a security guard to fix a
// rendering bug is exactly the change where a check goes missing quietly, and
// nothing on screen would say so — an unauthorised user would simply be let in.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "routes", "_authenticated", "route.tsx");
const guard = readFileSync(SRC, "utf8");

/**
 * The file with its comments removed.
 *
 * Every assertion here reads THIS, not `guard`. The route file explains the
 * hydration defect by quoting the code that caused it — `throw redirect(...)`,
 * `<OutletImpl>` — so a test that greps the raw source fails on the
 * explanation instead of the behaviour. Both of those actually happened while
 * writing this suite, which is why the rule is stated rather than assumed:
 * **a source-reading test must read source, or it is testing prose.**
 */
const code = guard.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the guard still refuses everyone it used to refuse", () => {
  // One entry per gate the route enforced before the hydration fix. If a gate
  // is removed or renamed, this fails by name rather than by silence.
  const GATES: Array<[string, RegExp]> = [
    ["no session at all", /getUser\(\)[\s\S]{0,200}?if \(error \|\| !data\.user\)/],
    ["account still pending approval", /profile\.status === "pending_approval"/],
    ["account suspended", /profile\.status === "suspended"/],
    ["account deleted", /profile\.status === "deleted"/],
    ["a suspended account is signed out, not merely bounced", /signOut\(\)/],
    ["MFA is mandatory for sensitive roles", /requiresMfa\(roleList\)/],
    ["no TOTP factor enrolled yet", /nextLevel === "aal1"/],
    ["a factor exists but this session has not stepped up", /nextLevel === "aal2"/],
  ];

  for (const [name, re] of GATES) {
    it(`still checks: ${name}`, () => {
      expect([name, re.test(code)]).toEqual([name, true]);
    });
  }

  it("every refusal names where it sends the caller", () => {
    // Four destinations, one per refusal reason. A gate that decided nothing
    // would leave the user staring at a spinner forever.
    for (const dest of ["/auth", "/pending-approval", "/mfa-setup", "/mfa-verify"]) {
      expect([dest, code.includes(`to: "${dest}"`)]).toEqual([dest, true]);
    }
  });

  it("the signed-out redirect carries where the user was going", () => {
    // Losing `next` turns "sign in and carry on" into "sign in and start over".
    expect(code).toMatch(/const next = location\.pathname \+ location\.searchStr/);
    expect(code).toMatch(/search: \{ next \}/);
  });
});

describe("the redirect happens after hydration, not during it", () => {
  it("beforeLoad throws no redirect — that is the whole defect", () => {
    expect(code).not.toMatch(/throw\s+redirect\s*\(/);
  });

  it("the decision is carried as data", () => {
    expect(code).toMatch(/redirectTo/);
    expect(code).toMatch(/return \{ user: null, redirectTo:/);
  });

  it("and is acted on from an effect, which cannot run during hydration", () => {
    expect(code).toMatch(/useEffect\([\s\S]{0,200}navigate\(/);
  });

  it("the authenticated path explicitly carries no redirect", () => {
    // `redirectTo: null` rather than an absent key: the component branches on
    // it, and `undefined` from a forgotten return would read as "allowed".
    expect(code).toMatch(/return \{ user: data\.user, redirectTo: null \}/);
  });
});

describe("nothing of the app renders while a redirect is pending", () => {
  it("the component returns before <Outlet/> when a redirect is set", () => {
    const early = code.indexOf("if (redirectTo)");
    const outlet = code.indexOf("<Outlet />");
    expect(early).toBeGreaterThan(-1);
    expect(outlet).toBeGreaterThan(-1);
    // The guard clause has to come first, or the shell renders for a frame.
    expect(early).toBeLessThan(outlet);
  });

  it("the shell is not rendered either — no navigation for a page you cannot open", () => {
    const early = code.indexOf("if (redirectTo)");
    expect(code.indexOf("<AppShell>")).toBeGreaterThan(early);
  });

  it("the pending state is announced, not just drawn", () => {
    expect(code).toMatch(/role="status"/);
    expect(code).toMatch(/aria-label="Loading"/);
  });

  it("the redirect replaces history rather than stacking onto it", () => {
    // Back from the sign-in screen must not bounce through the page that
    // just turned the user away.
    expect(code).toMatch(/replace: true/);
  });
});
