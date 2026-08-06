## What changed and why

<!-- The user-visible effect first. What can someone do now that they couldn't,
     or what stopped being wrong? Then the mechanism. -->

## Verification

<!-- Paste real output, not claims. If something is unverified, say so. -->

- [ ] `bun run verify` (typecheck · lint · tests · build)
- [ ] `deno check` on any changed Edge Function file
- [ ] Browser pass, if this changes anything a user sees

> **Browser pass, not just green tests.** On 2026-08-05 four PRs shipped on a clean
> typecheck, 672 passing tests and green CI, and all of it was blind to three blank
> fields on the page the user lands on. Each was a join never made rather than a
> value that was wrong: source-scanning tests can't see an empty panel. If this PR
> changes a page, open it.

## Does this change the user's flow?

<!-- Intake, classify, convert, stages, permissions, pages, or anything a user
     reads off a screen. -->

- [ ] No — skip the next line
- [ ] Yes — **`docs/USER_GUIDE.md` is updated in this PR** (the affected section
      *and* section 10 Limitations *and* the footer date/commit)

> The guide fell seven PRs behind in a single day. Updating it afterwards doesn't
> happen; updating it here does. See the rule in `CLAUDE.md`.

## Deployment

- [ ] No migrations · no Edge Function changes → merging is enough
- [ ] **Migrations included** — needs explicit approval, applied *before* any
      Edge Function deploy that depends on them
- [ ] **Edge Function changed** — name it, and deploy only that one
      (`docs/deployment-governance.md`)

## Production data

- [ ] Touches none
- [ ] **Touches production data** — needs explicit per-action approval, and the
      two-person rule applies to deletion
