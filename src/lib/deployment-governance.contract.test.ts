// =============================================================================
// Merging must not deploy.
//
// docs/deployment-governance.md: "Every production change requires an explicit
// approval gate" and "production deployment must remain manual and
// approval-gated". CLAUDE.md: deployments "must never be triggered
// automatically by merging to main".
//
// The Cloudflare workflow contradicted both for months. It carried
// `push: branches: [main]`, so every merged PR cut over agent.phc-sa.com with
// nobody in the loop. Nothing caught it because nothing was checking, and the
// symptom was invisible: the PRs that happened to merge were migrations and
// tests, so the redeployed bundle was byte-identical and the deploy looked
// like a no-op. The first PR with frontend changes would have shipped live.
//
// A comment saying "manual only" would not have prevented that. This test is
// the thing that fails if the trigger comes back — by hand, by a merge
// conflict resolved the wrong way, or by someone restoring "convenience".
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS = join(root, ".github/workflows");
const read = (f: string) => readFileSync(join(WORKFLOWS, f), "utf8");

const DEPLOY = "deploy-cloudflare.yml";
const deploy = read(DEPLOY);

/** A workflow's `on:` block — from `on:` to the next top-level key. */
function triggers(yaml: string): string {
  const m = yaml.match(/^on:\n([\s\S]*?)(?=^\S)/m);
  return m ? m[1] : "";
}

/** Comment lines explain the OLD behaviour, so they are stripped first. */
const code = (s: string) =>
  s.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

describe("no workflow deploys to production without a human", () => {
  it("the Cloudflare workflow has no push trigger", () => {
    const on = code(triggers(deploy));
    expect(on).not.toMatch(/^\s*push:/m);
    // Nor the other ways a merge can start a run without anyone asking.
    expect(on).not.toMatch(/^\s*(pull_request|pull_request_target|schedule|release):/m);
  });

  it("workflow_dispatch is the only way in", () => {
    const on = code(triggers(deploy));
    expect(on).toMatch(/^\s*workflow_dispatch:/m);
    const events = [...on.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
    expect(events).toEqual(["workflow_dispatch"]);
  });

  it("a non-manual trigger is refused at runtime too", () => {
    // Belt and braces: if the trigger is ever restored, the job must fail
    // rather than deploy. Removing the trigger and this guard together is a
    // deliberate act; doing one by accident is not enough.
    expect(deploy).toMatch(/GITHUB_EVENT_NAME.*!=.*workflow_dispatch/);
  });

  it("production cutover requires typing the domain", () => {
    expect(deploy).toMatch(/if: inputs\.target == 'production'/);
    expect(deploy).toMatch(/CONFIRM.*!=.*DNS_RECORD_NAME/);
  });

  it("no leftover expression assumes a push event", () => {
    // These drove target selection when push meant production. Any survivor
    // would silently evaluate to the canary branch of a `||`.
    expect(code(deploy)).not.toContain("event_name == 'push'");
  });
});

describe("the canary step survives a Worker with no preview URL", () => {
  // Two canary runs failed on 2026-08-24 with a successful upload, a valid
  // Worker Version ID, and no error message whatsoever. Two separate defects
  // in one step produced that:
  //
  //   1. it treated a *.workers.dev URL as mandatory, but a Worker served only
  //      through a custom domain emits none unless Preview URLs is enabled —
  //      a different setting from the workers.dev subdomain
  //   2. the grep that looked for the URL was unguarded under `set -e` with
  //      `pipefail`, so no-match (exit 1) killed the script one line BEFORE
  //      the `if` that would have explained it
  //
  // The second is why the first cost two diagnostic cycles.
  const step = (() => {
    const from = deploy.indexOf("- name: Upload canary version");
    const to = deploy.indexOf("- name: Snapshot production DNS");
    return deploy.slice(from, to);
  })();

  it("finds the canary step", () => {
    expect(step.length).toBeGreaterThan(0);
  });

  it("requires the version id, which is what proves the upload happened", () => {
    expect(step).toContain("Worker Version ID");
    expect(step).toMatch(/if \[ -z "\$version_id" \]; then[\s\S]*?exit 1/);
  });

  it("treats the preview URL as optional, not mandatory", () => {
    // A canary that uploaded correctly must not be recorded as a failed
    // deployment because an optional URL was absent.
    expect(step).not.toMatch(/if \[ -z "\$canary_url" \][\s\S]{0,120}exit 1/);
    expect(step).toContain("::warning");
  });

  it("guards every grep against no-match under set -e", () => {
    // The defect that hid the other defect. Each grep feeding a variable must
    // tolerate no-match, or the step dies before it can report anything.
    const greps = step.split("\n").filter((l) => l.includes("grep -Eo") && l.includes("=\"$("));
    expect(greps.length).toBeGreaterThan(0);
    for (const line of greps) {
      expect(line, `unguarded grep will abort under set -e: ${line.trim()}`).toContain("|| true");
    }
  });

  it("still health-checks when a URL is available", () => {
    // Dropping the check along with the hard failure would trade a false
    // negative for no verification at all.
    expect(step).toMatch(/if \[ -n "\$canary_url" \]/);
    expect(step).toContain("curl --fail");
    expect(step).toContain("/auth");
  });

  it("says plainly that no health check ran when there is no URL", () => {
    // The failure mode to avoid now is the opposite one: a green tick that
    // looks like a verified canary when nothing was actually reachable.
    expect(step).toMatch(/not performed|No canary preview URL/i);
  });

  it("does not deploy or route traffic — upload only", () => {
    expect(step).toContain("versions upload");
    expect(step).not.toContain("versions deploy");
    expect(step).not.toContain("triggers deploy");
  });
});

describe("no other workflow deploys on merge", () => {
  const OTHERS = readdirSync(WORKFLOWS).filter((f) => f !== DEPLOY && /\.ya?ml$/.test(f));

  it("finds the workflows to check", () => {
    expect(OTHERS.length).toBeGreaterThan(0);
  });

  for (const f of OTHERS) {
    it(`${f} runs no deployment step on push`, () => {
      const body = code(read(f));
      const onPush = /^\s*push:/m.test(triggers(read(f)));
      if (!onPush) return;
      // A workflow may run on push — CI must. It may not ship.
      expect(body).not.toMatch(/wrangler[^\n]*\bdeploy\b/);
      expect(body).not.toMatch(/wrangler[^\n]*versions upload/);
      expect(body).not.toMatch(/supabase (db push|functions deploy)/);
    });
  }
});

describe("CI still runs on main, so merging is verified even though it is not shipped", () => {
  it("ci.yml runs on push to main", () => {
    const on = triggers(read("ci.yml"));
    expect(on).toMatch(/push:/);
    expect(on).toMatch(/branches: \[main\]/);
  });
});
