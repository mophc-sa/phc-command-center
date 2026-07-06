import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listOpportunities from "./tools/list-opportunities";
import listApprovals from "./tools/list-approvals";
import recentAgentRuns from "./tools/recent-agent-runs";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "phc-mcp",
  title: "PHC Agent Integrations",
  version: "0.1.0",
  instructions:
    "Tools for the PHC sales-ops app. Read opportunities, pending approvals, and recent agent runs for the signed-in user. All access is scoped by Supabase RLS.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listOpportunities, listApprovals, recentAgentRuns],
});
