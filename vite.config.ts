// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import type { Plugin } from "vite";

/**
 * Injects lightweight, non-sensitive git metadata at build/dev time so the
 * app can surface the current branch and latest commit in the UI.
 * The remote URL is intentionally NOT exposed to the client bundle.
 */
function gitInfoPlugin(): Plugin {
  let branch = "unknown";
  let commitHash = "unknown";
  let commitMessage = "";
  try {
    const { execSync } = require("child_process");
    branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    commitHash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    commitMessage = execSync("git log -1 --pretty=%s", { encoding: "utf-8" }).trim();
  } catch {
    // Not a git repo or git unavailable — keep fallbacks.
  }

  return {
    name: "phc-git-info",
    config: () => ({
      define: {
        "import.meta.env.VITE_GIT_BRANCH": JSON.stringify(branch),
        "import.meta.env.VITE_GIT_COMMIT_HASH": JSON.stringify(commitHash),
        "import.meta.env.VITE_GIT_COMMIT_MESSAGE": JSON.stringify(commitMessage),
      },
    }),
  };
}

// @lovable.dev/mcp-js's Vite plugin regenerates the MCP tool-invocation
// routes (src/routes/mcp.ts, [.mcp]/*, [.well-known]/*) from src/lib/mcp on
// every dev/build run. On Windows it throws during configResolved: it
// compares Vite's forward-slash-normalized project root against a
// backslash-produced path.resolve() result, so a legitimate path fails a
// literal string "startsWith" containment check (upstream bug, not
// project-specific — https://github.com/lovable-dev — no fix released at
// time of writing). The generated routes are already committed, so skipping
// regeneration outside Lovable's own environment doesn't change runtime
// behavior; only editing the MCP tool definitions in src/lib/mcp requires
// the plugin to resync them, which happens inside Lovable where this bug
// doesn't reproduce (posix paths). Opt-in via ENABLE_LOVABLE_MCP=true.
const enableLovableMcp = process.env.ENABLE_LOVABLE_MCP === "true";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [...(enableLovableMcp ? [mcpPlugin()] : []), gitInfoPlugin()],
  },
});
