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

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcpPlugin(), gitInfoPlugin()],
  },
});
