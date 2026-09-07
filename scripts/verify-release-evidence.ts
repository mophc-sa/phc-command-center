// Read-only GitHub evidence gate. It never deploys or handles deployment secrets.
type Run = { id: number; head_sha: string; head_branch: string; conclusion: string; updated_at: string };
const workflows = ["ci.yml", "security.yml", "isolated-readiness.yml"];
export async function verifyReleaseEvidence(mode: "readiness" | "production", repo: string, sha: string, token: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/.test(sha) || !token) throw new Error("Release identity or GitHub token missing");
  const api = async (path: string) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`Release evidence unavailable (${response.status})`);
    return response.json();
  };
  for (const workflow of workflows) {
    const { workflow_runs: runs } = await api(`actions/workflows/${workflow}/runs?head_sha=${sha}&branch=main&per_page=30`) as { workflow_runs: Run[] };
    const latest = runs.find((r) => r.head_sha === sha && r.head_branch === "main");
    if (!latest || latest.conclusion !== "success") throw new Error(`Latest ${workflow} run must succeed for this main SHA`);
  }
  // Select the latest canary receipt across all SHAs, so an overwritten alias
  // cannot masquerade as the release under test.
  const { artifacts } = await api("actions/artifacts?per_page=100") as { artifacts: Array<{ name: string; expired: boolean; created_at: string; workflow_run: { id: number; head_sha: string } }> };
  const canary = artifacts.filter((a) => a.name.startsWith("canary-deployed-") && !a.expired)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!canary || canary.name !== `canary-deployed-${sha}` || canary.workflow_run.head_sha !== sha) throw new Error("Latest verified canary must match this SHA");
  const canaryRun = await api(`actions/runs/${canary.workflow_run.id}`) as Run & { path: string };
  if (canaryRun.conclusion !== "success" || canaryRun.head_branch !== "main" || canaryRun.path !== ".github/workflows/deploy-cloudflare.yml") throw new Error("Canary receipt must come from the successful main deployment workflow");
  if (mode === "production") {
    const readiness = artifacts.find((a) => a.name === `canary-readiness-${sha}` && !a.expired && a.created_at > canary.created_at && a.workflow_run.head_sha === sha);
    if (!readiness) throw new Error("Isolated role/account/MFA and deployed public readiness must pass after this canary upload");
    const run = await api(`actions/runs/${readiness.workflow_run.id}`) as Run & { path: string };
    if (run.conclusion !== "success" || run.head_branch !== "main" || run.path !== ".github/workflows/production-readiness.yml") throw new Error("Readiness workflow has not succeeded");
  }
  console.log(`Verified ${mode} evidence for ${sha}`);
}
if (import.meta.main) {
  const mode = process.argv[2];
  if (mode !== "readiness" && mode !== "production") throw new Error("Expected readiness or production mode");
  await verifyReleaseEvidence(mode, process.env.GITHUB_REPOSITORY ?? "", process.env.GITHUB_SHA ?? "", process.env.GH_TOKEN ?? "");
}
