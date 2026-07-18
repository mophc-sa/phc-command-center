// PHC Sales OS backend chokepoint. Business actions live in vertical modules.
import { corsHeaders } from "../_shared/cors.ts";
import { err } from "../_shared/respond.ts";
import { audit, resolveCaller, serviceClient } from "../_shared/supabase.ts";
import { createHandlerRegistry, createSalesOsContext } from "./contracts.ts";
import { approvalsModule } from "./handlers/approvals.ts";
import { automationModule } from "./handlers/automation.ts";
import { intelligenceModule } from "./handlers/intelligence.ts";
import { lifecycleModule } from "./handlers/lifecycle.ts";
import { pipelineModule } from "./handlers/pipeline.ts";
import { createSalesOsRequestHandler } from "./router.ts";

const registry = createHandlerRegistry([
  approvalsModule,
  pipelineModule,
  intelligenceModule,
  automationModule,
  lifecycleModule,
]);

export const salesOsActions = registry.actions;
export const handleSalesOsRequest = createSalesOsRequestHandler({
  handlers: registry.handlers,
  corsHeaders,
  errorResponse: err,
  resolveCaller,
  createContext: (caller) => createSalesOsContext(caller, serviceClient, audit),
});

Deno.serve(handleSalesOsRequest);
