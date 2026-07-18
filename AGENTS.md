<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Deploy Configuration (configured by /setup-deploy)
- Platform: Cloudflare Workers
- Production URL: https://agent.phc-sa.com
- Deploy workflow: .github/workflows/deploy-cloudflare.yml
- Deploy status command: `gh run list --workflow deploy-cloudflare.yml --branch main --limit 1`
- Merge method: squash
- Project type: TanStack Start web app / Cloudflare Worker
- Post-deploy health check: https://agent.phc-sa.com/auth

### Custom deploy hooks
- Pre-merge: `bun run verify`
- Deploy trigger: manual GitHub Actions dispatch from `main`, protected by the `production-cloudflare` environment
- Deploy status: poll the `Deploy Cloudflare Worker` GitHub Actions workflow
- Health check: require HTTPS 200 from `/auth`, then run the `Production Readiness` workflow
- Canary: upload a Worker version with the `phc-canary` preview alias before production routing
- Rollback: `bunx wrangler@4 rollback <version-id> --name mophc-sa-phc-command-center`
- Production Worker: `mophc-sa-phc-command-center`
- Production custom domain: `agent.phc-sa.com`
- Lovable transition: keep `lovable-fallback` and Lovable hosting available until two consecutive Cloudflare production releases pass Production Readiness
