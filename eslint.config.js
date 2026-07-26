import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      ".tanstack",
      ".bun-cache",
      "supabase/.temp",
      "test-results",
      "exports-inspected",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // eslint-plugin-react-hooks 7.x's "recommended" config (bumped from
      // 5.x as part of the eslint 10 upgrade — see docs/KNOWN_ISSUES.md,
      // brace-expansion CVE fix) bundles a much larger "React Compiler
      // readiness" rule set (purity, set-state-in-effect, immutability,
      // refs, etc.) as errors across the whole codebase. Adopting that is a
      // separate, much larger initiative than the dependency bump that
      // motivated this upgrade, so only the same two rules this repo has
      // always enforced are kept here; the rest is a deliberate future
      // decision, not an oversight.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // The generated Supabase surface and existing route adapters contain a
      // known `any` backlog. TypeScript strict mode remains the merge gate;
      // new code should avoid `any`, while the backlog is reduced separately.
      "@typescript-eslint/no-explicit-any": "off",
      // Vite config uses require inside a guarded build-time plugin because
      // the config is evaluated in mixed ESM/CJS host environments.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
