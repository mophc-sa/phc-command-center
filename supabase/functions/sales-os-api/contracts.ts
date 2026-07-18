import type { AppRole } from "../_shared/roles.ts";
import type { serviceClient, audit } from "../_shared/supabase.ts";

export type SalesOsCaller = { userId: string; roles: AppRole[] };
export type SalesOsServiceClient = ReturnType<typeof serviceClient>;

export interface SalesOsContext {
  readonly caller: SalesOsCaller;
  readonly svc: SalesOsServiceClient;
  readonly audit: typeof audit;
}

export function createSalesOsContext(
  caller: SalesOsCaller,
  createServiceClient: () => SalesOsServiceClient,
  auditLog: typeof audit,
): SalesOsContext {
  let serviceClient: SalesOsServiceClient | undefined;
  return {
    caller,
    get svc() {
      serviceClient ??= createServiceClient();
      return serviceClient;
    },
    audit: auditLog,
  };
}

export type SalesOsHandler = (
  payload: Record<string, unknown>,
  context: SalesOsContext,
) => Promise<Response>;

export interface HandlerModule {
  readonly name: string;
  readonly handlers: Readonly<Record<string, SalesOsHandler>>;
}

export function createHandlerRegistry(modules: readonly HandlerModule[]): {
  handlers: Readonly<Record<string, SalesOsHandler>>;
  actions: readonly string[];
} {
  const handlers: Record<string, SalesOsHandler> = Object.create(null);
  for (const module of modules) {
    for (const [action, handler] of Object.entries(module.handlers)) {
      if (handlers[action]) {
        throw new Error(`Duplicate sales-os-api action '${action}' in module '${module.name}'`);
      }
      handlers[action] = handler;
    }
  }
  return { handlers: Object.freeze(handlers), actions: Object.freeze(Object.keys(handlers)) };
}
