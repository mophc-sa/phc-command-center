// PHC Sales OS backend chokepoint. Business actions live in vertical modules.
import { corsHeaders } from "../_shared/cors.ts";
import { err } from "../_shared/respond.ts";
import { audit, resolveCaller, serviceClient, userClient } from "../_shared/supabase.ts";
import { createHandlerRegistry, createSalesOsContext } from "./contracts.ts";
import { aiOutputsModule } from "./handlers/ai-outputs.ts";
import { approvalsModule } from "./handlers/approvals.ts";
import { automationModule } from "./handlers/automation.ts";
import { historicalPromotionModule } from "./handlers/historical-promotion.ts";
import { aiStatusModule } from "./handlers/ai-status.ts";
import { aiQualityModule } from "./handlers/ai-quality.ts";
import { dailyAssistantModule } from "./handlers/daily-assistant.ts";
import { knowledgeModule } from "./handlers/knowledge.ts";
import { intelligenceModule } from "./handlers/intelligence.ts";
import { lifecycleModule } from "./handlers/lifecycle.ts";
import { mailModule } from "./handlers/mail.ts";
import { calendarFeedModule } from "./handlers/calendar-feed.ts";
import { pipelineModule } from "./handlers/pipeline.ts";
import { createSalesOsRequestHandler } from "./router.ts";

const registry = createHandlerRegistry([
  approvalsModule,
  pipelineModule,
  intelligenceModule,
  knowledgeModule,
  dailyAssistantModule,
  aiQualityModule,
  aiStatusModule,
  automationModule,
  lifecycleModule,
  aiOutputsModule,
  historicalPromotionModule,
  mailModule,
  calendarFeedModule,
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
