// PHC Sales OS backend chokepoint. Business actions live in vertical modules.
import { corsHeaders } from "../_shared/cors.ts";
import { err } from "../_shared/respond.ts";
import { audit, resolveCaller, serviceClient, userClient } from "../_shared/supabase.ts";
import { createHandlerRegistry, createSalesOsContext } from "./contracts.ts";
import { aiOutputsModule } from "./handlers/ai-outputs.ts";
import { approvalsModule } from "./handlers/approvals.ts";
import { automationModule } from "./handlers/automation.ts";
import { historicalPromotionModule } from "./handlers/historical-promotion.ts";
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
  aiOutputsModule,
  historicalPromotionModule,
]);

export const salesOsActions = registry.actions;
export const handleSalesOsRequest = createSalesOsRequestHandler({
  handlers: registry.handlers,
  corsHeaders,
  errorResponse: err,
  resolveCaller,
  createContext: (caller, authorization) =>
    createSalesOsContext(caller, authorization, serviceClient, userClient, audit),
});

Deno.serve(handleSalesOsRequest);
