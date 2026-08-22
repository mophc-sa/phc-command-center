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
