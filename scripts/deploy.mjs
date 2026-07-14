#!/usr/bin/env node
/**
 * Build + patch wrangler.json with custom domain + deploy to Cloudflare Workers.
 * Usage: node scripts/deploy.mjs
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const WRANGLER_JSON = ".output/server/wrangler.json";
const CUSTOM_DOMAIN = "agent.phc-sa.com";

// 1. Build
console.log("Building...");
execSync("npm run build", { stdio: "inherit" });

// 2. Patch wrangler.json
const config = JSON.parse(readFileSync(WRANGLER_JSON, "utf-8"));
config.custom_domains = [CUSTOM_DOMAIN];
writeFileSync(WRANGLER_JSON, JSON.stringify(config, null, 2));
console.log(`Patched ${WRANGLER_JSON} with custom_domains: ["${CUSTOM_DOMAIN}"]`);

// 3. Deploy
console.log("Deploying...");
execSync(`npx wrangler deploy --config ${WRANGLER_JSON}`, { stdio: "inherit" });
