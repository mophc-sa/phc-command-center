import type { AppRole } from "../_shared/roles.ts";
import type { serviceClient, audit } from "../_shared/supabase.ts";

export type SalesOsCaller = { userId: string; roles: AppRole[] };
export type SalesOsServiceClient = ReturnType<typeof serviceClient>;

export interface SalesOsContext {
  readonly caller: SalesOsCaller;
  readonly svc: SalesOsServiceClient;
  /**
   * A client carrying the CALLER'S OWN JWT, so `auth.uid()` inside Postgres is
   * that person and RLS applies to them.
   *
   * Almost every handler uses `svc` — the function does its authorization in
   * code and then writes as the service role. That is wrong for anything the
   * DATABASE gates on identity rather than on the backend having checked
   * first. promote_historical_row() is the case in point: it tests
   * can_approve_historical_promotion(auth.uid()), which under the service role
   * is NULL and refuses every call. Reaching it needs the caller's real
   * session, not a privileged stand-in, and using `svc` there would mean the
   * backend asserting authority the database deliberately kept for a person.
   */
  readonly asCaller: SalesOsServiceClient;
  readonly audit: typeof audit;
}

export function createSalesOsContext(
  caller: SalesOsCaller,
  authorization: string,
  createServiceClient: () => SalesOsServiceClient,
  createUserClient: (authorization: string) => SalesOsServiceClient,
  auditLog: typeof audit,
): SalesOsContext {
  let serviceClient: SalesOsServiceClient | undefined;
  let callerClient: SalesOsServiceClient | undefined;
  return {
    caller,
    get svc() {
      serviceClient ??= createServiceClient();
      return serviceClient;
    },
    get asCaller() {
      callerClient ??= createUserClient(authorization);
      return callerClient;
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
