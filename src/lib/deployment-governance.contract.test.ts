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

describe("a canary run is green only when the canary was reachable", () => {
  // Two canary runs failed on 2026-08-24 with a successful upload, a valid
  // Worker Version ID, and no error message whatsoever — because the grep that
  // looked for the preview URL was unguarded under `set -e` with `pipefail`,
  // so no-match (exit 1) killed the script one line BEFORE the `if` that would
  // have explained it.
  //
  // Fixing that is not licence to pass. An upload SUCCEEDING is not a canary
  // EXISTING: `versions upload` stores a version and routes no traffic, so a
  // version id proves the bundle was accepted and nothing more. Without an
  // isolated origin there is nothing to verify against, and a green tick would
  // claim verification that never happened. The step fails in that case — but
  // now says which of the two failures occurred.
  const step = (() => {
    const from = deploy.indexOf("- name: Upload canary version");
    const to = deploy.indexOf("- name: Snapshot production DNS");
    return deploy.slice(from, to);
  })();

  /** The step body with comment lines stripped — the prose describes the old bug. */
  const body = step.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

  it("finds the canary step", () => {
    expect(step.length).toBeGreaterThan(0);
  });

  it("no version id => explicit exit 1", () => {
    expect(body).toMatch(/if \[ -z "\$version_id" \]; then[\s\S]{0,300}?exit 1/);
    expect(body).toContain("no Worker Version ID");
  });

  it("version but NO preview url => explicit exit 1, not a warning", () => {
    // The governance point. A version id alone must never be reported as a
    // passing canary.
    // ` {10}fi` rather than ten literal spaces — eslint's no-regex-spaces is
    // right that a run of spaces in a pattern is unreadable and easy to miscount.
    const branch = body.match(/if \[ -z "\$canary_url" \]; then[\s\S]*?\n {10}fi/);
    expect(branch, "no `-z canary_url` failure branch found").not.toBeNull();
    expect(branch![0]).toContain("::error");
    expect(branch![0]).toContain("exit 1");
    expect(branch![0]).not.toContain("::warning");
  });

  it("names the exact remediation, and that it is not the workers.dev subdomain", () => {
    // Enabling the subdomain was tried between the two failed runs and changed
    // nothing; the message has to distinguish the two settings or the next
    // person repeats it.
    expect(body).toContain("Preview URLs");
    expect(body).toMatch(/separate setting from the workers\.dev subdomain/);
  });

  it("writes the required step summary line verbatim", () => {
    expect(body).toContain("Canary version uploaded but NOT verifiable");
  });

  it("version + url + healthy endpoint => success", () => {
    // The one green path, and it must actually talk to the origin.
    expect(body).toContain("curl --fail");
    expect(body).toContain("${canary_url}/auth");
    expect(body).toContain("Canary health check passed");
    // curl --fail under set -e aborts the step on a non-2xx, so an unhealthy
    // endpoint fails without needing its own branch.
    expect(body).not.toMatch(/curl --fail[^\n]*\|\|\s*true/);
  });

  it("every variable-feeding grep stays guarded with || true", () => {
    // The defect that hid the other defect. Without this each grep can abort
    // the step before any diagnostic runs.
    const greps = body.split("\n").filter((l) => l.includes("grep -Eo") && l.includes('="$('));
    expect(greps.length).toBeGreaterThan(0);
    for (const line of greps) {
      expect(line, `unguarded grep aborts under set -e: ${line.trim()}`).toContain("|| true");
    }
  });

  it("uploads only — never deploys or routes traffic", () => {
    expect(body).toContain("versions upload");
    expect(body).not.toContain("versions deploy");
    expect(body).not.toContain("triggers deploy");
  });

  it("leaves the production-only steps gated", () => {
    for (const name of [
      "Snapshot production DNS for rollback",
      "Preserve production DNS rollback snapshot",
      "Deploy production custom domain",
    ]) {
      const idx = deploy.indexOf(`- name: ${name}`);
      expect(idx, `${name} missing`).toBeGreaterThan(-1);
      expect(deploy.slice(idx, idx + 200)).toContain("env.DEPLOY_TARGET == 'production'");
    }
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
